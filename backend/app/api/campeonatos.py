"""
API: Campeonatos
CRUD para campeonatos — solo Admin.
"""

from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from ..extensions import db
from ..models.usuario import Usuario
from ..models.campeonato import Campeonato
from ..models.tatami import Tatami

campeonatos_bp = Blueprint("campeonatos", __name__)


def _require_admin():
    """Verifica que el usuario actual sea admin."""
    uid = get_jwt_identity()
    user = Usuario.query.get(int(uid))
    if not user or user.rol != "admin":
        return None
    return user


@campeonatos_bp.route("", methods=["GET"])
@jwt_required()
def listar():
    """GET /api/campeonatos — Lista campeonatos."""
    campeonatos = Campeonato.query.order_by(Campeonato.created_at.desc()).all()
    return jsonify([c.to_dict() for c in campeonatos]), 200


@campeonatos_bp.route("/<int:camp_id>", methods=["GET"])
@jwt_required()
def obtener(camp_id):
    """GET /api/campeonatos/:id — Obtener un campeonato con tatamis."""
    camp = Campeonato.query.get_or_404(camp_id)
    return jsonify(camp.to_dict(include_tatamis=True)), 200


@campeonatos_bp.route("", methods=["POST"])
@jwt_required()
def crear():
    """
    POST /api/campeonatos
    Body: { "nombre", "descripcion", "fecha_inicio", "fecha_fin", "num_tatamis": 6 }
    Crea el campeonato y sus tatamis con PINs auto-generados.
    """
    admin = _require_admin()
    if not admin:
        return jsonify({"error": "Solo administradores"}), 403

    data = request.get_json()
    if not data or not data.get("nombre"):
        return jsonify({"error": "Nombre del campeonato es requerido"}), 400

    from datetime import date

    camp = Campeonato(
        nombre=data["nombre"],
        descripcion=data.get("descripcion"),
        fecha_inicio=date.fromisoformat(data["fecha_inicio"]) if data.get("fecha_inicio") else None,
        fecha_fin=date.fromisoformat(data["fecha_fin"]) if data.get("fecha_fin") else None,
        activo=True,
        created_by=admin.id,
    )
    db.session.add(camp)
    db.session.flush()  # Para obtener el ID

    # Crear tatamis
    num_tatamis = data.get("num_tatamis", 6)
    for i in range(1, num_tatamis + 1):
        tatami = Tatami(
            campeonato_id=camp.id,
            numero=i,
            activo=True,
        )
        db.session.add(tatami)

    db.session.commit()

    return jsonify({
        "message": f"Campeonato '{camp.nombre}' creado con {num_tatamis} tatamis",
        "campeonato": camp.to_dict(include_tatamis=True),
    }), 201


@campeonatos_bp.route("/<int:camp_id>", methods=["PUT"])
@jwt_required()
def actualizar(camp_id):
    """PUT /api/campeonatos/:id — Actualizar campeonato."""
    admin = _require_admin()
    if not admin:
        return jsonify({"error": "Solo administradores"}), 403

    camp = Campeonato.query.get_or_404(camp_id)
    data = request.get_json()

    if data.get("nombre"):
        camp.nombre = data["nombre"]
    if "descripcion" in data:
        camp.descripcion = data["descripcion"]
    if "activo" in data:
        camp.activo = data["activo"]
    if data.get("fecha_inicio"):
        from datetime import date
        camp.fecha_inicio = date.fromisoformat(data["fecha_inicio"])
    if data.get("fecha_fin"):
        from datetime import date
        camp.fecha_fin = date.fromisoformat(data["fecha_fin"])

    db.session.commit()
    return jsonify(camp.to_dict()), 200


@campeonatos_bp.route("/<int:camp_id>", methods=["DELETE"])
@jwt_required()
def eliminar(camp_id):
    """DELETE /api/campeonatos/:id — Eliminar campeonato y tatamis."""
    admin = _require_admin()
    if not admin:
        return jsonify({"error": "Solo administradores"}), 403

    camp = Campeonato.query.get_or_404(camp_id)
    db.session.delete(camp)
    db.session.commit()
    return jsonify({"message": f"Campeonato '{camp.nombre}' eliminado"}), 200
