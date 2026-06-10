"""
API: Autenticación
Endpoints: login, register, me
"""

from flask import Blueprint, request, jsonify
from flask_jwt_extended import (
    create_access_token,
    jwt_required,
    get_jwt_identity,
)
from ..extensions import db
from ..models.usuario import Usuario

auth_bp = Blueprint("auth", __name__)


@auth_bp.route("/login", methods=["POST"])
def login():
    """
    POST /api/auth/login
    Body: { "email": "...", "password": "..." }
    Returns: { "token": "...", "user": {...} }
    """
    data = request.get_json()
    if not data:
        return jsonify({"error": "Datos requeridos"}), 400

    email = data.get("email", "").strip().lower()
    password = data.get("password", "")

    if not email or not password:
        return jsonify({"error": "Email y contraseña son requeridos"}), 400

    user = Usuario.query.filter_by(email=email).first()
    if not user or not user.check_password(password):
        return jsonify({"error": "Credenciales inválidas"}), 401

    if not user.activo:
        return jsonify({"error": "Usuario desactivado"}), 403

    # Crear token JWT con identity como string del user ID
    token = create_access_token(
        identity=str(user.id),
        additional_claims={
            "rol": user.rol,
            "nombre": user.nombre,
            "email": user.email,
        },
    )

    return jsonify({
        "token": token,
        "user": user.to_dict(),
    }), 200


@auth_bp.route("/register", methods=["POST"])
@jwt_required()
def register():
    """
    POST /api/auth/register (solo Admin)
    Body: { "email": "...", "password": "...", "nombre": "...", "rol": "juez" }
    """
    # Verificar que el usuario actual sea admin
    current_user_id = get_jwt_identity()
    current_user = Usuario.query.get(int(current_user_id))
    if not current_user or current_user.rol != "admin":
        return jsonify({"error": "Solo administradores pueden crear usuarios"}), 403

    data = request.get_json()
    if not data:
        return jsonify({"error": "Datos requeridos"}), 400

    email = data.get("email", "").strip().lower()
    password = data.get("password", "")
    nombre = data.get("nombre", "").strip()
    rol = data.get("rol", "juez")

    if not email or not password or not nombre:
        return jsonify({"error": "Email, contraseña y nombre son requeridos"}), 400

    if rol not in ("admin", "juez"):
        return jsonify({"error": "Rol debe ser 'admin' o 'juez'"}), 400

    if Usuario.query.filter_by(email=email).first():
        return jsonify({"error": f"El email '{email}' ya está registrado"}), 409

    new_user = Usuario(
        email=email,
        nombre=nombre,
        rol=rol,
        activo=True,
    )
    new_user.set_password(password)
    db.session.add(new_user)
    db.session.commit()

    return jsonify({
        "message": f"Usuario '{nombre}' creado exitosamente",
        "user": new_user.to_dict(),
    }), 201


@auth_bp.route("/me", methods=["GET"])
@jwt_required()
def me():
    """
    GET /api/auth/me
    Retorna datos del usuario autenticado.
    """
    current_user_id = get_jwt_identity()
    user = Usuario.query.get(int(current_user_id))
    if not user:
        return jsonify({"error": "Usuario no encontrado"}), 404

    # Incluir tatamis asignados si es juez
    data = user.to_dict()
    if user.rol == "juez":
        from ..models.asignacion import AsignacionJuez
        asignaciones = AsignacionJuez.query.filter_by(usuario_id=user.id).all()
        data["tatamis_asignados"] = [a.to_dict() for a in asignaciones]

    return jsonify(data), 200


@auth_bp.route("/users", methods=["GET"])
@jwt_required()
def list_users():
    """
    GET /api/auth/users (solo Admin)
    Lista todos los usuarios.
    """
    current_user_id = get_jwt_identity()
    current_user = Usuario.query.get(int(current_user_id))
    if not current_user or current_user.rol != "admin":
        return jsonify({"error": "Solo administradores"}), 403

    users = Usuario.query.order_by(Usuario.nombre).all()
    return jsonify([u.to_dict() for u in users]), 200
