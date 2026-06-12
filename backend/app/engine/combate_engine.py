"""
Motor de Combate — Migración de server.js aplicarEvento() a Python.
Fuente de verdad del servidor: aplica eventos delta atómicamente al estado.
"""

import copy
import time
from datetime import datetime, timezone


ALERTA_SUPERIORIDAD_DIFERENCIA = 12

# Descalificación automática (debe coincidir con COMBATE_CONFIG en
# seeds/seed_categorias.py: faltas.max_kyonggo_dq y faltas.max_gamjeum_dq)
MAX_KYONGGO_DQ = 6
MAX_GAMJEUM_DQ = 3
ACCIONES_MARCADOR = {
    "punto_juez",
    "deshacer_juez",
    "especial",
    "deshacer_arbitro",
    "kyonggo",
    "gamjeum",
    "set_num_jueces",
}

# Con la alerta de superioridad abierta el combate queda EN PAUSA: nada que
# altere marcador, faltas o cronómetro hasta que el JC la cierre
# (cerrar_alerta12). El JC sí puede declarar ganador o descalificar.
ACCIONES_BLOQUEADAS_DURANTE_ALERTA = {
    "punto_juez",
    "deshacer_juez",
    "especial",
    "deshacer_arbitro",
    "kyonggo",
    "gamjeum",
    "crono_start",
    "ronda",
    "set_num_jueces",
    "nombres",
}

