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
def entorno():
    """App + DB en memoria con campeonato, tatami y llave de 2 competidores."""
    app = create_app("development")
    assert "dinamyt.db" not in str(app.config["SQLALCHEMY_DATABASE_URI"])
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
