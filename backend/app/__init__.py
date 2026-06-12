"""
DINAMYT Backend — Flask Application Factory
"""

import os
from flask import Flask
from dotenv import load_dotenv

from .config import config_by_name
from .extensions import db, migrate, jwt, cors, socketio


def create_app(config_name=None):
    """Crea y configura la aplicación Flask."""

    load_dotenv()

    if config_name is None:
        config_name = os.getenv("FLASK_ENV", "development")

    app = Flask(__name__)
    app.config.from_object(config_by_name.get(config_name, config_by_name["development"]))

    # ── Seguridad: en producción NO se permite arrancar con secretos débiles ──
    SECRETOS_DEBILES = {
        "dinamyt-dev-secret-key",
        "dinamyt-dev-secret-key-2026",
        "dinamyt-dev-secret-key-change-in-production",
        "CAMBIAR-POR-UN-VALOR-ALEATORIO-LARGO",
        "",
        None,
    }
    PASSWORDS_DEBILES = {"Amy2026*", "CAMBIAR-POR-UNA-CONTRASENA-FUERTE", "", None}
    if config_name == "production":
        if app.config.get("JWT_SECRET_KEY") in SECRETOS_DEBILES:
            raise RuntimeError(
                "[SEGURIDAD] JWT_SECRET_KEY usa un valor por defecto o vacío. "
                "Genera uno con: python -c \"import secrets; print(secrets.token_hex(32))\" "
                "y defínelo como variable de entorno antes de desplegar."
            )
        if app.config.get("ADMIN_PASSWORD") in PASSWORDS_DEBILES:
            raise RuntimeError(
                "[SEGURIDAD] ADMIN_PASSWORD usa un valor por defecto o vacío. "
                "Define una contraseña fuerte como variable de entorno antes de desplegar."
            )

    # ── Inicializar extensiones ──
    db.init_app(app)
    migrate.init_app(app, db)
    jwt.init_app(app)
    # FRONTEND_URL acepta varios orígenes separados por coma
    # (ej: "https://dinamyt.vercel.app,http://localhost:3000")
    origins = [
        o.strip() for o in str(app.config["FRONTEND_URL"]).split(",") if o.strip()
    ]
    cors.init_app(
        app,
        resources={r"/api/*": {"origins": origins}},
        supports_credentials=True,
        # Sin esto el navegador no puede leer el nombre de archivo de las
        # descargas (Content-Disposition) y usa un nombre genérico.
        expose_headers=["Content-Disposition"],
    )
    socketio.init_app(
        app,
        cors_allowed_origins=origins,
        async_mode=app.config.get("SOCKETIO_ASYNC_MODE", "eventlet"),
        # Heartbeat corto: en redes inestables (polideportivos) detecta el
        # corte en ~20s para que los jueces pasen al modo sin conexión rápido.
        ping_interval=10,
        ping_timeout=10,
        logger=False,
        engineio_logger=False,
    )

    # ── Importar modelos (para que Alembic los detecte) ──
    from .models import usuario, campeonato, categoria, tatami, asignacion, combate, llave  # noqa: F401

    # ── Registrar Blueprints (API REST) ──
    from .api import register_blueprints
    register_blueprints(app)

    # ── Registrar namespaces Socket.IO ──
    from .sockets import register_socketio_handlers
    register_socketio_handlers(socketio)

    # ── Comandos CLI ──
    register_cli_commands(app)

    return app


def register_cli_commands(app):
    """Registra comandos CLI personalizados."""

    @app.cli.command("seed")
    def seed_command():
        """Ejecuta los seeds de la base de datos."""
        from .seeds.seed_categorias import seed_categorias
        from .seeds.seed_admin import seed_admin

        seed_categorias()
        seed_admin(app.config)
        print("[OK] Seeds ejecutados correctamente.")

    @app.cli.command("reset-admin-password")
    def reset_admin_password_command():
        """Aplica ADMIN_PASSWORD (del .env) al usuario admin existente."""
        from .models.usuario import Usuario

        email = app.config.get("ADMIN_EMAIL", "admin@dinamyt.com")
        password = app.config.get("ADMIN_PASSWORD")
        if not password:
            print("[ERR] ADMIN_PASSWORD no está definida en el entorno.")
            return
        admin = Usuario.query.filter_by(email=email).first()
        if not admin:
            print(f"[ERR] No existe el usuario '{email}'. Ejecuta 'flask seed' primero.")
            return
        admin.set_password(password)
        db.session.commit()
        print(f"[OK] Contraseña de '{email}' actualizada con el valor de ADMIN_PASSWORD.")

    @app.cli.command("init-db")
    def init_db_command():
        """Crea todas las tablas y ejecuta seeds."""
        db.create_all()
        from .schema_compat import ensure_optional_columns
        ensure_optional_columns()
        print("[OK] Tablas creadas.")

        from .seeds.seed_categorias import seed_categorias
        from .seeds.seed_admin import seed_admin

        seed_categorias()
        seed_admin(app.config)
        print("[OK] Seeds ejecutados correctamente.")
