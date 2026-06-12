"""
Socket.IO Namespace: /combate  v2
Maneja la comunicación en tiempo real para los combates.

Novedades v2:
- tatami_activo: controla si el tatami acepta eventos
- nombre_categoria: nombre personalizable de la categoría activa
- Broadcast inicial ya incluye _categoria + _tatami_activo + _nombre_categoria
- aprobar_oro: Juez Central confirma ganador de Punto de Oro
- activar_competidor / cerrar_puntuacion: control de turno en Figuras
- Validaciones de asignación de roles
"""

import copy
import json
import os
import re
import threading
from datetime import datetime, timezone
from pathlib import Path
from flask import request
from flask_socketio import ConnectionRefusedError, Namespace, emit, join_room, leave_room
from flask_jwt_extended import decode_token

from ..engine.combate_engine import (
    ACCIONES_BLOQUEADAS_DURANTE_ALERTA,
    ACCIONES_BLOQUEADAS_TRAS_GANADOR,
    estado_inicial,
    aplicar_evento,
    guardar_combate_snapshot,
    _agregar_log,
)
from ..engine.figuras_engine import (
    estado_inicial_figuras,
    aplicar_evento_figuras,
    guardar_figuras_snapshot,
)
from ..extensions import db, socketio
from ..models.combate import Combate, EventoCombate
from ..models.tatami import SesionTatami
from ..models.asignacion import AccesoTatami, AsignacionJuez


# ══════════════════════════════════════════
#  ESTADO IN-MEMORY POR TATAMI
# ══════════════════════════════════════════
tatami_states = {}
MAX_EVENTOS_VISTOS = 500

_lock = threading.Lock()

# ── Persistencia a disco: el estado sobrevive reinicios del backend ──
_SNAPSHOT_PATH = Path(__file__).resolve().parents[2] / "instance" / "tatami_states.json"
_snapshots_cargados = False


def _serializar_ts(ts):
    """Parte JSON-serializable del estado de un tatami."""
    return {
        "estado": ts.get("estado", {}),
        "categoria_activa": ts.get("categoria_activa", "combate"),
        "nombre_categoria": ts.get("nombre_categoria", "Figuras"),
        "tatami_activo": ts.get("tatami_activo", False),
        "secuencia": ts.get("secuencia", 0),
        "sesion_id": ts.get("sesion_id"),
        "jueces_meta": ts.get("jueces_meta", {}),
        "tatami_numero": ts.get("tatami_numero"),
        "campeonato_nombre": ts.get("campeonato_nombre"),
        "campeonato_id": ts.get("campeonato_id"),
        "combate_llave": ts.get("combate_llave"),
        "mostrar_arbol": bool(ts.get("mostrar_arbol")),
        "llave_arbol": ts.get("llave_arbol"),
    }


def _persistir_estados():
    """Escribe los estados de todos los tatamis a disco (reemplazo atómico)."""
    try:
        data = {tid: _serializar_ts(ts) for tid, ts in tatami_states.items()}
        _SNAPSHOT_PATH.parent.mkdir(parents=True, exist_ok=True)
        tmp = _SNAPSHOT_PATH.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, _SNAPSHOT_PATH)
    except Exception as e:
        print(f"  [WARN] No se pudo persistir estado de tatamis: {e}")


def _cargar_estados():
    """Restaura los estados desde disco al primer acceso tras un reinicio."""
    global _snapshots_cargados
    if _snapshots_cargados:
        return
    _snapshots_cargados = True
    try:
        if not _SNAPSHOT_PATH.exists():
            return
        data = json.loads(_SNAPSHOT_PATH.read_text(encoding="utf-8"))
        for tid, guardado in data.items():
            estado = guardado.get("estado") or estado_inicial()
            # El cronómetro vuelve pausado: el Juez Central decide reanudar.
            if "activo" in estado:
                estado["activo"] = False
            tatami_states[tid] = {
                "estado": estado,
                "categoria_activa": guardado.get("categoria_activa", "combate"),
                "nombre_categoria": guardado.get("nombre_categoria", "Figuras"),
                "tatami_activo": guardado.get("tatami_activo", False),
                "eventos_vistos": set(),
                "secuencia": guardado.get("secuencia", 0),
                "crono_thread": None,
                "crono_activo": False,
                "sesion_id": guardado.get("sesion_id"),
                "jueces_meta": guardado.get("jueces_meta", {}),
                "roles_activos": {},
                "tatami_numero": guardado.get("tatami_numero"),
                "campeonato_nombre": guardado.get("campeonato_nombre"),
                "campeonato_id": guardado.get("campeonato_id"),
                "combate_llave": guardado.get("combate_llave"),
                "mostrar_arbol": bool(guardado.get("mostrar_arbol")),
                "llave_arbol": guardado.get("llave_arbol"),
            }
        if data:
            print(f"  [OK] Estado de {len(data)} tatami(s) restaurado tras reinicio")
    except Exception as e:
        print(f"  [WARN] No se pudo restaurar estado de tatamis: {e}")

# Acciones permitidas cuando tatami ESTÁ DESACTIVADO
ACCIONES_SIN_ACTIVACION = {
    "activar_tatami",
    "desactivar_tatami",
    "cambiar_categoria",
    "cambiar_nombre_categoria",
}

ACCIONES_DURANTE_GANADOR_PENDIENTE = {"cerrar_ganador", "cerrar_alerta12"}

