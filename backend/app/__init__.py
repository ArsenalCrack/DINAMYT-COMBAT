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

    # ── Inicializar extensiones ──
    db.init_app(app)
    migrate.init_app(app, db)
    jwt.init_app(app)
    cors.init_app(
        app,
        resources={r"/api/*": {"origins": app.config["FRONTEND_URL"]}},
        supports_credentials=True,
    )
    socketio.init_app(
        app,
        cors_allowed_origins=app.config["FRONTEND_URL"],
        async_mode=app.config.get("SOCKETIO_ASYNC_MODE", "eventlet"),
        logger=False,
        engineio_logger=False,
    )

    # ── Importar modelos (para que Alembic los detecte) ──
    from .models import usuario, campeonato, categoria, tatami, asignacion, combate  # noqa: F401

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

    @app.cli.command("init-db")
    def init_db_command():
        """Crea todas las tablas y ejecuta seeds."""
        db.create_all()
        print("[OK] Tablas creadas.")

        from .seeds.seed_categorias import seed_categorias
        from .seeds.seed_admin import seed_admin

        seed_categorias()
        seed_admin(app.config)
        print("[OK] Seeds ejecutados correctamente.")
