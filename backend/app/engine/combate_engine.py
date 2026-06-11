"""
Motor de Combate — Migración de server.js aplicarEvento() a Python.
Fuente de verdad del servidor: aplica eventos delta atómicamente al estado.
"""

import copy
import time
from datetime import datetime, timezone


ALERTA_SUPERIORIDAD_DIFERENCIA = 12
ACCIONES_MARCADOR = {
    "punto_juez",
    "deshacer_juez",
    "especial",
    "deshacer_arbitro",
    "kyonggo",
    "gamjeum",
    "set_num_jueces",
}


def estado_inicial():
    """Retorna el estado inicial de un combate (equivale a estadoInicial() en server.js)."""
    return {
        "nombreHong": "Hong",
        "nombreChung": "Chung",
        "jueces": {
            "j1": {"hong": 0, "chung": 0},
            "j2": {"hong": 0, "chung": 0},
            "j3": {"hong": 0, "chung": 0},
            "j4": {"hong": 0, "chung": 0},
        },
        "nombresJueces": {"j1": "", "j2": "", "j3": "", "j4": ""},
        "numJueces": 4,
        "arbHong": 0,
        "arbChung": 0,
        "historial": [],
        "kyongHong": 0,
        "kyongChung": 0,
        "faltasHong": 0,
        "faltasChung": 0,
        "segundos": 120,
        "segundosMax": 120,
        "activo": False,
        "log": [],
        "alerta12Lanzada": False,
        "ronda": "r1",
        "oroResuelto": False,
        "oroPendienteAprobacion": False,
        "oroGanadorNombre": "",
        "oroGanadorColor": "",
        "ganadorManualColor": "",
        "ganadorManualMotivo": "",
        "ganadorPendienteCierre": False,
        "ganadorPendienteNombre": "",
        "ganadorPendienteColor": "",
        "ganadorPendienteMotivo": "",
    }


def _agregar_log(estado, txt, color):
    """Agrega una entrada al log del estado."""
    estado["log"].insert(0, {"txt": txt, "color": color, "ts": int(time.time() * 1000)})
    if len(estado["log"]) > 15:
        estado["log"] = estado["log"][:15]


def _momento_evento():
    """Timestamp real del evento para reportes y auditoria."""
    return datetime.now(timezone.utc).isoformat()


def _juez_meta_evento(ev, juez_fallback):
    """Metadata de juez inyectada por el socket para logs y reportes."""
    return {
        "juez_nombre": ev.get("juez_nombre"),
        "juez_email": ev.get("juez_email"),
        "juez_asignacion": ev.get("juez_asignacion") or juez_fallback,
        "juez_rol": ev.get("juez_rol") or juez_fallback,
        "juez_acceso": ev.get("juez_acceso"),
    }


def _juez_log_label(ev, juez_fallback):
    nombre = ev.get("juez_nombre") or juez_fallback
    email = ev.get("juez_email")
    asignacion = ev.get("juez_asignacion") or juez_fallback
    base = f"{asignacion}: {nombre}"
    return f"{base} <{email}>" if email else base


def verificar_superioridad_tecnica(estado):
    """Dispara una sola alerta cuando la diferencia llega a 12 puntos."""
    if estado.get("alerta12Lanzada"):
        return None

    marcador = calcular_marcador(estado)
    total_hong = marcador["total_hong"]
    total_chung = marcador["total_chung"]
    diff = abs(total_hong - total_chung)
    if diff < ALERTA_SUPERIORIDAD_DIFERENCIA:
        return None

    lider = "Hong" if total_hong > total_chung else "Chung"
    estado["alerta12Lanzada"] = True
    _agregar_log(
        estado,
        f"[ALERTA] Superioridad técnica — {lider} lidera por {diff:.1f} puntos",
        "arb",
    )
    return {
        "hong": f"{total_hong:.1f}",
        "chung": f"{total_chung:.1f}",
        "lider": lider,
        "diferencia": f"{diff:.1f}",
        "motivo": "Superioridad técnica",
    }