ACCIONES_REQUIEREN_COMPETIDORES = {
    "punto_juez",
    "deshacer_juez",
    "especial",
    "deshacer_arbitro",
    "kyonggo",
    "gamjeum",
    "ronda",
    "set_num_jueces",
    "crono_reset",
    "crono_start",
    "crono_pause",
    "nuevo_combate",
    "reset",
    "aprobar_oro",
    "rechazar_oro",
    "declarar_ganador",
    "descalificar",
}

ACCIONES_FIGURAS_SIN_NOMBRE_CATEGORIA = {
    "activar_tatami",
    "desactivar_tatami",
    "cambiar_categoria",
    "cambiar_nombre_categoria",
}

ACCIONES_SOLO_ARBITRO = {
    "activar_tatami",
    "desactivar_tatami",
    "cambiar_categoria",
    "cambiar_nombre_categoria",
    "nuevo_combate",
    "reset",
    "reset_figuras",
    "crono_start",
    "crono_pause",
    "crono_reset",
    "ronda",
    "set_num_jueces",
    "especial",
    "deshacer_arbitro",
    "kyonggo",
    "gamjeum",
    "aprobar_oro",
    "rechazar_oro",
    "declarar_ganador",
    "descalificar",
    "cerrar_ganador",
    "cerrar_alerta12",
    "agregar_competidor",
    "eliminar_competidor",
    "activar_competidor",
    "cerrar_puntuacion",
    "reevaluar_empate",
    "finalizar",
    "activar_combate_llave",
    "soltar_combate_llave",
    "mostrar_arbol",
}

CATEGORIA_NOMBRE_MAX = 40
CATEGORIA_NOMBRE_RE = re.compile(r"^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]+$")

# Máximo 4 jueces de esquina por tatami (más el Juez Central)
ROL_LABELS = {
    "arbitro": "Juez Central",
    "j1": "Juez 1",
    "j2": "Juez 2",
    "j3": "Juez 3",
    "j4": "Juez 4",
}


def _info_tatami(tatami_id):
    """Número visible, nombre e id del campeonato del tatami."""
    try:
        from ..models.tatami import Tatami as TatamiModel
        from ..models.campeonato import Campeonato as CampeonatoModel

        tatami = TatamiModel.query.get(int(tatami_id))
        if not tatami:
            return None, None, None
        camp = CampeonatoModel.query.get(tatami.campeonato_id) if tatami.campeonato_id else None
        return tatami.numero, (camp.nombre if camp else None), tatami.campeonato_id
    except Exception:
        return None, None, None


def _get_tatami_state(tatami_id):
    """Obtiene o crea el estado de un tatami."""
    _cargar_estados()
    tid = str(tatami_id)
    if tid not in tatami_states:
        numero, camp_nombre, camp_id = _info_tatami(tatami_id)
        tatami_states[tid] = {
            "estado": estado_inicial(),
            "categoria_activa": "combate",
            "nombre_categoria": "Figuras",   # nombre custom solo aplica a figuras
            "tatami_activo": False,          # inicia desactivado
            "eventos_vistos": set(),
            "secuencia": 0,
            "crono_thread": None,
            "crono_activo": False,
            "sesion_id": None,
            "jueces_meta": {},
            "roles_activos": {},
            "tatami_numero": numero,
            "campeonato_nombre": camp_nombre,
            "campeonato_id": camp_id,
        }
    ts = tatami_states[tid]
    # Estados restaurados de versiones previas pueden no tener el número
    if ts.get("tatami_numero") is None or ts.get("campeonato_id") is None:
        numero, camp_nombre, camp_id = _info_tatami(tatami_id)
        ts["tatami_numero"] = numero
        ts["campeonato_nombre"] = camp_nombre
        ts["campeonato_id"] = camp_id
    return ts


def _room_name(tatami_id):
    return f"tatami_{tatami_id}"


def _build_estado_broadcast(ts):
    """Agrega metadatos al estado antes de broadcast."""
    estado_copy = copy.deepcopy(ts["estado"])
    estado_copy["_categoria"] = ts.get("categoria_activa", "combate")
    estado_copy["_tatami_activo"] = ts.get("tatami_activo", False)
    estado_copy["_nombre_categoria"] = ts.get("nombre_categoria", "Figuras")
    estado_copy["_tatami_numero"] = ts.get("tatami_numero")
    estado_copy["_campeonato_nombre"] = ts.get("campeonato_nombre")
    estado_copy["_campeonato_id"] = ts.get("campeonato_id")
    estado_copy["_combate_llave"] = ts.get("combate_llave")
    # Árbol de la llave para la pantalla pública. La estructura completa
    # solo viaja cuando está visible (los ticks del cronómetro no la cargan),
    # pero _hay_arbol siempre indica si existe para el botón del Juez Central.
    estado_copy["_mostrar_arbol"] = bool(ts.get("mostrar_arbol"))
    estado_copy["_hay_arbol"] = bool(ts.get("llave_arbol"))
    estado_copy["_llave_arbol"] = ts.get("llave_arbol") if ts.get("mostrar_arbol") else None
    return estado_copy


def _rol_label(rol):
    return ROL_LABELS.get(rol, rol or "-")


def roles_ocupados_para_tatami(tatami_id):
    """Roles actualmente conectados en un tatami."""
    tid = str(tatami_id)
    with _lock:
        ts = tatami_states.get(tid)
        if not ts:
            return set()
        return set(ts.get("roles_activos", {}).keys())


def _competidores_con_nombre(estado):
    hong = (estado.get("nombreHong") or "").strip()
    chung = (estado.get("nombreChung") or "").strip()
    return bool(hong and chung and hong != "Hong" and chung != "Chung")


