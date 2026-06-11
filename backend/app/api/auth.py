"""
API: Autenticación
Endpoints: login, register, me
"""

from datetime import datetime, timezone

from flask import Blueprint, request, jsonify
from flask_jwt_extended import (
    create_access_token,
    jwt_required,
    get_jwt_identity,
)
from ..extensions import db
from ..models.asignacion import AsignacionJuez
from ..models.usuario import Usuario
from ..security import intento_bloqueado, limpiar_intentos, segundos_restantes

auth_bp = Blueprint("auth", __name__)

# Límite de intentos de login: 5 por correo y 20 por IP cada 5 minutos
LOGIN_MAX_POR_EMAIL = 5
LOGIN_MAX_POR_IP = 20
LOGIN_VENTANA_SEG = 300


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

    ip = request.remote_addr or "?"
    clave_email = f"login:{email}"
    clave_ip = f"login-ip:{ip}"
    if (
        intento_bloqueado(clave_email, LOGIN_MAX_POR_EMAIL, LOGIN_VENTANA_SEG)
        or intento_bloqueado(clave_ip, LOGIN_MAX_POR_IP, LOGIN_VENTANA_SEG)
    ):
        espera = max(segundos_restantes(clave_email), segundos_restantes(clave_ip))
        return jsonify({
            "error": f"Demasiados intentos de inicio de sesión. Intenta de nuevo en {max(espera, 30)} segundos."
        }), 429

    user = Usuario.query.filter_by(email=email).first()
    if not user or not user.check_password(password):
        return jsonify({"error": "Credenciales inválidas"}), 401

    # Login correcto: limpiar contador de intentos fallidos
    limpiar_intentos(clave_email)

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
        creado_por_id=current_user.id,
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

    include_inactive = request.args.get("include_inactive") == "1"
    query = Usuario.query
    if not include_inactive:
        query = query.filter_by(activo=True)

    users = query.order_by(Usuario.nombre).all()
    return jsonify([u.to_dict(include_asignaciones=True) for u in users]), 200


@auth_bp.route("/users/<int:user_id>", methods=["DELETE"])
@jwt_required()
def delete_user(user_id):
    """
    DELETE /api/auth/users/:id (solo Admin)
    Desactiva el usuario y elimina sus asignaciones activas.
    """
    current_user_id = get_jwt_identity()
    current_user = Usuario.query.get(int(current_user_id))
    if not current_user or current_user.rol != "admin":
        return jsonify({"error": "Solo administradores"}), 403

    if int(current_user_id) == user_id:
        return jsonify({"error": "No puedes quitar tu propio usuario"}), 400

    user = Usuario.query.get(user_id)
    if not user:
        return jsonify({"error": "Usuario no encontrado"}), 404

    AsignacionJuez.query.filter_by(usuario_id=user.id).delete()
    user.activo = False
    user.eliminado_at = datetime.now(timezone.utc)
    db.session.commit()

    return jsonify({"message": "Usuario quitado de la aplicación"}), 200