def aplicar_evento(estado, ev, broadcast_ganador_cb=None, broadcast_alerta_cb=None):
    """
    Aplica un evento delta al estado del combate.
    Traducción directa de aplicarEvento() en server.js.

    Args:
        estado: dict con el estado actual del combate
        ev: dict con {accion: str, ...datos}
        broadcast_ganador_cb: callback(nombre, color) para emitir ganador en Punto de Oro
        broadcast_alerta_cb: callback(payload) para emitir Superioridad técnica

    Returns:
        estado modificado
    """
    accion = ev.get("accion")

    if accion == "punto_juez":
        juez = ev.get("juez")
        color = ev.get("color")
        pts = ev.get("pts", 0)
        nombre = ev.get("nombre", "")

        if estado["ronda"] == "oro" and estado.get("oroResuelto"):
            return estado

        # Solo puntúan los jueces activos según numJueces (j3 no puede
        # puntuar en un combate configurado a 2 jueces).
        if juez and juez.startswith("j"):
            try:
                if int(juez[1:]) > int(estado.get("numJueces", 4)):
                    return estado
            except ValueError:
                return estado

        if juez in estado["jueces"]:
            estado["jueces"][juez][color] += pts
            estado["historial"].append({
                "juez": juez,
                "color": color,
                "pts": pts,
                "nombre": nombre,
                "tiempo": estado["segundos"],
                "ronda": estado["ronda"],
                "momento": _momento_evento(),
                **_juez_meta_evento(ev, juez),
            })
            emoji = "🔴" if color == "hong" else "🔵"
            _agregar_log(estado, f"{emoji} {nombre} +{pts} · {_juez_log_label(ev, juez)}", color)

            # Punto de Oro: bloquea puntos y espera aprobación del JC
            if estado["ronda"] == "oro" and not estado["oroResuelto"]:
                estado["oroResuelto"] = True
                estado["activo"] = False
                winner = estado["nombreHong"] if color == "hong" else estado["nombreChung"]
                estado["oroPendienteAprobacion"] = True
                estado["oroGanadorNombre"] = winner
                estado["oroGanadorColor"] = color
                _agregar_log(estado, f"🏆 Punto de Oro — {winner} (pendiente aprobación JC)", "arb")
                # NO emitir ganador aquí — esperar aprobar_oro

    elif accion == "deshacer_juez":
        juez = ev.get("juez")
        # Buscar la última entrada del juez en el historial
        for i in range(len(estado["historial"]) - 1, -1, -1):
            h = estado["historial"][i]
            if h.get("juez") == juez:
                estado["jueces"][h["juez"]][h["color"]] -= h["pts"]
                estado["historial"].pop(i)
                _agregar_log(estado, f"↩ Deshacer {juez}", "arb")
                break

    elif accion == "especial":
        color = ev.get("color")
        pts = ev.get("pts", 0)
        nombre = ev.get("nombre", "")

        if estado["ronda"] == "oro" and estado.get("oroResuelto"):
            return estado

        if color == "hong":
            estado["arbHong"] += pts
        else:
            estado["arbChung"] += pts

        estado["historial"].append({
            "juez": "arbitro",
            "color": color,
            "pts": pts,
            "nombre": nombre,
            "esEspecial": True,
            "tiempo": estado["segundos"],
            "ronda": estado["ronda"],
            "momento": _momento_evento(),
            **_juez_meta_evento(ev, "arbitro"),
        })
        emoji = "🔴" if color == "hong" else "🔵"
        _agregar_log(estado, f"{emoji} ⭐ {nombre} +{pts} · {_juez_log_label(ev, 'arbitro')}", color)

        # Punto de Oro con especiales
        if estado["ronda"] == "oro" and not estado["oroResuelto"]:
            estado["oroResuelto"] = True
            estado["activo"] = False
            winner = estado["nombreHong"] if color == "hong" else estado["nombreChung"]
            estado["oroPendienteAprobacion"] = True
            estado["oroGanadorNombre"] = winner
            estado["oroGanadorColor"] = color
            _agregar_log(estado, f"🏆 Punto de Oro — {winner} (pendiente aprobación JC)", "arb")

    elif accion == "deshacer_arbitro":
        color = ev.get("color")
        for i in range(len(estado["historial"]) - 1, -1, -1):
            h = estado["historial"][i]
            if h.get("juez") == "arbitro" and h.get("color") == color:
                if h.get("esKyongGo"):
                    if color == "hong":
                        estado["kyongHong"] = max(0, estado["kyongHong"] - 1)
                        estado["arbHong"] += 0.5
                    else:
                        estado["kyongChung"] = max(0, estado["kyongChung"] - 1)
                        estado["arbChung"] += 0.5
                elif h.get("esGamJeum"):
                    if color == "hong":
                        estado["arbHong"] += 1
                        estado["faltasHong"] = max(0, estado["faltasHong"] - 1)
                    else:
                        estado["arbChung"] += 1
                        estado["faltasChung"] = max(0, estado["faltasChung"] - 1)
                else:
                    if color == "hong":
                        estado["arbHong"] -= h["pts"]
                    else:
                        estado["arbChung"] -= h["pts"]
                estado["historial"].pop(i)
                _agregar_log(estado, f"↩ Deshacer árbitro: {color}", "arb")
                break

    elif accion == "kyonggo":
        color = ev.get("color")
        if color == "hong":
            estado["kyongHong"] += 1
            estado["arbHong"] -= 0.5
            estado["historial"].append({
                "juez": "arbitro",
                "color": "hong",
                "nombre": f"KyongGo #{estado['kyongHong']} (−0.5)",
                "pts": -0.5,
                "esKyongGo": True,
                "tiempo": estado["segundos"],
                "ronda": estado["ronda"],
                "momento": _momento_evento(),
                **_juez_meta_evento(ev, "arbitro"),
            })
            _agregar_log(estado, f"🔴 KyongGo #{estado['kyongHong']} −0.5 — Hong · {_juez_log_label(ev, 'arbitro')}", "hong")
        else:
            estado["kyongChung"] += 1
            estado["arbChung"] -= 0.5
            estado["historial"].append({
                "juez": "arbitro",
                "color": "chung",
                "nombre": f"KyongGo #{estado['kyongChung']} (−0.5)",
                "pts": -0.5,
                "esKyongGo": True,
                "tiempo": estado["segundos"],
                "ronda": estado["ronda"],
                "momento": _momento_evento(),
                **_juez_meta_evento(ev, "arbitro"),
            })
            _agregar_log(estado, f"🔵 KyongGo #{estado['kyongChung']} −0.5 — Chung · {_juez_log_label(ev, 'arbitro')}", "chung")

    elif accion == "gamjeum":
        color = ev.get("color")
        if color == "hong":
            estado["arbHong"] -= 1
            estado["faltasHong"] += 1
            estado["historial"].append({
                "juez": "arbitro",
                "color": "hong",
                "nombre": f"GamJeum #{estado['faltasHong']}",
                "pts": -1,
                "esGamJeum": True,
                "tiempo": estado["segundos"],
                "ronda": estado["ronda"],
                "momento": _momento_evento(),
                **_juez_meta_evento(ev, "arbitro"),
            })
        else:
            estado["arbChung"] -= 1
            estado["faltasChung"] += 1
            estado["historial"].append({
                "juez": "arbitro",
                "color": "chung",
                "nombre": f"GamJeum #{estado['faltasChung']}",
                "pts": -1,
                "esGamJeum": True,
                "tiempo": estado["segundos"],
                "ronda": estado["ronda"],
                "momento": _momento_evento(),
                **_juez_meta_evento(ev, "arbitro"),
            })
        emoji = "🔴" if color == "hong" else "🔵"
        _agregar_log(estado, f"{emoji} GamJeum −1 · {_juez_log_label(ev, 'arbitro')}", color)

    elif accion == "set_num_jueces":
        estado["numJueces"] = max(2, min(4, ev.get("numJueces", 4)))
        _agregar_log(estado, f"🔢 Réferis de esquina: {estado['numJueces']}", "arb")

    elif accion == "nombres":
        estado["nombreHong"] = ev.get("nombreHong") or "Hong"
        estado["nombreChung"] = ev.get("nombreChung") or "Chung"

    elif accion == "set_nombre_juez":
        juez = ev.get("juez")
        if juez and "nombresJueces" in estado:
            estado["nombresJueces"][juez] = ev.get("nombre", "")

    elif accion == "crono_start":
        estado["activo"] = True

    elif accion == "crono_pause":
        estado["activo"] = False

    elif accion == "crono_reset":
        estado["activo"] = False
        estado["segundos"] = ev.get("segundosMax", estado["segundosMax"])
        if ev.get("segundosMax"):
            estado["segundosMax"] = ev["segundosMax"]

    elif accion == "crono_seg":
        estado["segundos"] = ev.get("segundos", estado["segundos"])
        estado["activo"] = ev.get("activo", estado["activo"])

    elif accion == "ronda":
        estado["ronda"] = ev.get("ronda", "r1")
        _agregar_log(estado, f"🔢 Ronda: {estado['ronda']}", "arb")

    elif accion == "aprobar_oro":
        # El Juez Central confirma el ganador del Punto de Oro
        if estado.get("oroPendienteAprobacion"):
            estado["oroPendienteAprobacion"] = False
            winner = estado.get("oroGanadorNombre", "")
            color = estado.get("oroGanadorColor", "")
            estado["ganadorManualColor"] = color
            estado["ganadorManualMotivo"] = "Punto de Oro"
            estado["ganadorPendienteCierre"] = True
            estado["ganadorPendienteNombre"] = winner
            estado["ganadorPendienteColor"] = color
            estado["ganadorPendienteMotivo"] = "Punto de Oro"
            _agregar_log(estado, f"🏆 SUNG — {winner.upper()} GANA (Punto de Oro)", "arb")
            if broadcast_ganador_cb:
                broadcast_ganador_cb(winner, color)

    elif accion == "declarar_ganador":
        color = ev.get("color")
        if color in ("hong", "chung"):
            winner = estado["nombreHong"] if color == "hong" else estado["nombreChung"]
            motivo = ev.get("motivo") or "Decisión del Juez Central"
            estado["ganadorManualColor"] = color
            estado["ganadorManualMotivo"] = motivo
            estado["ganadorPendienteCierre"] = True
            estado["ganadorPendienteNombre"] = winner
            estado["ganadorPendienteColor"] = color
            estado["ganadorPendienteMotivo"] = motivo
            estado["activo"] = False
            estado["oroPendienteAprobacion"] = False
            estado["historial"].append({
                "juez": "arbitro",
                "color": color,
                "pts": 0,
                "nombre": motivo,
                "esDecision": True,
                "tiempo": estado["segundos"],
                "ronda": estado["ronda"],
                "momento": _momento_evento(),
                **_juez_meta_evento(ev, "arbitro"),
            })
            _agregar_log(estado, f"🏆 SUNG — {winner.upper()} GANA ({motivo})", "arb")
            if broadcast_ganador_cb:
                broadcast_ganador_cb(winner, color, motivo)

    elif accion == "cerrar_ganador":
        if estado.get("ganadorPendienteCierre"):
            estado["ganadorPendienteCierre"] = False
            estado["ganadorPendienteNombre"] = ""
            estado["ganadorPendienteColor"] = ""
            estado["ganadorPendienteMotivo"] = ""
            _agregar_log(estado, "Ganador reconocido por el Juez Central", "arb")

    elif accion == "rechazar_oro":
        # Permite continuar si el Juez Central no valida el primer punto marcado.
        if estado.get("oroPendienteAprobacion"):
            estado["oroPendienteAprobacion"] = False
            estado["oroResuelto"] = False
            estado["oroGanadorNombre"] = ""
            estado["oroGanadorColor"] = ""
            _agregar_log(estado, "Punto de Oro rechazado por el Juez Central", "arb")

    elif accion == "reset":
        seg_max = estado["segundosMax"]
        nuevo = estado_inicial()
        estado.update(nuevo)
        estado["segundosMax"] = seg_max
        estado["segundos"] = seg_max
        estado["oroResuelto"] = False
        _agregar_log(estado, "↺ Reset", "arb")

    if accion in ACCIONES_MARCADOR:
        alerta = verificar_superioridad_tecnica(estado)
        if alerta and broadcast_alerta_cb:
            broadcast_alerta_cb(alerta)

    # Limitar historial a 200 entradas
    if len(estado["historial"]) > 200:
        estado["historial"] = estado["historial"][-200:]

    return estado