def _normalizar_nombre_categoria(nombre):
    raw = str(nombre or "")
    limpio = re.sub(r"[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]", "", raw)
    return limpio[:CATEGORIA_NOMBRE_MAX]


def _nombre_categoria_valido(nombre):
    valor = str(nombre or "").strip()
    return bool(valor and CATEGORIA_NOMBRE_RE.fullmatch(valor))


def _meta_desde_asignacion(asig):
    usuario = asig.usuario if asig else None
    return {
        "usuario_id": usuario.id if usuario else None,
        "nombre": (asig.nombre_display or usuario.nombre) if usuario else None,
        "email": usuario.email if usuario else "",
        "rol_tatami": asig.rol_tatami if asig else None,
        "asignacion": _rol_label(asig.rol_tatami) if asig else None,
        "origen": "asignacion",
        "asignado_at": asig.asignado_at.isoformat() if asig and asig.asignado_at else None,
        "asignado_por": (
            {
                "id": asig.asignado_por.id,
                "nombre": asig.asignado_por.nombre,
                "email": asig.asignado_por.email,
            }
            if asig and asig.asignado_por else None
        ),
    }


def _meta_desde_conexion(rol, user_id=None, nombre=None, email=None, origen="pin"):
    return {
        "usuario_id": int(user_id) if user_id else None,
        "nombre": nombre or _rol_label(rol),
        "email": email or "",
        "rol_tatami": rol,
        "asignacion": _rol_label(rol),
        "origen": origen,
        "asignado_at": None,
        "asignado_por": None,
    }


