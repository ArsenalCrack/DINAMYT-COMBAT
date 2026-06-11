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