def calcular_marcador(estado):
    """Calcula los marcadores finales del combate."""
    n = estado.get("numJueces", 4) or 4
    # Solo cuentan los jueces activos: la suma y el divisor deben coincidir.
    jueces_activos = [f"j{i}" for i in range(1, n + 1)]

    esq_hong = sum(
        estado["jueces"].get(j, {}).get("hong", 0) for j in jueces_activos
    ) / n
    esq_chung = sum(
        estado["jueces"].get(j, {}).get("chung", 0) for j in jueces_activos
    ) / n

    total_hong = esq_hong + estado["arbHong"]
    total_chung = esq_chung + estado["arbChung"]

    return {
        "esq_hong": round(esq_hong, 1),
        "esq_chung": round(esq_chung, 1),
        "total_hong": round(total_hong, 1),
        "total_chung": round(total_chung, 1),
    }


def guardar_combate_snapshot(estado):
    """Crea un snapshot del combate actual para guardar en la base de datos."""
    marcador = calcular_marcador(estado)

    return {
        "nombre_hong": estado["nombreHong"],
        "nombre_chung": estado["nombreChung"],
        "marcador_hong": marcador["total_hong"],
        "marcador_chung": marcador["total_chung"],
        "esq_hong": marcador["esq_hong"],
        "esq_chung": marcador["esq_chung"],
        "arb_hong": estado["arbHong"],
        "arb_chung": estado["arbChung"],
        "kyong_hong": estado["kyongHong"],
        "kyong_chung": estado["kyongChung"],
        "faltas_hong": estado["faltasHong"],
        "faltas_chung": estado["faltasChung"],
        "num_jueces": estado["numJueces"],
        "duracion_segundos": estado["segundosMax"],
        "ronda_final": estado["ronda"],
        "historial_completo": copy.deepcopy(estado["historial"]),
        "jueces_detalle": {
            "jueces": copy.deepcopy(estado["jueces"]),
            "nombres": copy.deepcopy(estado.get("nombresJueces", {})),
            "resultado": {
                "ganador_manual": estado.get("ganadorManualColor") or None,
                "motivo": estado.get("ganadorManualMotivo") or None,
            },
        },
        "ganador_manual": estado.get("ganadorManualColor") or None,
        "motivo_ganador": estado.get("ganadorManualMotivo") or None,
    }
