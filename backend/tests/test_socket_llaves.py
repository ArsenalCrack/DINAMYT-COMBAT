"""
Test de integración: combate de eliminación controlado por el Juez Central
vía Socket.IO (activar → puntuar → guardar → el ganador avanza en la llave).

Usa una base de datos SQLite en memoria y el test client de Flask-SocketIO.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402

from app import create_app  # noqa: E402
from app.config import DevelopmentConfig  # noqa: E402
from app.extensions import db, socketio  # noqa: E402

# Base en memoria, aislada del dinamyt.db local. Debe fijarse ANTES de
# create_app porque Flask-SQLAlchemy construye el engine en init_app.
DevelopmentConfig.SQLALCHEMY_DATABASE_URI = "sqlite://"


@pytest.fixture()
def entorno(tmp_path):
    """App + DB en memoria con campeonato, tatami y llave de 2 competidores."""
    app = create_app("development")
    assert "dinamyt.db" not in str(app.config["SQLALCHEMY_DATABASE_URI"])

    # Aislar la persistencia de tatamis: ni leer ni escribir el archivo real
    # (instance/tatami_states.json) que usa el servidor de desarrollo.
    from app.sockets import combate_ns
    combate_ns._SNAPSHOT_PATH = tmp_path / "tatami_states_test.json"
    combate_ns._snapshots_cargados = True

    with app.app_context():
        db.create_all()
        from app.seeds.seed_categorias import seed_categorias
        seed_categorias()

        from app.models.campeonato import Campeonato
        from app.models.tatami import Tatami
        from app.models.llave import Llave
        from app.api.llaves import generar_estructura

        camp = Campeonato(nombre="Camp Test", activo=True)
        db.session.add(camp)
        db.session.flush()
        tatami = Tatami(campeonato_id=camp.id, numero=1)
        db.session.add(tatami)
        db.session.flush()
        llave = Llave(
            campeonato_id=camp.id,
            tatami_id=tatami.id,
            nombre="Llave Test",
            estructura=generar_estructura([{"nombre": "Ana"}, {"nombre": "Luis"}]),
        )
        db.session.add(llave)
        db.session.commit()

        # Estado limpio del tatami para cada test
        from app.sockets import combate_ns
        combate_ns.tatami_states.clear()

        yield app, tatami.id, llave.id
        db.session.remove()
        db.drop_all()


def _ultimo_estado(cliente):
    """Último broadcast de estado recibido por el cliente."""
    estados = [
        r["args"][0]["datos"] for r in cliente.get_received("/combate")
        if r["name"] in ("estado", "estado_confirmado") and r["args"]
    ]
    return estados[-1] if estados else None


def _rechazos(cliente):
    return [
        r["args"][0]["message"] for r in cliente.get_received("/combate")
        if r["name"] == "accion_rechazada" and r["args"]
    ]


_contador_ev = {"n": 0}


def _emitir(cliente, accion, **datos):
    # evId único: si se repite, la deduplicación del servidor lo descarta
    _contador_ev["n"] += 1
    ev_id = f"t_{accion}_{_contador_ev['n']}"
    cliente.emit("evento", {"evId": ev_id, "evento": {"accion": accion, **datos}}, namespace="/combate")


class TestCombateEliminacionSocket:
    def test_flujo_completo(self, entorno):
        app, tatami_id, llave_id = entorno
        cliente = socketio.test_client(
            app, namespace="/combate",
            query_string=f"tatami_id={tatami_id}&rol=arbitro",
        )
        assert cliente.is_connected("/combate")

        _emitir(cliente, "activar_tatami")
        _emitir(cliente, "activar_combate_llave", llave_id=llave_id)
        estado = _ultimo_estado(cliente)
        assert estado is not None
        # El broadcast lleva el campeonato (lo usa el botón Volver del admin)
        assert estado["_campeonato_id"] is not None
        assert estado["_tatami_numero"] == 1
        # Nombres autocompletados desde la llave y crono pausado
        assert {estado["nombreHong"], estado["nombreChung"]} == {"Ana", "Luis"}
        assert estado["activo"] is False
        assert estado["_combate_llave"]["llave_id"] == llave_id
        assert estado["_combate_llave"]["ronda_nombre"] == "Final"
        hong_nombre = estado["nombreHong"]

        # Al activar, el público ve el árbol de la llave
        assert estado["_mostrar_arbol"] is True
        assert estado["_hay_arbol"] is True
        assert estado["_llave_arbol"]["nombre"] == "Llave Test"
        assert estado["_llave_arbol"]["estructura"]["campeon"] is None

        # Al iniciar el cronómetro, el público pasa al marcador
        _emitir(cliente, "crono_start")
        estado = _ultimo_estado(cliente)
        assert estado["_mostrar_arbol"] is False
        assert estado["_llave_arbol"] is None, "la estructura no viaja si no se muestra"
        assert estado["_hay_arbol"] is True, "el JC conserva el botón de mostrar árbol"
        _emitir(cliente, "crono_pause")

        # El Juez Central puede volver a mostrar el árbol manualmente
        _emitir(cliente, "mostrar_arbol", mostrar=True)
        estado = _ultimo_estado(cliente)
        assert estado["_mostrar_arbol"] is True

        # Hong anota y el Juez Central guarda → el ganador avanza
        _emitir(cliente, "punto_juez", juez="j1", color="hong", pts=2, nombre="Cuerpo")
        _emitir(cliente, "nuevo_combate")
        estado = _ultimo_estado(cliente)
        assert estado["_combate_llave"] is None, "el tatami queda libre tras guardar"
        # El público vuelve a ver el árbol, ya actualizado con el campeón
        assert estado["_mostrar_arbol"] is True
        assert estado["_llave_arbol"]["estructura"]["campeon"] is not None

        with app.app_context():
            from app.models.llave import Llave
            llave = Llave.query.get(llave_id)
            campeon = llave.estructura.get("campeon")
            assert campeon is not None
            assert campeon["nombre"] == hong_nombre, "gana quien estaba como Hong"

        cliente.disconnect(namespace="/combate")

    def test_empate_rechazado(self, entorno):
        app, tatami_id, llave_id = entorno
        cliente = socketio.test_client(
            app, namespace="/combate",
            query_string=f"tatami_id={tatami_id}&rol=arbitro",
        )
        _emitir(cliente, "activar_tatami")
        _emitir(cliente, "activar_combate_llave", llave_id=llave_id)
        cliente.get_received("/combate")

        # Puntos iguales para ambos → guardar debe rechazarse
        _emitir(cliente, "punto_juez", juez="j1", color="hong", pts=2, nombre="x")
        _emitir(cliente, "punto_juez", juez="j1", color="chung", pts=2, nombre="x")
        _emitir(cliente, "nuevo_combate")
        rechazos = _rechazos(cliente)
        assert any("ganador" in m.lower() for m in rechazos), rechazos

        with app.app_context():
            from app.models.llave import Llave
            llave = Llave.query.get(llave_id)
            assert llave.estructura.get("campeon") is None, "no debe avanzar sin ganador"

        cliente.disconnect(namespace="/combate")

    def test_soltar_combate(self, entorno):
        app, tatami_id, llave_id = entorno
        cliente = socketio.test_client(
            app, namespace="/combate",
            query_string=f"tatami_id={tatami_id}&rol=arbitro",
        )
        _emitir(cliente, "activar_tatami")
        _emitir(cliente, "activar_combate_llave", llave_id=llave_id)
        _emitir(cliente, "soltar_combate_llave")
        estado = _ultimo_estado(cliente)
        assert estado["_combate_llave"] is None

        with app.app_context():
            from app.models.llave import Llave
            llave = Llave.query.get(llave_id)
            assert llave.estructura.get("campeon") is None, "el combate sigue pendiente"

        cliente.disconnect(namespace="/combate")

    def test_eliminar_llave_responde_200(self, entorno):
        """Regresión: eliminar accedía al objeto borrado y respondía 500."""
        app, _tatami_id, llave_id = entorno
        with app.app_context():
            from flask_jwt_extended import create_access_token
            from app.models.usuario import Usuario

            admin = Usuario(email="admin@test.com", nombre="Admin", rol="admin", activo=True)
            admin.set_password("clave-test")
            db.session.add(admin)
            db.session.commit()
            token = create_access_token(identity=str(admin.id))

        cliente = app.test_client()
        resp = cliente.delete(
            f"/api/llaves/{llave_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200, resp.get_json()
        assert "eliminada" in resp.get_json()["message"]

        with app.app_context():
            from app.models.llave import Llave
            assert Llave.query.get(llave_id) is None

    def test_no_activa_con_combate_en_curso(self, entorno):
        app, tatami_id, llave_id = entorno
        cliente = socketio.test_client(
            app, namespace="/combate",
            query_string=f"tatami_id={tatami_id}&rol=arbitro",
        )
        _emitir(cliente, "activar_tatami")
        # Combate suelto con nombres y un punto registrado
        _emitir(cliente, "nombres", nombreHong="Pedro", nombreChung="Juan")
        _emitir(cliente, "punto_juez", juez="j1", color="hong", pts=1, nombre="x")
        cliente.get_received("/combate")

        _emitir(cliente, "activar_combate_llave", llave_id=llave_id)
        rechazos = _rechazos(cliente)
        assert any("guarda o resetea" in m.lower() for m in rechazos), rechazos

        cliente.disconnect(namespace="/combate")


def _crear_llave_figuras(
    app, tatami_id, nombre="FIGURA CON ARMAS",
    descripcion="Intermedios 15-17 anios", comps=None, asignar=True,
):
    comps = comps or [{"nombre": "Ana"}, {"nombre": "Luis"}, {"nombre": "Mia"}]
    with app.app_context():
        from app.models.tatami import Tatami
        from app.models.llave import Llave
        from app.api.llaves import generar_estructura_figuras

        tatami = Tatami.query.get(tatami_id)
        llave = Llave(
            campeonato_id=tatami.campeonato_id,
            tatami_id=tatami_id if asignar else None,
            tipo="figuras",
            nombre=nombre,
            descripcion=descripcion,
            estado="pendiente",
            estructura=generar_estructura_figuras(comps),
        )
        db.session.add(llave)
        db.session.commit()
        return llave.id


def _token_admin(app):
    with app.app_context():
        from flask_jwt_extended import create_access_token
        from app.models.usuario import Usuario

        admin = Usuario.query.filter_by(email="admin@test.com").first()
        if not admin:
            admin = Usuario(email="admin@test.com", nombre="Admin", rol="admin", activo=True)
            admin.set_password("clave-test")
            db.session.add(admin)
            db.session.commit()
        return create_access_token(identity=str(admin.id))


def test_podio_llave_combate():
    from app.api.llaves import (
        generar_estructura, registrar_resultado, podio_llave, partidos_jugables, BRONCE,
    )

    est = generar_estructura([
        {"nombre": "A"}, {"nombre": "B"}, {"nombre": "C"}, {"nombre": "D"},
    ])
    assert podio_llave(est) == [], "sin campeón no hay podio"

    # Semifinales (ronda 0): siempre gana el comp1
    registrar_resultado(est, 0, 0, 1)
    registrar_resultado(est, 0, 1, 1)
    # Tras las semifinales aparece el partido por el bronce
    assert any(r == BRONCE for r, _i, _p in partidos_jugables(est))

    # Final (ronda 1): aún sin bronce → solo 1° y 2°
    registrar_resultado(est, 1, 0, 1)
    assert est["campeon"] is not None
    assert sorted(p["puesto"] for p in podio_llave(est)) == [1, 2]

    # Partido por el bronce → podio con un único 1°, 2° y 3°
    registrar_resultado(est, BRONCE, 0, 1)
    assert partidos_jugables(est) == [], "ya no quedan partidos"
    podio = podio_llave(est)
    assert sorted(p["puesto"] for p in podio) == [1, 2, 3]
    primero = next(p for p in podio if p["puesto"] == 1)
    assert primero["nombre"] == est["campeon"]["nombre"]


def test_podio_llave_con_bye():
    """3 competidores: un bye → un solo 3° puesto (el bye no deja perdedor)."""
    from app.api.llaves import generar_estructura, podio_llave, siguiente_partido, registrar_resultado

    est = generar_estructura([{"nombre": "A"}, {"nombre": "B"}, {"nombre": "C"}])
    # Jugar todos los partidos disponibles dando la victoria al primer lado
    while True:
        sig = siguiente_partido(est)
        if sig is None:
            break
        r, p, _ = sig
        registrar_resultado(est, r, p, 1)
    assert est["campeon"] is not None
    podio = podio_llave(est)
    puestos = sorted(p["puesto"] for p in podio)
    assert puestos == [1, 2, 3], f"esperado 1/2/3, fue {puestos}"


class TestGrupoFiguras:
    def test_crear_figuras_via_api(self, entorno):
        app, tatami_id, _ = entorno
        token = _token_admin(app)
        with app.app_context():
            from app.models.tatami import Tatami
            camp_id = Tatami.query.get(tatami_id).campeonato_id

        cliente = app.test_client()
        resp = cliente.post(
            "/api/llaves",
            json={
                "campeonato_id": camp_id,
                "tipo": "figuras",
                "nombre": "DEFENSA PERSONAL",
                "descripcion": "Avanzados 18+",
                # Sin tatami: queda en el pool
                "competidores": [{"nombre": "A"}, {"nombre": "B"}, {"nombre": "C"}],
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 201, resp.get_json()
        llave = resp.get_json()["llave"]
        assert llave["tipo"] == "figuras"
        assert llave["estado"] == "pendiente"
        assert llave["tatami_id"] is None
        assert llave["descripcion"] == "Avanzados 18+"
        assert llave["estructura"]["rondas"] == []
        assert len(llave["estructura"]["competidores"]) == 3

    def test_figuras_minimo_competidores(self, entorno):
        app, tatami_id, _ = entorno
        token = _token_admin(app)
        with app.app_context():
            from app.models.tatami import Tatami
            camp_id = Tatami.query.get(tatami_id).campeonato_id
        cliente = app.test_client()
        resp = cliente.post(
            "/api/llaves",
            json={
                "campeonato_id": camp_id, "tipo": "figuras", "nombre": "X",
                "competidores": [{"nombre": "A"}],
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 400

    def test_editar_solo_si_pendiente(self, entorno):
        app, tatami_id, _ = entorno
        fig_id = _crear_llave_figuras(app, tatami_id)
        token = _token_admin(app)
        cliente = app.test_client()

        # Pendiente: editar OK (agregar competidor + cambiar descripción)
        resp = cliente.put(
            f"/api/llaves/{fig_id}",
            json={
                "descripcion": "Nueva desc",
                "competidores": [{"nombre": "A"}, {"nombre": "B"}, {"nombre": "C"}, {"nombre": "D"}],
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200, resp.get_json()
        assert len(resp.get_json()["llave"]["estructura"]["competidores"]) == 4

        # Marcar como activa y reintentar: debe rechazar (409)
        with app.app_context():
            from app.models.llave import Llave
            llave = Llave.query.get(fig_id)
            llave.estado = "activa"
            db.session.commit()
        resp2 = cliente.put(
            f"/api/llaves/{fig_id}",
            json={"descripcion": "no debería"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp2.status_code == 409

    def test_marcar_ganador_rechaza_figuras(self, entorno):
        app, tatami_id, _ = entorno
        fig_id = _crear_llave_figuras(app, tatami_id)
        token = _token_admin(app)
        cliente = app.test_client()
        resp = cliente.put(
            f"/api/llaves/{fig_id}/partido",
            json={"ronda": 0, "partido": 0, "ganador": 1},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 400

    def test_activar_grupo_figuras_carga_competidores(self, entorno):
        app, tatami_id, _ = entorno
        fig_id = _crear_llave_figuras(app, tatami_id)
        cliente = socketio.test_client(
            app, namespace="/combate",
            query_string=f"tatami_id={tatami_id}&rol=arbitro",
        )
        _emitir(cliente, "activar_tatami")
        _emitir(cliente, "activar_grupo_figuras", llave_id=fig_id)
        estado = _ultimo_estado(cliente)
        assert estado["_categoria"] == "figuras"
        assert estado["nombre_categoria"] == "FIGURA CON ARMAS"
        assert estado.get("descripcion") == "Intermedios 15-17 anios"
        assert len(estado["competidores"]) == 3
        assert estado["_grupo_figuras"]["llave_id"] == fig_id

        with app.app_context():
            from app.models.llave import Llave
            assert Llave.query.get(fig_id).estado == "activa"

        # Guardar la categoría (sin puntuar) → grupo terminado
        _emitir(cliente, "nuevo_combate")
        estado = _ultimo_estado(cliente)
        assert estado.get("_grupo_figuras") is None
        with app.app_context():
            from app.models.llave import Llave
            assert Llave.query.get(fig_id).estado == "terminada"

        cliente.disconnect(namespace="/combate")

    def test_activar_grupo_otro_tatami_rechazado(self, entorno):
        app, tatami_id, _ = entorno
        # Grupo en el pool (sin tatami)
        fig_id = _crear_llave_figuras(app, tatami_id, asignar=False)
        cliente = socketio.test_client(
            app, namespace="/combate",
            query_string=f"tatami_id={tatami_id}&rol=arbitro",
        )
        _emitir(cliente, "activar_tatami")
        _emitir(cliente, "activar_grupo_figuras", llave_id=fig_id)
        rechazos = _rechazos(cliente)
        assert any("otro tatami" in m.lower() for m in rechazos), rechazos
        cliente.disconnect(namespace="/combate")

    def test_soltar_grupo_figuras(self, entorno):
        app, tatami_id, _ = entorno
        fig_id = _crear_llave_figuras(app, tatami_id)
        cliente = socketio.test_client(
            app, namespace="/combate",
            query_string=f"tatami_id={tatami_id}&rol=arbitro",
        )
        _emitir(cliente, "activar_tatami")
        _emitir(cliente, "activar_grupo_figuras", llave_id=fig_id)
        estado = _ultimo_estado(cliente)
        assert estado["_grupo_figuras"]["llave_id"] == fig_id
        with app.app_context():
            from app.models.llave import Llave
            assert Llave.query.get(fig_id).estado == "activa"

        # Soltar: se desvincula y la llave vuelve a 'pendiente'
        _emitir(cliente, "soltar_grupo_figuras")
        estado = _ultimo_estado(cliente)
        assert estado.get("_grupo_figuras") is None
        with app.app_context():
            from app.models.llave import Llave
            assert Llave.query.get(fig_id).estado == "pendiente"
        cliente.disconnect(namespace="/combate")


def test_partido_bronce_via_api(entorno):
    """El 3er puesto se marca por HTTP con ronda='bronce' y cierra la llave."""
    app, tatami_id, _ = entorno
    token = _token_admin(app)
    with app.app_context():
        from app.models.tatami import Tatami
        from app.models.llave import Llave
        from app.api.llaves import generar_estructura
        tatami = Tatami.query.get(tatami_id)
        llave = Llave(
            campeonato_id=tatami.campeonato_id, tatami_id=tatami_id, tipo="combate",
            nombre="LLAVE 4", estado="pendiente",
            estructura=generar_estructura([{"nombre": n} for n in ["A", "B", "C", "D"]]),
        )
        db.session.add(llave)
        db.session.commit()
        lid = llave.id

    cliente = app.test_client()

    def put(ronda, partido, ganador):
        return cliente.put(
            f"/api/llaves/{lid}/partido",
            json={"ronda": ronda, "partido": partido, "ganador": ganador},
            headers={"Authorization": f"Bearer {token}"},
        )

    assert put(0, 0, 1).status_code == 200       # semifinal 1
    assert put(0, 1, 1).status_code == 200       # semifinal 2
    r_final = put(1, 0, 1)                        # final
    assert r_final.status_code == 200
    # Falta el bronce → todavía no terminada
    assert r_final.get_json()["llave"]["estado"] != "terminada"

    rb = put("bronce", 0, 1)                      # partido por el 3er puesto
    assert rb.status_code == 200, rb.get_json()
    llave_json = rb.get_json()["llave"]
    assert llave_json["estructura"]["bronce"]["ganador"] == 1
    assert llave_json["estado"] == "terminada"

    from app.api.llaves import podio_llave
    podio = podio_llave(llave_json["estructura"])
    assert sorted(p["puesto"] for p in podio) == [1, 2, 3]


def test_configurar_combate_sin_activar(entorno):
    """Con el tatami desactivado se puede CONFIGURAR (jueces, nombres) pero NO
    iniciar el cronómetro."""
    app, tatami_id, _ = entorno
    cliente = socketio.test_client(
        app, namespace="/combate",
        query_string=f"tatami_id={tatami_id}&rol=arbitro",
    )
    # SIN activar el tatami: la configuración debe aplicar
    _emitir(cliente, "set_num_jueces", numJueces=2)   # sin nombres aún
    _emitir(cliente, "nombres", nombreHong="Pedro", nombreChung="Juan")
    estado = _ultimo_estado(cliente)
    assert estado["_tatami_activo"] is False
    assert estado["numJueces"] == 2
    assert estado["nombreHong"] == "Pedro"

    # El cronómetro NO arranca sin activar el tatami (acción ignorada)
    cliente.get_received("/combate")
    _emitir(cliente, "crono_start")
    cliente.emit("pedir", namespace="/combate")
    estado = _ultimo_estado(cliente)
    assert estado is not None
    assert estado["activo"] is False
    cliente.disconnect(namespace="/combate")


def test_activar_grupo_figuras_sin_activar(entorno):
    """El grupo de figuras se carga aunque el tatami esté desactivado."""
    app, tatami_id, _ = entorno
    fig_id = _crear_llave_figuras(app, tatami_id)
    cliente = socketio.test_client(
        app, namespace="/combate",
        query_string=f"tatami_id={tatami_id}&rol=arbitro",
    )
    # SIN activar el tatami
    _emitir(cliente, "activar_grupo_figuras", llave_id=fig_id)
    estado = _ultimo_estado(cliente)
    assert estado["_categoria"] == "figuras"
    assert estado["_tatami_activo"] is False
    assert len(estado["competidores"]) == 3
    cliente.disconnect(namespace="/combate")