# Con ganador ya declarado el combate está cerrado: solo se permite cerrarlo
# (Nuevo Combate / Reset) o reconocer el aviso. Todo lo que altere marcador,
# nombres o cronómetro queda bloqueado hasta entonces.
ACCIONES_BLOQUEADAS_TRAS_GANADOR = {
    "punto_juez",
    "deshacer_juez",
    "especial",
    "deshacer_arbitro",
    "kyonggo",
    "gamjeum",
    "crono_start",
    "ronda",
    "declarar_ganador",
    "descalificar",
    "set_num_jueces",
    "nombres",
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
        # Alerta de superioridad visible en todos los dispositivos hasta que
        # el Juez Central la cierre (accion cerrar_alerta12).
        "alerta12Data": None,
        "ronda": "r1",
        "oroResuelto": False,
        "oroPendienteAprobacion": False,
        "oroGanadorNombre": "",
        "oroGanadorColor": "",
        # El punto de oro NO se suma al marcador hasta que el JC lo apruebe:
        # aquí espera la entrada de historial lista para aplicarse.
        "oroPuntoPendiente": None,
        "oroPuntoDetalle": "",
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


def _registrar_oro_pendiente(estado, entrada, color, detalle):
    """
    Punto de Oro: el punto queda EN ESPERA (sin tocar marcador ni historial)
    hasta que el Juez Central lo apruebe. Si lo rechaza, se descarta.
    """
    estado["oroResuelto"] = True
    estado["activo"] = False
    winner = estado["nombreHong"] if color == "hong" else estado["nombreChung"]
    estado["oroPendienteAprobacion"] = True
    estado["oroGanadorNombre"] = winner
    estado["oroGanadorColor"] = color
    estado["oroPuntoPendiente"] = entrada
    estado["oroPuntoDetalle"] = detalle
    _agregar_log(
        estado,
        f"🏆 Punto de Oro — {detalle} (sin sumar, pendiente aprobación JC)",
        "arb",
    )


def _descalificar(estado, color_infractor, razon, ev,
                  broadcast_ganador_cb=None, broadcast_derrota_cb=None):
    """
    Descalificación automática por acumulación de faltas: el infractor
    pierde y el rival queda declarado ganador (mismo flujo que
    declarar_ganador, pendiente de cierre por el Juez Central).
    """
    perdedor = estado["nombreHong"] if color_infractor == "hong" else estado["nombreChung"]
    rival_color = "chung" if color_infractor == "hong" else "hong"
    winner = estado["nombreHong"] if rival_color == "hong" else estado["nombreChung"]
    motivo = f"Descalificación del oponente — {razon}"

    estado["activo"] = False
    estado["oroPendienteAprobacion"] = False
    estado["alerta12Data"] = None
    estado["ganadorManualColor"] = rival_color
    estado["ganadorManualMotivo"] = motivo
    estado["ganadorPendienteCierre"] = True
    estado["ganadorPendienteNombre"] = winner
    estado["ganadorPendienteColor"] = rival_color
    estado["ganadorPendienteMotivo"] = motivo
    estado["historial"].append({
        "juez": "arbitro",
        "color": rival_color,
        "pts": 0,
        "nombre": motivo,
        "esDecision": True,
        "tiempo": estado["segundos"],
        "ronda": estado["ronda"],
        "momento": _momento_evento(),
        **_juez_meta_evento(ev, "arbitro"),
    })
    _agregar_log(estado, f"🚫 DESCALIFICACIÓN — {perdedor.upper()} ({razon})", "arb")
    _agregar_log(estado, f"🏆 SUNG — {winner.upper()} GANA ({motivo})", "arb")
    if broadcast_derrota_cb:
        broadcast_derrota_cb(perdedor, razon)
    if broadcast_ganador_cb:
        broadcast_ganador_cb(winner, rival_color, motivo)


def verificar_superioridad_tecnica(estado):
    """Dispara una sola alerta cuando la diferencia llega a 12 puntos."""
    if estado.get("alerta12Lanzada"):
        return None
    # Con el combate ya decidido la alerta no aporta nada
    if estado.get("ganadorManualColor"):
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
    alerta = {
        "hong": f"{total_hong:.1f}",
        "chung": f"{total_chung:.1f}",
        "lider": lider,
        "diferencia": f"{diff:.1f}",
        "motivo": "Superioridad técnica",
    }
    # La alerta queda en el estado: visible para todos hasta que el JC la
    # cierre, y el combate se pausa (cronómetro detenido, acciones bloqueadas).
    estado["alerta12Data"] = alerta
    estado["activo"] = False
    return alerta


def aplicar_evento(estado, ev, broadcast_ganador_cb=None, broadcast_alerta_cb=None,
                   broadcast_derrota_cb=None):
    """
    Aplica un evento delta al estado del combate.
    Traducción directa de aplicarEvento() en server.js.

    Args:
        estado: dict con el estado actual del combate
        ev: dict con {accion: str, ...datos}
        broadcast_ganador_cb: callback(nombre, color) para emitir ganador en Punto de Oro
        broadcast_alerta_cb: callback(payload) para emitir Superioridad técnica
        broadcast_derrota_cb: callback(perdedor, razon) para la descalificación automática

    Returns:
        estado modificado
    """
    accion = ev.get("accion")

    # Combate cerrado: con ganador declarado solo proceden Reset / cierre.
    if estado.get("ganadorManualColor") and accion in ACCIONES_BLOQUEADAS_TRAS_GANADOR:
        return estado

    # Combate en pausa por alerta de superioridad: espera al Juez Central.
    if estado.get("alerta12Data") and accion in ACCIONES_BLOQUEADAS_DURANTE_ALERTA:
        return estado

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
            entrada = {
                "juez": juez,
                "color": color,
                "pts": pts,
                "nombre": nombre,
                "tiempo": estado["segundos"],
                "ronda": estado["ronda"],
                "momento": _momento_evento(),
                **_juez_meta_evento(ev, juez),
            }

            # Punto de Oro: el punto queda pendiente, el JC decide si vale
            if estado["ronda"] == "oro":
                detalle = f"{nombre} +{pts} · {_juez_log_label(ev, juez)}"
                _registrar_oro_pendiente(estado, entrada, color, detalle)
                return estado

            estado["jueces"][juez][color] += pts
            estado["historial"].append(entrada)
            emoji = "🔴" if color == "hong" else "🔵"
            _agregar_log(estado, f"{emoji} {nombre} +{pts} · {_juez_log_label(ev, juez)}", color)

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

        entrada = {
            "juez": "arbitro",
            "color": color,
            "pts": pts,
            "nombre": nombre,
            "esEspecial": True,
            "tiempo": estado["segundos"],
            "ronda": estado["ronda"],
            "momento": _momento_evento(),
            **_juez_meta_evento(ev, "arbitro"),
        }

        # Punto de Oro con especiales: también espera aprobación
        if estado["ronda"] == "oro":
            detalle = f"⭐ {nombre} +{pts} · {_juez_log_label(ev, 'arbitro')}"
            _registrar_oro_pendiente(estado, entrada, color, detalle)
            return estado

        if color == "hong":
            estado["arbHong"] += pts
        else:
            estado["arbChung"] += pts

        estado["historial"].append(entrada)
        emoji = "🔴" if color == "hong" else "🔵"
        _agregar_log(estado, f"{emoji} ⭐ {nombre} +{pts} · {_juez_log_label(ev, 'arbitro')}", color)

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
            if estado["kyongHong"] >= MAX_KYONGGO_DQ:
                _descalificar(estado, "hong", f"{MAX_KYONGGO_DQ} advertencias (KyongGo)",
                              ev, broadcast_ganador_cb, broadcast_derrota_cb)
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
            if estado["kyongChung"] >= MAX_KYONGGO_DQ:
                _descalificar(estado, "chung", f"{MAX_KYONGGO_DQ} advertencias (KyongGo)",
                              ev, broadcast_ganador_cb, broadcast_derrota_cb)

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
        faltas = estado["faltasHong"] if color == "hong" else estado["faltasChung"]
        if faltas >= MAX_GAMJEUM_DQ:
            _descalificar(estado, color, f"{MAX_GAMJEUM_DQ} GamJeum",
                          ev, broadcast_ganador_cb, broadcast_derrota_cb)

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
        # El Juez Central confirma: AHORA se suma el punto y se da el ganador
        if estado.get("oroPendienteAprobacion"):
            pendiente = estado.get("oroPuntoPendiente")
            if pendiente:
                if pendiente.get("esEspecial"):
                    if pendiente.get("color") == "hong":
                        estado["arbHong"] += pendiente.get("pts", 0)
                    else:
                        estado["arbChung"] += pendiente.get("pts", 0)
                elif pendiente.get("juez") in estado["jueces"]:
                    estado["jueces"][pendiente["juez"]][pendiente["color"]] += pendiente.get("pts", 0)
                estado["historial"].append(pendiente)
                emoji = "🔴" if pendiente.get("color") == "hong" else "🔵"
                _agregar_log(
                    estado,
                    f"{emoji} {pendiente.get('nombre', '')} +{pendiente.get('pts', 0)} (Punto de Oro aprobado)",
                    pendiente.get("color", "arb"),
                )
            estado["oroPuntoPendiente"] = None
            estado["oroPuntoDetalle"] = ""
            estado["oroPendienteAprobacion"] = False
            estado["alerta12Data"] = None
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
            estado["alerta12Data"] = None
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

    elif accion == "cerrar_alerta12":
        # Solo el Juez Central retira la alerta de superioridad (gate en
        # socket). Con reanudar=True el combate continúa de inmediato
        # (el cronómetro vuelve a correr).
        if estado.get("alerta12Data"):
            estado["alerta12Data"] = None
            if ev.get("reanudar"):
                estado["activo"] = True
                _agregar_log(estado, "▶ Superioridad evaluada — el JC reanuda el combate", "arb")
            else:
                _agregar_log(estado, "Alerta de superioridad cerrada por el JC", "arb")

    elif accion == "descalificar":
        # Descalificación directa del Juez Central (ej: no presentación,
        # conducta antideportiva). El rival queda como ganador.
        color = ev.get("color")
        if color in ("hong", "chung"):
            razon = str(ev.get("razon") or "Decisión del Juez Central").strip()[:80]
            _descalificar(estado, color, razon, ev,
                          broadcast_ganador_cb, broadcast_derrota_cb)

    elif accion == "cerrar_ganador":
        if estado.get("ganadorPendienteCierre"):
            estado["ganadorPendienteCierre"] = False
            estado["ganadorPendienteNombre"] = ""
            estado["ganadorPendienteColor"] = ""
            estado["ganadorPendienteMotivo"] = ""
            _agregar_log(estado, "Ganador reconocido por el Juez Central", "arb")

    elif accion == "rechazar_oro":
        # El punto pendiente se descarta sin haber tocado el marcador
        # y el combate continúa.
        if estado.get("oroPendienteAprobacion"):
            estado["oroPendienteAprobacion"] = False
            estado["oroResuelto"] = False
            estado["oroGanadorNombre"] = ""
            estado["oroGanadorColor"] = ""
            estado["oroPuntoPendiente"] = None
            estado["oroPuntoDetalle"] = ""
            _agregar_log(estado, "Punto de Oro rechazado por el JC — descartado, el combate continúa", "arb")

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
