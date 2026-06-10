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
import threading
from datetime import datetime, timezone
from flask import request
from flask_socketio import Namespace, emit, join_room, leave_room
from flask_jwt_extended import decode_token

from ..engine.combate_engine import (
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
from ..models.asignacion import AccesoTatami


# ══════════════════════════════════════════
#  ESTADO IN-MEMORY POR TATAMI
# ══════════════════════════════════════════
tatami_states = {}
MAX_EVENTOS_VISTOS = 500

_lock = threading.Lock()

# Acciones permitidas cuando tatami ESTÁ DESACTIVADO
ACCIONES_SIN_ACTIVACION = {
    "activar_tatami",
    "desactivar_tatami",
    "cambiar_categoria",
    "cambiar_nombre_categoria",
}


def _get_tatami_state(tatami_id):
    """Obtiene o crea el estado de un tatami."""
    tid = str(tatami_id)
    if tid not in tatami_states:
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
        }
    return tatami_states[tid]


def _room_name(tatami_id):
    return f"tatami_{tatami_id}"


def _build_estado_broadcast(ts):
    """Agrega metadatos al estado antes de broadcast."""
    estado_copy = copy.deepcopy(ts["estado"])
    estado_copy["_categoria"] = ts.get("categoria_activa", "combate")
    estado_copy["_tatami_activo"] = ts.get("tatami_activo", False)
    estado_copy["_nombre_categoria"] = ts.get("nombre_categoria", "Figuras")
    return estado_copy


class CombateNamespace(Namespace):
    """Namespace Socket.IO para combates en tiempo real."""

    def on_connect(self, auth=None):
        tatami_id = request.args.get("tatami_id")
        rol = request.args.get("rol", "pantalla")
        token = request.args.get("token")

        if not tatami_id:
            emit("error", {"message": "tatami_id requerido"})
            return False

        # Autenticación opcional
        user_id = None
        user_nombre = None
        if token:
            try:
                decoded = decode_token(token)
                user_id = decoded.get("sub")
                user_nombre = decoded.get("nombre", "")
            except Exception:
                pass

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
        ts = _get_tatami_state(tatami_id)
        emit("estado", {"datos": _build_estado_broadcast(ts)})

        print(f"  [CONN] [{_room_name(tatami_id)}] {rol} conectado (sid={request.sid})")

    def on_disconnect(self):
        pass

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

            # ── Bloqueo si tatami desactivado ──────────────────────────────
            if not ts.get("tatami_activo", False) and accion not in ACCIONES_SIN_ACTIVACION:
                if ev_id:
                    emit("ack", {"evId": ev_id})
                return  # Silently ignore

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
                nombre = ev.get("nombre", "Figuras").strip() or "Figuras"
                ts["nombre_categoria"] = nombre[:40]
                if ts.get("categoria_activa") == "figuras" and "nombre_categoria" in ts["estado"]:
                    ts["estado"]["nombre_categoria"] = nombre[:40]
                if ev_id:
                    emit("ack", {"evId": ev_id})
                self._broadcast_estado(room, ts)
                return

            # ── Nuevo combate ──────────────────────────────────────────────
            if accion == "nuevo_combate":
                self._guardar_combate_actual(tatami_id, ts)
                categoria = ts.get("categoria_activa", "combate")
                if categoria == "figuras":
                    nuevo = estado_inicial_figuras()
                    nuevo["nombre_categoria"] = ts.get("nombre_categoria", "Figuras")
                    ts["estado"] = nuevo
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
                self._detener_crono(tatami_id)
                if ev_id:
                    emit("ack", {"evId": ev_id})
                self._broadcast_estado(room, ts)
                return

            # ── Callback ganador Punto de Oro ──────────────────────────────
            def ganador_cb(nombre, color):
                payload = {
                    "tipo": "ganador-flash",
                    "nombre": nombre,
                    "color": color,
                    "motivo": "Punto de Oro",
                }
                socketio.emit("ganador-flash", payload, namespace="/combate", to=room)
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
            if categoria == "figuras":
                aplicar_evento_figuras(ts["estado"], ev)
            else:
                aplicar_evento(ts["estado"], ev, ganador_cb)

            # ── Manejar cronómetro ─────────────────────────────────────────
            if accion == "crono_start":
                self._iniciar_crono(tatami_id)
            elif accion in ("crono_pause", "crono_reset", "reset"):
                self._detener_crono(tatami_id)

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
        room = _room_name(tatami_id)
        tipo = data.get("tipo")
        if tipo in ("alerta12", "derrota", "falta-flash", "ganador-flash"):
            emit(tipo, data, to=room)

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

    def _guardar_combate_actual(self, tatami_id, ts):
        """Guarda el combate actual en la base de datos."""
        estado = ts["estado"]
        categoria = ts.get("categoria_activa", "combate")

        # Para figuras, usar guardar_figuras_snapshot
        if categoria == "figuras":
            if not estado.get("competidores"):
                return
            snapshot = guardar_figuras_snapshot(estado)
            # TODO: guardar figuras en DB — por ahora solo log
            print(f"  [OK] Figuras guardadas tatami {tatami_id}")
            return

        if not estado.get("historial"):
            return

        snapshot = guardar_combate_snapshot(estado)

        try:
            sesion = SesionTatami.query.filter_by(
                tatami_id=int(tatami_id), estado="en_curso"
            ).first()
            if not sesion:
                from ..models.categoria import Categoria
                cat = Categoria.query.filter_by(slug="combate").first()
                sesion = SesionTatami(
                    tatami_id=int(tatami_id),
                    categoria_id=cat.id if cat else None,
                    estado="en_curso",
                    inicio=datetime.now(timezone.utc),
                )
                db.session.add(sesion)
                db.session.flush()
                ts["sesion_id"] = sesion.id

            combate = Combate(
                sesion_tatami_id=sesion.id,
                categoria_id=sesion.categoria_id,
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
                ganador=(
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
                    room = _room_name(tatami_id)
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
