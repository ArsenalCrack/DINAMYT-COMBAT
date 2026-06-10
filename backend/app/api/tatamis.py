"""
API: Tatamis
Gestión de tatamis, PINs, y asignaciones de jueces.
"""

from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from ..extensions import db
from ..models.usuario import Usuario
from ..models.tatami import Tatami
from ..models.asignacion import AsignacionJuez

tatamis_bp = Blueprint("tatamis", __name__)


def _require_admin():
    uid = get_jwt_identity()
    user = Usuario.query.get(int(uid))
    if not user or user.rol != "admin":
        return None
    return user


@tatamis_bp.route("/campeonato/<int:camp_id>", methods=["GET"])
@jwt_required()
def listar_por_campeonato(camp_id):
    """GET /api/tatamis/campeonato/:camp_id — Lista tatamis de un campeonato."""
    uid = get_jwt_identity()
    user = Usuario.query.get(int(uid))

    tatamis = Tatami.query.filter_by(campeonato_id=camp_id).order_by(Tatami.numero).all()

    # Admin ve los PINs, juez no
    include_pin = user and user.rol == "admin"
    return jsonify([t.to_dict(include_pin=include_pin) for t in tatamis]), 200


@tatamis_bp.route("/<int:tatami_id>", methods=["GET"])
@jwt_required()
def obtener(tatami_id):
    """GET /api/tatamis/:id — Obtener tatami con asignaciones."""
    uid = get_jwt_identity()
    user = Usuario.query.get(int(uid))

    tatami = Tatami.query.get_or_404(tatami_id)
    data = tatami.to_dict(include_pin=(user and user.rol == "admin"))

    # Incluir asignaciones
    asignaciones = AsignacionJuez.query.filter_by(tatami_id=tatami_id).all()
    data["asignaciones"] = [a.to_dict() for a in asignaciones]

    return jsonify(data), 200


@tatamis_bp.route("/<int:tatami_id>/pin", methods=["GET"])
@jwt_required()
def ver_pin(tatami_id):
    """GET /api/tatamis/:id/pin — Ver PIN del tatami (solo admin)."""
    admin = _require_admin()
    if not admin:
        return jsonify({"error": "Solo administradores"}), 403

    tatami = Tatami.query.get_or_404(tatami_id)
    return jsonify({"tatami_id": tatami.id, "numero": tatami.numero, "pin": tatami.pin}), 200


@tatamis_bp.route("/<int:tatami_id>/regenerar-pin", methods=["POST"])
@jwt_required()
def regenerar_pin(tatami_id):
    """POST /api/tatamis/:id/regenerar-pin — Generar nuevo PIN (solo admin)."""
    admin = _require_admin()
    if not admin:
        return jsonify({"error": "Solo administradores"}), 403

    tatami = Tatami.query.get_or_404(tatami_id)
    tatami.regenerar_pin()
    db.session.commit()

    return jsonify({"pin": tatami.pin, "message": "PIN regenerado"}), 200