class CombateNamespace(Namespace):
    """Namespace Socket.IO para combates en tiempo real."""

    def on_connect(self, auth=None):
        tatami_id = request.args.get("tatami_id")
        rol = request.args.get("rol", "pantalla")
        # El token viaja en el payload `auth` de Socket.IO (no queda en logs
        # de URLs). Se acepta query string como compatibilidad hacia atrás.
        token = None
        if isinstance(auth, dict):
            token = auth.get("token")
        token = token or request.args.get("token")

        if not tatami_id:
            raise ConnectionRefusedError("tatami_id requerido")

        if rol not in {"pantalla", *ROL_LABELS.keys()}:
            raise ConnectionRefusedError("Rol de juez inválido")

        # Autenticación opcional
        user_id = None
        user_nombre = None
        user_email = None
        if token:
            try:
                decoded = decode_token(token)
                user_id = decoded.get("sub")
                user_nombre = decoded.get("nombre", "")
                user_email = decoded.get("email", "")
            except Exception:
                pass

        with _lock:
            ts = _get_tatami_state(tatami_id)
            if rol != "pantalla":
                activo = ts.setdefault("roles_activos", {}).get(rol)
                if activo and activo.get("sid") != request.sid:
                    raise ConnectionRefusedError(
                        f"{_rol_label(rol)} ya está conectado en este tatami"
                    )
                ts["roles_activos"][rol] = {
                    "sid": request.sid,
                    "usuario_id": int(user_id) if user_id else None,
                    "nombre": user_nombre,
                    "email": user_email,
                }

        # Registrar acceso
        try:
            acceso = AccesoTatami(
                tatami_id=int(tatami_id),
                usuario_id=int(user_id) if user_id else None,
                nombre_visitante=user_nombre or request.args.get("nombre", "Anónimo"),
                rol_seleccionado=rol,
                ip_address=request.remote_addr,
            )
            db.session.add(acceso)
            db.session.commit()
        except Exception:
            db.session.rollback()

        join_room(_room_name(tatami_id))

        # Enviar estado completo CON metadatos desde el primer momento
        try:
            asignacion = (
                AsignacionJuez.query.filter_by(
                    tatami_id=int(tatami_id), usuario_id=int(user_id)
                ).first()
                if user_id else None
            )
            if asignacion and asignacion.rol_tatami == rol:
                ts["jueces_meta"][rol] = _meta_desde_asignacion(asignacion)
            elif rol != "pantalla":
                ts["jueces_meta"][rol] = _meta_desde_conexion(
                    rol, user_id=user_id, nombre=user_nombre, email=user_email, origen="pin"
                )
        except Exception:
            if rol != "pantalla":
                ts["jueces_meta"][rol] = _meta_desde_conexion(
                    rol, user_id=user_id, nombre=user_nombre, email=user_email, origen="pin"
                )
        emit("estado", {"datos": _build_estado_broadcast(ts)})

        print(f"  [CONN] [{_room_name(tatami_id)}] {rol} conectado (sid={request.sid})")

    def on_disconnect(self):
        tatami_id = request.args.get("tatami_id")
        rol = request.args.get("rol", "pantalla")
        if not tatami_id or rol == "pantalla":
            return
        with _lock:
            ts = tatami_states.get(str(tatami_id))
            if not ts:
                return
            activo = ts.get("roles_activos", {}).get(rol)
            if activo and activo.get("sid") == request.sid:
                ts["roles_activos"].pop(rol, None)

    def on_pedir(self, data=None):
        """Cliente solicita estado completo (reconexión)."""
        tatami_id = request.args.get("tatami_id")
        if not tatami_id:
            return
        ts = _get_tatami_state(tatami_id)
        emit("estado", {"datos": _build_estado_broadcast(ts)})

    def on_evento(self, data):
        """
        Recibe un evento delta del cliente.
        data: { evId, evento: { accion, ...datos } }
        """
        tatami_id = request.args.get("tatami_id")
        if not tatami_id:
            return
        rol = request.args.get("rol", "pantalla")

        ev = data.get("evento", {})
        ev_id = data.get("evId")

        with _lock:
            ts = _get_tatami_state(tatami_id)
            room = _room_name(tatami_id)

            # Deduplicación
            if ev_id and ev_id in ts["eventos_vistos"]:
                emit("ack", {"evId": ev_id})
                return
            if ev_id:
                ts["eventos_vistos"].add(ev_id)
                if len(ts["eventos_vistos"]) > MAX_EVENTOS_VISTOS:
                    ts["eventos_vistos"].pop()

            accion = ev.get("accion")

            if accion in ACCIONES_SOLO_ARBITRO and rol != "arbitro":
                if ev_id:
                    emit("ack", {"evId": ev_id})
                emit("accion_rechazada", {
                    "message": "Esta acción requiere Juez Central."
                })
                return

            # ── Bloqueo si tatami desactivado ──────────────────────────────
            if not ts.get("tatami_activo", False) and accion not in ACCIONES_SIN_ACTIVACION:
                if ev_id:
                    emit("ack", {"evId": ev_id})
                return  # Silently ignore

            if ts["estado"].get("ganadorPendienteCierre") and accion not in ACCIONES_DURANTE_GANADOR_PENDIENTE:
                if ev_id:
                    emit("ack", {"evId": ev_id})
                return

            # Combate cerrado: con ganador declarado solo procede guardar
            # (Nuevo Combate) o descartar (Reset).
            if (
                ts.get("categoria_activa", "combate") == "combate"
                and ts["estado"].get("ganadorManualColor")
                and accion in ACCIONES_BLOQUEADAS_TRAS_GANADOR
            ):
                if ev_id:
                    emit("ack", {"evId": ev_id})
                emit("accion_rechazada", {
                    "message": "El combate ya tiene ganador. Usa NUEVO COMBATE "
                               "para guardarlo o RESET para descartarlo."
                })
                return

            # Combate en pausa mientras la alerta de superioridad esté abierta
            if (
                ts.get("categoria_activa", "combate") == "combate"
                and ts["estado"].get("alerta12Data")
                and accion in ACCIONES_BLOQUEADAS_DURANTE_ALERTA
            ):
                if ev_id:
                    emit("ack", {"evId": ev_id})
                emit("accion_rechazada", {
                    "message": "Combate en pausa por la alerta de superioridad. "
                               "El Juez Central debe cerrarla para continuar."
                })
                return

            if accion == "cerrar_ganador" and rol != "arbitro":
                if ev_id:
                    emit("ack", {"evId": ev_id})
                return

            if (
                ts.get("categoria_activa", "combate") == "combate"
                and accion in ACCIONES_REQUIEREN_COMPETIDORES
                and not _competidores_con_nombre(ts["estado"])
            ):
                if ev_id:
                    emit("ack", {"evId": ev_id})
                emit("accion_rechazada", {
                    "message": "Ingresa los nombres de ambos competidores antes de continuar."
                })
                return

            if (
                ts.get("categoria_activa") == "figuras"
                and accion not in ACCIONES_FIGURAS_SIN_NOMBRE_CATEGORIA
                and not _nombre_categoria_valido(ts["estado"].get("nombre_categoria"))
            ):
                if ev_id:
                    emit("ack", {"evId": ev_id})
                emit("accion_rechazada", {
                    "message": "Ingresa un nombre de categoría válido usando solo letras y espacios."
                })
                return

            # ── Activar / Desactivar tatami ────────────────────────────────
            if accion == "activar_tatami":
                ts["tatami_activo"] = True
                _agregar_log(ts["estado"], "[ON] Tatami activado", "arb")
                if ev_id:
                    emit("ack", {"evId": ev_id})
                self._broadcast_estado(room, ts)
                return

            if accion == "desactivar_tatami":
                ts["tatami_activo"] = False
                ts["crono_activo"] = False  # Detener crono también
                _agregar_log(ts["estado"], "[OFF] Tatami desactivado", "arb")
                if ev_id:
                    emit("ack", {"evId": ev_id})
                self._broadcast_estado(room, ts)
                return

            # ── Cambio de nombre de categoría ─────────────────────────────
            if accion == "cambiar_nombre_categoria":
                nombre = _normalizar_nombre_categoria(ev.get("nombre", ""))
                ts["nombre_categoria"] = nombre
                if ts.get("categoria_activa") == "figuras" and "nombre_categoria" in ts["estado"]:
                    ts["estado"]["nombre_categoria"] = nombre
                if ev_id:
                    emit("ack", {"evId": ev_id})
                self._broadcast_estado(room, ts)
                return

            # ── Activar / soltar combate de eliminación (llave) ────────────
            if accion == "activar_combate_llave":
                error = self._activar_combate_llave(tatami_id, ts, ev)
                if ev_id:
                    emit("ack", {"evId": ev_id})
                if error:
                    emit("accion_rechazada", {"message": error})
                    return
                self._broadcast_estado(room, ts)
                return

            if accion == "soltar_combate_llave":
                if ts.get("combate_llave"):
                    ts.pop("combate_llave", None)
                    _agregar_log(
                        ts["estado"],
                        "[LLAVE] Combate de eliminación liberado — marcador suelto",
                        "arb",
                    )
                ts["mostrar_arbol"] = False
                ts.pop("llave_arbol", None)
                if ev_id:
                    emit("ack", {"evId": ev_id})
                self._broadcast_estado(room, ts)
                return

            # ── Mostrar árbol / puntuación en la pantalla pública ──────────
            if accion == "mostrar_arbol":
                if ts.get("llave_arbol"):
                    ts["mostrar_arbol"] = bool(ev.get("mostrar", True))
                if ev_id:
                    emit("ack", {"evId": ev_id})
                self._broadcast_estado(room, ts)
                return

            # ── Nuevo combate / nueva categoría ────────────────────────────
            if accion == "nuevo_combate":
                categoria = ts.get("categoria_activa", "combate")
                llave_info = ts.get("combate_llave") if categoria == "combate" else None

                # Combate de eliminación: debe haber un ganador definido
                ganador_color = None
                if llave_info:
                    if not ts["estado"].get("historial"):
                        if ev_id:
                            emit("ack", {"evId": ev_id})
                        emit("accion_rechazada", {
                            "message": "No hay puntos registrados en este combate de eliminación. "
                                       "Usa 'Soltar combate' si no se va a disputar."
                        })
                        return
                    snap = guardar_combate_snapshot(ts["estado"])
                    ganador_color = snap.get("ganador_manual") or (
                        "hong" if snap["marcador_hong"] > snap["marcador_chung"]
                        else "chung" if snap["marcador_chung"] > snap["marcador_hong"]
                        else "empate"
                    )
                    if ganador_color == "empate":
                        if ev_id:
                            emit("ack", {"evId": ev_id})
                        emit("accion_rechazada", {
                            "message": "En un combate de eliminación debe haber un ganador. "
                                       "Usa Punto de Oro o la decisión del Juez Central para desempatar."
                        })
                        return

                self._guardar_combate_actual(tatami_id, ts, llave_info=llave_info)
                if categoria == "figuras":
                    nombre_cat = ts.get("nombre_categoria", "Figuras")
                    nuevo = estado_inicial_figuras()
                    nuevo["nombre_categoria"] = nombre_cat
                    ts["estado"] = nuevo
                    _agregar_log(
                        ts["estado"],
                        f"[OK] {nombre_cat} guardada — Nueva categoría",
                        "arb",
                    )
                else:
                    seg_max = ts["estado"].get("segundosMax", 120)
                    num_j = ts["estado"].get("numJueces", 4)
                    nombres_j = copy.deepcopy(ts["estado"].get("nombresJueces", {}))
                    ts["estado"] = estado_inicial()
                    ts["estado"]["segundosMax"] = seg_max
                    ts["estado"]["segundos"] = seg_max
                    ts["estado"]["numJueces"] = num_j
                    ts["estado"]["nombresJueces"] = nombres_j
                    _agregar_log(ts["estado"], "[OK] Combate guardado — Nuevo combate", "arb")

                # El ganador avanza en la llave y se libera el tatami
                if llave_info and ganador_color in ("hong", "chung"):
                    self._registrar_resultado_llave(ts, llave_info, ganador_color)

                self._detener_crono(tatami_id)
                if ev_id:
                    emit("ack", {"evId": ev_id})
                self._broadcast_estado(room, ts)
                return

            # ── Callback ganador Punto de Oro ──────────────────────────────
            def ganador_cb(nombre, color, motivo="Punto de Oro"):
                payload = {
                    "tipo": "ganador-flash",
                    "nombre": nombre,
                    "color": color,
                    "motivo": motivo,
                }
                socketio.emit("ganador-flash", payload, namespace="/combate", to=room)
                self._detener_crono(tatami_id)

            def alerta_superioridad_cb(payload):
                socketio.emit("alerta12", payload, namespace="/combate", to=room)
                # El combate se pausa hasta que el JC cierre la alerta
                self._detener_crono(tatami_id)

            def derrota_cb(perdedor, razon):
                # Descalificación automática: modal de derrota en todos los
                # dispositivos del tatami (el ganador sale por ganador_cb).
                socketio.emit(
                    "derrota",
                    {"perdedor": perdedor, "razon": razon},
                    namespace="/combate",
                    to=room,
                )
                self._detener_crono(tatami_id)

            # ── Cambio de categoría ────────────────────────────────────────
            if accion == "cambiar_categoria":
                nueva_cat = ev.get("categoria", "combate")
                ts["categoria_activa"] = nueva_cat
                if nueva_cat == "figuras":
                    nuevo = estado_inicial_figuras()
                    nuevo["nombre_categoria"] = ts.get("nombre_categoria", "Figuras")
                    ts["estado"] = nuevo
                else:
                    ts["estado"] = estado_inicial()
                self._detener_crono(tatami_id)
                if ev_id:
                    emit("ack", {"evId": ev_id})
                self._broadcast_estado(room, ts)
                return

            # ── Aplicar evento al estado ───────────────────────────────────
            categoria = ts.get("categoria_activa", "combate")
            self._inyectar_meta_juez(ts, ev, rol)
            if categoria == "figuras":
                aplicar_evento_figuras(ts["estado"], ev)
            else:
                aplicar_evento(ts["estado"], ev, ganador_cb, alerta_superioridad_cb, derrota_cb)

            # ── Manejar cronómetro ─────────────────────────────────────────
            if accion == "crono_start":
                # Al iniciar el combate, la pantalla pública pasa del árbol
                # de la llave al marcador automáticamente.
                ts["mostrar_arbol"] = False
                self._iniciar_crono(tatami_id)
            elif accion in ("crono_pause", "crono_reset", "reset", "declarar_ganador"):
                self._detener_crono(tatami_id)
            elif accion == "cerrar_alerta12" and ts["estado"].get("activo"):
                # El JC cerró la alerta con "reanudar": el crono vuelve a correr
                self._iniciar_crono(tatami_id)

            # Si Punto de Oro resuelto, detener crono
            if categoria == "combate" and ts["estado"].get("oroResuelto"):
                self._detener_crono(tatami_id)

            # ── ACK + Broadcast ────────────────────────────────────────────
            ts["secuencia"] += 1
            if ev_id:
                emit("ack", {"evId": ev_id})
            self._broadcast_estado(room, ts)

    def on_broadcast(self, data):
        """
        Eventos de broadcast puro (no modifican estado):
        alerta12, derrota, falta-flash, ganador-flash
        """
        tatami_id = request.args.get("tatami_id")
        if not tatami_id:
            return
        ts = _get_tatami_state(tatami_id)
        if not ts.get("tatami_activo", False):
            return

        room = _room_name(tatami_id)
        tipo = data.get("tipo")
        if tipo in ("alerta12", "derrota", "falta-flash", "ganador-flash"):
            payload = data.get("data") if isinstance(data.get("data"), dict) else {
                k: v for k, v in data.items() if k != "tipo"
            }
            if tipo == "falta-flash" and "tipo" not in payload:
                payload["tipo"] = payload.get("tipoFalta", "adv")
            emit(tipo, payload, to=room)

    def on_pedir_combates(self, data=None):
        """Cliente solicita lista de combates guardados."""
        tatami_id = request.args.get("tatami_id")
        if not tatami_id:
            return
        try:
            sesiones = SesionTatami.query.filter_by(tatami_id=int(tatami_id)).all()
            sesion_ids = [s.id for s in sesiones]
            combates = []
            if sesion_ids:
                combates_db = (
                    Combate.query
                    .filter(Combate.sesion_tatami_id.in_(sesion_ids))
                    .order_by(Combate.created_at.desc())
                    .limit(50)
                    .all()
                )
                combates = [c.to_dict() for c in combates_db]
            emit("combates_actualizados", {"combates": combates})
        except Exception:
            emit("combates_actualizados", {"combates": []})

    # ══════════════════════════════════════════
    #  HELPERS INTERNOS
    # ══════════════════════════════════════════

    def _broadcast_estado(self, room, ts):
        """Envía estado con metadatos a todos los clientes del room."""
        estado_copy = _build_estado_broadcast(ts)
        emit("estado", {"datos": estado_copy}, to=room)
        emit("estado_confirmado", {"datos": estado_copy})
        # Cada cambio de estado por evento queda persistido en disco
        # (los ticks del cronómetro no pasan por aquí, no saturan I/O).
        _persistir_estados()

    def _inyectar_meta_juez(self, ts, ev, rol_conexion):
        accion = ev.get("accion")
        actor_rol = None
        if accion == "punto_juez":
            actor_rol = ev.get("juez")
        elif accion in ("puntuar", "confirmar_puntuacion"):
            actor_rol = ev.get("juez_id")
        elif accion in (
            "especial", "kyonggo", "gamjeum", "deshacer_arbitro",
            "aprobar_oro", "rechazar_oro", "declarar_ganador",
        ):
            actor_rol = "arbitro"

        actor_rol = actor_rol or rol_conexion
        if not actor_rol or actor_rol == "pantalla":
            return

        meta = ts.get("jueces_meta", {}).get(actor_rol) or _meta_desde_conexion(
            actor_rol, origen="pin"
        )
        ev["juez_nombre"] = meta.get("nombre")
        ev["juez_email"] = meta.get("email")
        ev["juez_asignacion"] = meta.get("asignacion") or _rol_label(actor_rol)
        ev["juez_rol"] = meta.get("rol_tatami") or actor_rol
        ev["juez_acceso"] = meta.get("origen") or "pin"

    def _activar_combate_llave(self, tatami_id, ts, ev):
        """
        Activa el siguiente combate de eliminación de una llave en este tatami:
        autocompleta los nombres (comp1=Hong/Rojo, comp2=Chung/Azul) y deja el
        cronómetro pausado, listo para comenzar.
        Retorna un mensaje de error, o None si todo salió bien.
        """
        from ..models.llave import Llave
        from ..api.llaves import siguiente_partido, nombre_ronda

        if ts.get("categoria_activa", "combate") != "combate":
            return "Cambia a la categoría Combate antes de activar un combate de eliminación."

        estado = ts["estado"]
        if estado.get("historial") or estado.get("segundos", 0) < estado.get("segundosMax", 120):
            return "Guarda o resetea el combate actual antes de activar uno de eliminación."

        try:
            llave = Llave.query.get(int(ev.get("llave_id", 0)))
        except (TypeError, ValueError):
            llave = None
        if not llave:
            return "Llave no encontrada."
        if llave.tatami_id != int(tatami_id):
            return "Esta llave está asignada a otro tatami."

        sig = siguiente_partido(llave.estructura or {})
        if sig is None:
            return "No quedan combates pendientes en esta llave."

        ronda_idx, partido_idx, partido = sig
        total_rondas = len((llave.estructura or {}).get("rondas", []))

        # Nuevo marcador con los nombres del cuadro (crono pausado)
        seg_max = estado.get("segundosMax", 120)
        num_j = estado.get("numJueces", 4)
        nombres_j = copy.deepcopy(estado.get("nombresJueces", {}))
        nuevo = estado_inicial()
        nuevo["segundosMax"] = seg_max
        nuevo["segundos"] = seg_max
        nuevo["numJueces"] = num_j
        nuevo["nombresJueces"] = nombres_j
        nuevo["nombreHong"] = partido["comp1"]["nombre"]
        nuevo["nombreChung"] = partido["comp2"]["nombre"]
        ts["estado"] = nuevo

        etiqueta_ronda = nombre_ronda(ronda_idx, total_rondas)
        ts["combate_llave"] = {
            "llave_id": llave.id,
            "nombre": llave.nombre,
            "ronda": ronda_idx,
            "partido": partido_idx,
            "ronda_nombre": etiqueta_ronda,
            "comp1": partido["comp1"],
            "comp2": partido["comp2"],
        }
        # El público ve el árbol hasta que el combate comience (crono_start)
        ts["llave_arbol"] = {
            "llave_id": llave.id,
            "nombre": llave.nombre,
            "estructura": copy.deepcopy(llave.estructura),
        }
        ts["mostrar_arbol"] = True
        self._detener_crono(tatami_id)
        _agregar_log(
            ts["estado"],
            f"[LLAVE] {llave.nombre} · {etiqueta_ronda}: "
            f"{partido['comp1']['nombre']} (Rojo) vs {partido['comp2']['nombre']} (Azul)",
            "arb",
        )
        return None

    def _registrar_resultado_llave(self, ts, llave_info, ganador_color):
        """El ganador del combate avanza en la llave; libera el tatami."""
        from ..models.llave import Llave
        from ..api.llaves import registrar_resultado, partidos_jugables

        try:
            llave = Llave.query.get(llave_info["llave_id"])
            if llave:
                estructura = copy.deepcopy(llave.estructura)
                lado = 1 if ganador_color == "hong" else 2
                registrar_resultado(
                    estructura, llave_info["ronda"], llave_info["partido"], lado
                )
                llave.estructura = estructura
                db.session.commit()

                # El público vuelve a ver el árbol actualizado tras el combate
                ts["llave_arbol"] = {
                    "llave_id": llave.id,
                    "nombre": llave.nombre,
                    "estructura": copy.deepcopy(estructura),
                }
                ts["mostrar_arbol"] = True

                ganador = llave_info["comp1"] if lado == 1 else llave_info["comp2"]
                campeon = estructura.get("campeon")
                pendientes = len(partidos_jugables(estructura))
                if campeon:
                    _agregar_log(
                        ts["estado"],
                        f"[LLAVE] 🏆 {campeon['nombre']} CAMPEÓN — {llave_info['nombre']}",
                        "arb",
                    )
                else:
                    _agregar_log(
                        ts["estado"],
                        f"[LLAVE] {ganador['nombre']} avanza — "
                        f"{pendientes} combate(s) pendiente(s) en {llave_info['nombre']}",
                        "arb",
                    )
        except Exception as e:
            db.session.rollback()
            print(f"  [ERR] Error registrando resultado en la llave: {e}")
        finally:
            ts.pop("combate_llave", None)

    def _obtener_sesion_categoria(self, tatami_id, slug):
        from ..models.categoria import Categoria

        cat = Categoria.query.filter_by(slug=slug).first()
        if not cat:
            return None, None

        sesion = SesionTatami.query.filter_by(
            tatami_id=int(tatami_id),
            categoria_id=cat.id,
            estado="en_curso",
        ).first()
        if not sesion:
            sesion = SesionTatami(
                tatami_id=int(tatami_id),
                categoria_id=cat.id,
                estado="en_curso",
                inicio=datetime.now(timezone.utc),
            )
            db.session.add(sesion)
            db.session.flush()
        return sesion, cat

    def _guardar_combate_actual(self, tatami_id, ts, llave_info=None):
        """Guarda el combate actual en la base de datos."""
        estado = ts["estado"]
        categoria = ts.get("categoria_activa", "combate")

        # Para figuras, usar guardar_figuras_snapshot
        if categoria == "figuras":
            if not estado.get("competidores"):
                return
            snapshot = guardar_figuras_snapshot(estado)
            ranking = snapshot.get("ranking") or []
            # El campeón del registro es el 1° del podio normal; los de
            # categoría especial tienen su propio primer puesto aparte.
            ganador = next(
                (r for r in ranking if not r.get("especial")),
                ranking[0] if ranking else None,
            )
            jueces_detalle = {
                "tipo": "figuras",
                "nombre_categoria": snapshot.get("nombre_categoria", "Figuras"),
                "ranking": ranking,
                "competidores": snapshot.get("competidores", []),
                "criterios": snapshot.get("criterios", []),
                "puntuaciones": snapshot.get("puntuaciones", {}),
                "puntuaciones_confirmadas": snapshot.get("puntuaciones_confirmadas", {}),
                "desempates": snapshot.get("desempates", []),
                "puntuaciones_completas": snapshot.get("puntuaciones_completas", False),
                "finalizado": snapshot.get("finalizado", False),
                "asignaciones": self._jueces_reporte(tatami_id, ts),
            }

            try:
                sesion, cat = self._obtener_sesion_categoria(tatami_id, "figuras")
                if not sesion:
                    print(f"  [ERR] No existe categoría 'figuras' para guardar tatami {tatami_id}")
                    return

                combate = Combate(
                    sesion_tatami_id=sesion.id,
                    categoria_id=cat.id if cat else sesion.categoria_id,
                    nombre_hong=ganador.get("nombre") if ganador else snapshot.get("nombre_categoria", "Figuras"),
                    nombre_chung=snapshot.get("nombre_categoria", "Figuras"),
                    marcador_hong=float(ganador.get("total", 0)) if ganador else 0.0,
                    marcador_chung=0.0,
                    esq_hong=float(ganador.get("total", 0)) if ganador else 0.0,
                    esq_chung=0.0,
                    arb_hong=0.0,
                    arb_chung=0.0,
                    kyong_hong=0,
                    kyong_chung=0,
                    faltas_hong=0,
                    faltas_chung=0,
                    num_jueces=snapshot.get("num_jueces", 4),
                    duracion_segundos=0,
                    ronda_final="figuras",
                    historial_completo=snapshot.get("log", []),
                    jueces_detalle=jueces_detalle,
                    ganador="hong" if ganador else "empate",
                    fin=datetime.now(timezone.utc),
                )
                db.session.add(combate)
                db.session.commit()
                print(
                    f"  [OK] Figuras guardadas tatami {tatami_id}: "
                    f"{snapshot.get('nombre_categoria', 'Figuras')}"
                )
            except Exception as e:
                db.session.rollback()
                print(f"  [ERR] Error guardando figuras: {e}")
            return

        if not estado.get("historial"):
            return

        snapshot = guardar_combate_snapshot(estado)
        snapshot["jueces_detalle"]["asignaciones"] = self._jueces_reporte(tatami_id, ts)
        if llave_info:
            snapshot["jueces_detalle"]["llave"] = {
                "llave_id": llave_info.get("llave_id"),
                "nombre": llave_info.get("nombre"),
                "ronda_nombre": llave_info.get("ronda_nombre"),
            }
            snapshot["jueces_detalle"]["nombre_categoria"] = (
                f"{llave_info.get('nombre')} · {llave_info.get('ronda_nombre')}"
            )

        try:
            sesion, cat = self._obtener_sesion_categoria(tatami_id, "combate")
            if not sesion:
                print(f"  [ERR] No existe categoría 'combate' para guardar tatami {tatami_id}")
                return
            ts["sesion_id"] = sesion.id

            combate = Combate(
                sesion_tatami_id=sesion.id,
                categoria_id=cat.id if cat else sesion.categoria_id,
                nombre_hong=snapshot["nombre_hong"],
                nombre_chung=snapshot["nombre_chung"],
                marcador_hong=snapshot["marcador_hong"],
                marcador_chung=snapshot["marcador_chung"],
                esq_hong=snapshot["esq_hong"],
                esq_chung=snapshot["esq_chung"],
                arb_hong=snapshot["arb_hong"],
                arb_chung=snapshot["arb_chung"],
                kyong_hong=snapshot["kyong_hong"],
                kyong_chung=snapshot["kyong_chung"],
                faltas_hong=snapshot["faltas_hong"],
                faltas_chung=snapshot["faltas_chung"],
                num_jueces=snapshot["num_jueces"],
                duracion_segundos=snapshot["duracion_segundos"],
                ronda_final=snapshot["ronda_final"],
                historial_completo=snapshot["historial_completo"],
                jueces_detalle=snapshot["jueces_detalle"],
                ganador=snapshot.get("ganador_manual") or (
                    "hong" if snapshot["marcador_hong"] > snapshot["marcador_chung"]
                    else "chung" if snapshot["marcador_chung"] > snapshot["marcador_hong"]
                    else "empate"
                ),
                fin=datetime.now(timezone.utc),
            )
            db.session.add(combate)
            db.session.commit()

            print(
                f"  [OK] Combate guardado tatami {tatami_id}: "
                f"{snapshot['nombre_hong']} vs {snapshot['nombre_chung']} "
                f"({snapshot['marcador_hong']} - {snapshot['marcador_chung']})"
            )
        except Exception as e:
            db.session.rollback()
            print(f"  [ERR] Error guardando combate: {e}")

    def _jueces_reporte(self, tatami_id, ts):
        jueces = {}
        try:
            asignaciones = AsignacionJuez.query.filter_by(tatami_id=int(tatami_id)).all()
            for asig in asignaciones:
                jueces[asig.rol_tatami] = _meta_desde_asignacion(asig)
        except Exception:
            pass

        for rol, meta in ts.get("jueces_meta", {}).items():
            if rol == "pantalla":
                continue
            if rol not in jueces or meta.get("origen") == "pin":
                jueces[rol] = {
                    "usuario_id": meta.get("usuario_id"),
                    "nombre": meta.get("nombre") or _rol_label(rol),
                    "email": meta.get("email") or "",
                    "rol_tatami": meta.get("rol_tatami") or rol,
                    "asignacion": meta.get("asignacion") or _rol_label(rol),
                    "origen": meta.get("origen") or "pin",
                    "asignado_at": meta.get("asignado_at"),
                    "asignado_por": meta.get("asignado_por"),
                }
        return jueces

    def _iniciar_crono(self, tatami_id):
        """Inicia el cronómetro del servidor para un tatami."""
        ts = _get_tatami_state(tatami_id)
        if ts["crono_activo"]:
            return
        ts["crono_activo"] = True

        def tick():
            while ts["crono_activo"]:
                socketio.sleep(1)
                if not ts["crono_activo"]:
                    break
                with _lock:
                    estado = ts["estado"]
                    if not estado.get("activo") or estado.get("segundos", 0) <= 0:
                        if estado.get("segundos", 1) <= 0:
                            estado["activo"] = False
                            _agregar_log(estado, "[TIEMPO] KuMan — Fin del tiempo", "arb")
                            ts["crono_activo"] = False
                        break
                    estado["segundos"] -= 1
                # Broadcast fuera del lock
                socketio.emit(
                    "estado",
                    {"datos": _build_estado_broadcast(ts)},
                    namespace="/combate",
                    to=_room_name(tatami_id),
                )

        ts["crono_thread"] = socketio.start_background_task(tick)

    def _detener_crono(self, tatami_id):
        """Detiene el cronómetro del servidor."""
        ts = _get_tatami_state(tatami_id)
        ts["crono_activo"] = False
