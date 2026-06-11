"""
Tests de los motores de DINAMYT.
Ejecutar desde backend/:  python -m pytest tests/ -v
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.engine.combate_engine import (  # noqa: E402
    estado_inicial,
    aplicar_evento,
    calcular_marcador,
)
from app.engine.figuras_engine import (  # noqa: E402
    estado_inicial_figuras,
    aplicar_evento_figuras,
    puntuaciones_completas,
    calcular_ranking,
    empates_en_ranking,
    _parse_puntuacion,
)
from app.api.llaves import (  # noqa: E402
    generar_estructura,
    _avanzar,
    _limpiar_descendientes,
    siguiente_partido,
    registrar_resultado,
    partidos_jugables,
    nombre_ronda,
)
from app.security import intento_bloqueado, limpiar_intentos  # noqa: E402


# ══════════════════════════════════════════════════════════════════
#  MOTOR DE COMBATE
# ══════════════════════════════════════════════════════════════════

class TestCombate:
    def test_punto_juez_suma(self):
        e = estado_inicial()
        aplicar_evento(e, {"accion": "punto_juez", "juez": "j1", "color": "hong", "pts": 2, "nombre": "x"})
        assert e["jueces"]["j1"]["hong"] == 2
        assert len(e["historial"]) == 1

    def test_juez_fuera_de_configuracion_no_puntua(self):
        e = estado_inicial()
        aplicar_evento(e, {"accion": "set_num_jueces", "numJueces": 2})
        aplicar_evento(e, {"accion": "punto_juez", "juez": "j3", "color": "hong", "pts": 3, "nombre": "x"})
        assert e["jueces"]["j3"]["hong"] == 0
        assert len(e["historial"]) == 0

    def test_marcador_respeta_num_jueces(self):
        e = estado_inicial()
        aplicar_evento(e, {"accion": "set_num_jueces", "numJueces": 2})
        aplicar_evento(e, {"accion": "punto_juez", "juez": "j1", "color": "hong", "pts": 2, "nombre": "x"})
        m = calcular_marcador(e)
        assert m["esq_hong"] == 1.0  # 2 puntos / 2 jueces

    def test_kyonggo_resta_medio(self):
        e = estado_inicial()
        aplicar_evento(e, {"accion": "kyonggo", "color": "hong"})
        assert e["kyongHong"] == 1
        assert e["arbHong"] == -0.5

    def test_punto_de_oro_requiere_aprobacion(self):
        e = estado_inicial()
        aplicar_evento(e, {"accion": "ronda", "ronda": "oro"})
        aplicar_evento(e, {"accion": "punto_juez", "juez": "j1", "color": "chung", "pts": 1, "nombre": "x"})
        assert e["oroResuelto"] is True
        assert e["oroPendienteAprobacion"] is True
        # Rechazar reabre el combate
        aplicar_evento(e, {"accion": "rechazar_oro"})
        assert e["oroResuelto"] is False

    def test_reset_conserva_duracion(self):
        e = estado_inicial()
        aplicar_evento(e, {"accion": "crono_reset", "segundosMax": 90})
        aplicar_evento(e, {"accion": "punto_juez", "juez": "j1", "color": "hong", "pts": 1, "nombre": "x"})
        aplicar_evento(e, {"accion": "reset"})
        assert e["segundosMax"] == 90
        assert e["jueces"]["j1"]["hong"] == 0


# ══════════════════════════════════════════════════════════════════
#  MOTOR DE FIGURAS
# ══════════════════════════════════════════════════════════════════

def _figuras_listas(num_jueces=2):
    e = estado_inicial_figuras()
    e["nombre_categoria"] = "Figuras Test"
    aplicar_evento_figuras(e, {"accion": "set_num_jueces", "num_jueces": num_jueces})
    aplicar_evento_figuras(e, {"accion": "agregar_competidor", "nombre": "Ana"})
    aplicar_evento_figuras(e, {"accion": "agregar_competidor", "nombre": "Luis"})
    return e


def _puntuar_completo(e, comp_id, jueces):
    for j in jueces:
        aplicar_evento_figuras(e, {"accion": "puntuar", "juez_id": j, "competidor_id": comp_id, "valor": "8.00"})
        aplicar_evento_figuras(e, {"accion": "confirmar_puntuacion", "juez_id": j, "competidor_id": comp_id})


class TestFiguras:
    def test_max_cuatro_jueces(self):
        e = estado_inicial_figuras()
        aplicar_evento_figuras(e, {"accion": "set_num_jueces", "num_jueces": 7})
        assert e["num_jueces"] == 4

    def test_puntuacion_invalida_rechazada(self):
        assert _parse_puntuacion("8.5") is None       # falta un decimal
        assert _parse_puntuacion("10.00") is None     # fuera de rango
        assert _parse_puntuacion("8.75") == 8.75

    def test_no_cambiar_turno_con_pendientes(self):
        e = _figuras_listas()
        aplicar_evento_figuras(e, {"accion": "activar_competidor", "competidor_id": 1})
        _puntuar_completo(e, 1, ["j1"])  # falta j2
        aplicar_evento_figuras(e, {"accion": "activar_competidor", "competidor_id": 2})
        assert e["competidor_activo_id"] == 1

    def test_podio_automatico_al_completar(self):
        e = _figuras_listas()
        aplicar_evento_figuras(e, {"accion": "activar_competidor", "competidor_id": 1})
        _puntuar_completo(e, 1, ["j1", "j2"])
        assert e["finalizado"] is False
        aplicar_evento_figuras(e, {"accion": "activar_competidor", "competidor_id": 2})
        _puntuar_completo(e, 2, ["j1", "j2"])
        assert puntuaciones_completas(e) is True
        assert e["finalizado"] is True

    def test_finalizar_bloqueado_si_incompleto(self):
        e = _figuras_listas()
        aplicar_evento_figuras(e, {"accion": "finalizar"})
        assert e["finalizado"] is False

    def test_puntuacion_confirmada_es_inmutable(self):
        e = _figuras_listas()
        aplicar_evento_figuras(e, {"accion": "activar_competidor", "competidor_id": 1})
        _puntuar_completo(e, 1, ["j1"])
        aplicar_evento_figuras(e, {"accion": "puntuar", "juez_id": "j1", "competidor_id": 1, "valor": "1.00"})
        assert e["puntuaciones"]["1"]["j1"] == 8.00


# ══════════════════════════════════════════════════════════════════
#  LLAVES DE ELIMINACIÓN
# ══════════════════════════════════════════════════════════════════

class TestLlaves:
    def test_bracket_con_byes(self):
        e = generar_estructura([{"nombre": f"C{i}"} for i in range(5)])
        assert len(e["rondas"]) == 3          # bracket de 8
        assert len(e["rondas"][0]) == 4
        # ningún partido de ronda 0 con comp1 vacío
        assert all(p["comp1"] for p in e["rondas"][0])
        # 3 byes avanzados a ronda 1
        avanzados = sum(
            1 for p in e["rondas"][1] for s in ("comp1", "comp2") if p[s]
        )
        assert avanzados == 3

    def test_torneo_completo_produce_campeon(self):
        e = generar_estructura([{"nombre": f"C{i}"} for i in range(8)])
        for r in range(len(e["rondas"])):
            for i, p in enumerate(e["rondas"][r]):
                if p["ganador"] is None:
                    p["ganador"] = 1 if p["comp1"] else 2
                    _avanzar(e, r, i)
        assert e["campeon"] is not None

    def test_correccion_limpia_descendientes(self):
        e = generar_estructura([{"nombre": "A"}, {"nombre": "B"}, {"nombre": "C"}, {"nombre": "D"}])
        # jugar ronda 0
        for i, p in enumerate(e["rondas"][0]):
            p["ganador"] = 1
            _avanzar(e, 0, i)
        # jugar final
        e["rondas"][1][0]["ganador"] = 1
        _avanzar(e, 1, 0)
        assert e["campeon"] is not None
        # corregir un partido de ronda 0 → el campeón debe invalidarse
        _limpiar_descendientes(e, 0, 0)
        assert e["campeon"] is None
        assert e["rondas"][1][0]["ganador"] is None


def _puntuar(e, comp_id, juez, valor):
    aplicar_evento_figuras(e, {"accion": "activar_competidor", "competidor_id": comp_id})
    aplicar_evento_figuras(e, {"accion": "puntuar", "juez_id": juez, "competidor_id": comp_id, "valor": valor})
    aplicar_evento_figuras(e, {"accion": "confirmar_puntuacion", "juez_id": juez, "competidor_id": comp_id})


class TestRankingFiguras:
    def _base(self, nombres_y_flags):
        e = estado_inicial_figuras()
        e["nombre_categoria"] = "Test"
        aplicar_evento_figuras(e, {"accion": "set_num_jueces", "num_jueces": 2})
        for nombre, especial in nombres_y_flags:
            aplicar_evento_figuras(e, {
                "accion": "agregar_competidor", "nombre": nombre, "especial": especial,
            })
        return e

    def test_especial_tiene_su_propio_primer_puesto(self):
        # El especial recibe el 1° aparte; el podio normal no se desplaza
        e = self._base([("Esp", True), ("Ana", False), ("Luis", False)])
        for cid, notas in ((1, ("5.00", "5.00")), (2, ("9.00", "9.00")), (3, ("8.00", "8.00"))):
            for juez, valor in zip(("j1", "j2"), notas):
                _puntuar(e, cid, juez, valor)
        ranking = calcular_ranking(e)
        esp = next(r for r in ranking if r["nombre"] == "Esp")
        ana = next(r for r in ranking if r["nombre"] == "Ana")
        luis = next(r for r in ranking if r["nombre"] == "Luis")
        assert esp["puesto"] == 1 and esp.get("especial") is True
        assert ana["puesto"] == 1 and not ana.get("especial")  # dos primeros puestos
        assert luis["puesto"] == 2
        # El especial va primero en la lista
        assert ranking[0]["nombre"] == "Esp"

    def test_dos_especiales_ambos_primer_puesto(self):
        # TODOS los especiales quedan de primeros sin importar su puntuación
        e = self._base([("EspA", True), ("EspB", True), ("Ana", False)])
        for cid, valor in ((1, "9.00"), (2, "4.00"), (3, "7.00")):
            _puntuar(e, cid, "j1", valor)
            _puntuar(e, cid, "j2", valor)
        ranking = calcular_ranking(e)
        puestos = {r["nombre"]: r["puesto"] for r in ranking}
        assert puestos["EspA"] == 1
        assert puestos["EspB"] == 1, "el especial con menor nota también es 1°"
        assert puestos["Ana"] == 1, "el podio normal no se afecta"
        # Los especiales nunca quedan marcados en empate (no se reevalúan)
        assert all(not r["empate"] for r in ranking if r.get("especial"))

    def test_mismo_total_es_empate_real(self):
        # Mismo total (16.00) aunque la distribución de notas difiera:
        # NO se desempata por la nota más alta, es empate real
        e = self._base([("Ana", False), ("Luis", False)])
        _puntuar(e, 1, "j1", "9.00")
        _puntuar(e, 1, "j2", "7.00")
        _puntuar(e, 2, "j1", "8.00")
        _puntuar(e, 2, "j2", "8.00")
        ranking = calcular_ranking(e)
        assert ranking[0]["puesto"] == 1 and ranking[0]["empate"] is True
        assert ranking[1]["puesto"] == 1 and ranking[1]["empate"] is True

    def test_empate_real_comparte_puesto(self):
        # Notas idénticas → comparten puesto y el siguiente se salta (1,1,3)
        e = self._base([("Ana", False), ("Luis", False), ("Caro", False)])
        for cid in (1, 2):
            _puntuar(e, cid, "j1", "8.00")
            _puntuar(e, cid, "j2", "8.00")
        _puntuar(e, 3, "j1", "7.00")
        _puntuar(e, 3, "j2", "7.00")
        ranking = calcular_ranking(e)
        puestos = {r["nombre"]: (r["puesto"], r["empate"]) for r in ranking}
        assert puestos["Ana"] == (1, True)
        assert puestos["Luis"] == (1, True)
        assert puestos["Caro"] == (3, False)
        # El log del podio recibe el empate detectado
        grupos = empates_en_ranking(ranking)
        assert ("normal", 1) in grupos
        assert sorted(grupos[("normal", 1)]) == ["Ana", "Luis"]

    def test_podio_completo_incluye_especiales(self):
        e = self._base([("Esp", True), ("Ana", False)])
        _puntuar(e, 2, "j1", "8.00")
        _puntuar(e, 2, "j2", "8.00")
        assert puntuaciones_completas(e) is False, "falta calificar al especial"
        _puntuar(e, 1, "j1", "6.00")
        _puntuar(e, 1, "j2", "6.00")
        assert puntuaciones_completas(e) is True
        assert e["finalizado"] is True

    def test_reevaluar_empate_limpia_solo_a_los_empatados(self):
        # Esp (especial, empata con nadie de su podio), Ana y Luis empatados,
        # Caro de tercera
        e = self._base([("Esp", True), ("Ana", False), ("Luis", False), ("Caro", False)])
        for cid, valor in ((1, "5.00"), (2, "8.00"), (3, "8.00"), (4, "7.00")):
            _puntuar(e, cid, "j1", valor)
            _puntuar(e, cid, "j2", valor)
        assert e["finalizado"] is True

        aplicar_evento_figuras(e, {"accion": "reevaluar_empate"})

        # Solo los empatados (Ana=2, Luis=3) quedan sin notas
        assert e["puntuaciones"]["2"] == {} and e["puntuaciones_confirmadas"]["2"] == {}
        assert e["puntuaciones"]["3"] == {} and e["puntuaciones_confirmadas"]["3"] == {}
        # La especial y la tercera conservan sus notas
        assert e["puntuaciones"]["1"] != {} and e["puntuaciones"]["4"] != {}
        # El podio se oculta mientras dura el desempate
        assert e["finalizado"] is False
        assert puntuaciones_completas(e) is False
        # Queda constancia para el reporte
        assert len(e["desempates"]) == 1
        assert sorted(e["desempates"][0]["nombres"]) == ["Ana", "Luis"]
        # Solo los empatados se pueden activar durante el desempate
        assert sorted(e["en_desempate"]) == [2, 3]
        aplicar_evento_figuras(e, {"accion": "activar_competidor", "competidor_id": 4})
        assert e["competidor_activo_id"] is None, "Caro no participa del desempate"
        aplicar_evento_figuras(e, {"accion": "activar_competidor", "competidor_id": 1})
        assert e["competidor_activo_id"] is None, "la especial tampoco"

        # Reevaluación: ahora Ana gana — el podio vuelve resuelto
        _puntuar(e, 2, "j1", "9.00")
        _puntuar(e, 2, "j2", "9.00")
        _puntuar(e, 3, "j1", "8.00")
        _puntuar(e, 3, "j2", "8.00")
        assert e["finalizado"] is True
        assert e["en_desempate"] == [], "el desempate quedó resuelto"
        ranking = calcular_ranking(e)
        puestos = {r["nombre"]: r["puesto"] for r in ranking if not r.get("especial")}
        assert puestos == {"Ana": 1, "Luis": 2, "Caro": 3}

        # La constancia viaja en el snapshot que se guarda en reportes
        from app.engine.figuras_engine import guardar_figuras_snapshot
        snap = guardar_figuras_snapshot(e)
        assert len(snap["desempates"]) == 1

    def test_reevaluar_sin_empate_no_hace_nada(self):
        e = self._base([("Ana", False), ("Luis", False)])
        _puntuar(e, 1, "j1", "9.00")
        _puntuar(e, 1, "j2", "9.00")
        _puntuar(e, 2, "j1", "8.00")
        _puntuar(e, 2, "j2", "8.00")
        aplicar_evento_figuras(e, {"accion": "reevaluar_empate"})
        assert e["finalizado"] is True
        assert e["puntuaciones"]["1"] != {}
        assert e["desempates"] == []


# ══════════════════════════════════════════════════════════════════
#  SIGUIENTE COMBATE (integración con el Juez Central)
# ══════════════════════════════════════════════════════════════════

class TestSiguienteCombate:
    def test_nombres_de_ronda(self):
        assert nombre_ronda(2, 3) == "Final"
        assert nombre_ronda(1, 3) == "Semifinal"
        assert nombre_ronda(0, 3) == "Cuartos"
        assert nombre_ronda(0, 4) == "Octavos"

    def test_siguiente_en_orden(self):
        e = generar_estructura([{"nombre": f"C{i}"} for i in range(8)])
        sig = siguiente_partido(e)
        assert sig is not None
        assert sig[0] == 0  # primera ronda primero

    def test_registrar_resultado_avanza_y_marca_descanso(self):
        e = generar_estructura([{"nombre": f"C{i}"} for i in range(4)])
        r, i, p = siguiente_partido(e)
        registrar_resultado(e, r, i, 1)
        ganador = p["comp1"]
        # el ganador quedó en la siguiente ronda
        assert any(
            (m["comp1"] and m["comp1"]["id"] == ganador["id"])
            or (m["comp2"] and m["comp2"]["id"] == ganador["id"])
            for m in e["rondas"][1]
        )
        # quienes acaban de pelear quedan registrados para descanso
        assert set(e["ultimo_jugado"]) == {p["comp1"]["id"], p["comp2"]["id"]}

    def test_evita_que_ganador_pelee_de_inmediato(self):
        # 4 competidores: tras jugar el partido 0, el siguiente debe ser el
        # partido 1 (los del partido 0 descansan).
        e = generar_estructura([{"nombre": f"C{i}"} for i in range(4)])
        r0, i0, p0 = siguiente_partido(e)
        ids_p0 = {p0["comp1"]["id"], p0["comp2"]["id"]}
        registrar_resultado(e, r0, i0, 1)
        sig = siguiente_partido(e)
        assert sig is not None
        ids_sig = {sig[2]["comp1"]["id"], sig[2]["comp2"]["id"]}
        assert not (ids_sig & ids_p0), "el ganador no debe pelear de inmediato"

    def test_acepta_consecutivo_si_no_hay_opcion(self):
        # Con 2 competidores la final es inevitablemente consecutiva… pero
        # con 3, tras el único partido de ronda 0, la final incluye al ganador
        # (no hay otra opción) y debe sugerirse igualmente.
        e = generar_estructura([{"nombre": "A"}, {"nombre": "B"}, {"nombre": "C"}])
        r, i, _p = siguiente_partido(e)
        registrar_resultado(e, r, i, 1)
        sig = siguiente_partido(e)
        assert sig is not None, "debe sugerir la final aunque haya repetición"

    def test_torneo_completo_via_siguiente(self):
        e = generar_estructura([{"nombre": f"C{i}"} for i in range(6)])
        vueltas = 0
        while True:
            sig = siguiente_partido(e)
            if sig is None:
                break
            r, i, _ = sig
            registrar_resultado(e, r, i, 1)
            vueltas += 1
            assert vueltas < 20, "bucle infinito"
        assert e["campeon"] is not None
        assert len(partidos_jugables(e)) == 0


# ══════════════════════════════════════════════════════════════════
#  LÍMITE DE INTENTOS
# ══════════════════════════════════════════════════════════════════

class TestRateLimiter:
    def test_bloquea_tras_limite(self):
        limpiar_intentos("t:1")
        for _ in range(3):
            assert intento_bloqueado("t:1", 3, 60) is False
        assert intento_bloqueado("t:1", 3, 60) is True

    def test_limpiar_reinicia(self):
        limpiar_intentos("t:2")
        for _ in range(3):
            intento_bloqueado("t:2", 3, 60)
        limpiar_intentos("t:2")
        assert intento_bloqueado("t:2", 3, 60) is False
