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
from app.api.llaves import generar_estructura, _avanzar, _limpiar_descendientes  # noqa: E402
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