@tatamis_bp.route("/<int:tatami_id>/asignar", methods=["POST"])
@jwt_required()
def asignar_juez(tatami_id):
    """
    POST /api/tatamis/:id/asignar
    Body: { "usuario_id": 2, "rol_tatami": "j1" }
    """
    admin = _require_admin()
    if not admin:
        return jsonify({"error": "Solo administradores"}), 403

    data = request.get_json()
    if not data or not data.get("usuario_id") or not data.get("rol_tatami"):
        return jsonify({"error": "usuario_id y rol_tatami son requeridos"}), 400

    tatami = Tatami.query.get_or_404(tatami_id)
    user = Usuario.query.get(data["usuario_id"])
    if not user:
        return jsonify({"error": "Usuario no encontrado"}), 404

    ROLES_VALIDOS = ("arbitro", "j1", "j2", "j3", "j4", "j5", "j6", "j7")
    rol = data["rol_tatami"]
    if rol not in ROLES_VALIDOS:
        return jsonify({"error": "Rol inválido"}), 400

    # Verificar si ya existe la asignación en ESTE tatami
    existing = AsignacionJuez.query.filter_by(
        usuario_id=user.id, tatami_id=tatami.id
    ).first()

    if not existing:
        # Validación 1: ¿El usuario ya está asignado en OTRO tatami?
        otra_asig = AsignacionJuez.query.filter_by(
            usuario_id=user.id
        ).filter(AsignacionJuez.tatami_id != tatami.id).first()
        if otra_asig:
            otro_tatami = Tatami.query.get(otra_asig.tatami_id)
            num = otro_tatami.numero if otro_tatami else otra_asig.tatami_id
            return jsonify({
                "error": f"Este juez ya está asignado al Tatami {num}. Desasígnelo primero."
            }), 409

        # Validación 2: ¿El rol ya está ocupado en ESTE tatami por otro usuario?
        rol_ocupado = AsignacionJuez.query.filter_by(
            tatami_id=tatami.id, rol_tatami=rol
        ).filter(AsignacionJuez.usuario_id != user.id).first()
        if rol_ocupado:
            return jsonify({
                "error": f"El rol '{rol}' ya está asignado a otro juez en este tatami."
            }), 409

        asignacion = AsignacionJuez(
            usuario_id=user.id,
            tatami_id=tatami.id,
            rol_tatami=rol,
            nombre_display=data.get("nombre_display", user.nombre),
        )
        db.session.add(asignacion)
    else:
        # Actualizar rol — verificar que el nuevo rol no esté ocupado por alguien más
        if existing.rol_tatami != rol:
            rol_ocupado = AsignacionJuez.query.filter_by(
                tatami_id=tatami.id, rol_tatami=rol
            ).filter(AsignacionJuez.usuario_id != user.id).first()
            if rol_ocupado:
                return jsonify({
                    "error": f"El rol '{rol}' ya está asignado a otro juez en este tatami."
                }), 409
        existing.rol_tatami = rol
        existing.nombre_display = data.get("nombre_display", user.nombre)

    db.session.commit()
    return jsonify({"message": f"Juez asignado como {rol} en tatami {tatami.numero}"}), 200


@tatamis_bp.route("/<int:tatami_id>/desasignar/<int:usuario_id>", methods=["DELETE"])
@jwt_required()
def desasignar_juez(tatami_id, usuario_id):
    """DELETE /api/tatamis/:id/desasignar/:usuario_id — Quitar asignación."""
    admin = _require_admin()
    if not admin:
        return jsonify({"error": "Solo administradores"}), 403

    asig = AsignacionJuez.query.filter_by(
        usuario_id=usuario_id, tatami_id=tatami_id
    ).first()
    if not asig:
        return jsonify({"error": "Asignación no encontrada"}), 404

    db.session.delete(asig)
    db.session.commit()
    return jsonify({"message": "Asignación eliminada"}), 200


@tatamis_bp.route("/mis-tatamis", methods=["GET"])
@jwt_required()
def mis_tatamis():
    """GET /api/tatamis/mis-tatamis — Tatamis asignados al juez actual."""
    uid = get_jwt_identity()
    asignaciones = AsignacionJuez.query.filter_by(usuario_id=int(uid)).all()

    result = []
    for a in asignaciones:
        tatami = Tatami.query.get(a.tatami_id)
        if tatami:
            t_data = tatami.to_dict()
            t_data["mi_rol"] = a.rol_tatami
            t_data["campeonato_nombre"] = tatami.campeonato.nombre if tatami.campeonato else None
            result.append(t_data)

    return jsonify(result), 200


@tatamis_bp.route("/verificar-pin", methods=["POST"])
@jwt_required()
def verificar_pin():
    """
    POST /api/tatamis/verificar-pin
    Body: { "pin": "1234" }
    Permite a un juez acceder a un tatami con PIN.
    """
    uid = get_jwt_identity()
    data = request.get_json()
    pin = data.get("pin", "").strip()

    if not pin:
        return jsonify({"error": "PIN requerido"}), 400

    tatami = Tatami.query.filter_by(pin=pin, activo=True).first()
    if not tatami:
        return jsonify({"error": "PIN inválido o tatami inactivo"}), 404

    return jsonify({
        "tatami": tatami.to_dict(),
        "campeonato_nombre": tatami.campeonato.nombre if tatami.campeonato else None,
    }), 200
