import os
from datetime import timedelta

from sqlalchemy.pool import NullPool


class Config:
    """Configuración base de la aplicación."""

    # Base de datos
    SQLALCHEMY_DATABASE_URI = os.getenv(
        "DATABASE_URL", "sqlite:///dinamyt.db"
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    # El pooler de Supabase/Neon cierra conexiones inactivas; sin esto,
    # la primera petición tras un rato de calma toma una conexión muerta
    # del pool y devuelve 500. pre_ping la verifica antes de usarla.
    SQLALCHEMY_ENGINE_OPTIONS = {
        "pool_pre_ping": True,
        "pool_recycle": 300,
    }

    # JWT
    JWT_SECRET_KEY = os.getenv(
        "JWT_SECRET_KEY", "dinamyt-dev-secret-key"
    )
    # 72 h: cubre un campeonato de fin de semana sin re-login de jueces
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(hours=72)
    JWT_TOKEN_LOCATION = ["headers"]
    JWT_HEADER_NAME = "Authorization"
    JWT_HEADER_TYPE = "Bearer"

    # CORS
    FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")

    # Admin inicial
    ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "admin@dinamyt.com")
    ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "Amy2026*")
    ADMIN_NOMBRE = os.getenv("ADMIN_NOMBRE", "Administrador DINAMYT")

    # Flask-SocketIO
    SOCKETIO_ASYNC_MODE = "eventlet"


class DevelopmentConfig(Config):
    DEBUG = True


class ProductionConfig(Config):
    DEBUG = False
    SOCKETIO_ASYNC_MODE = "eventlet"
    # Bajo gunicorn -k eventlet, el QueuePool de SQLAlchemy es inutilizable:
    # eventlet no parchea threading.RLock (no distingue greenlets) y el
    # Condition del pool muere con "cannot notify on un-acquired lock" en
    # cada checkout. NullPool no usa locks ni colas: abre y cierra conexión
    # por petición, y el pooling real lo hace el Session Pooler de Supabase.
    SQLALCHEMY_ENGINE_OPTIONS = {"poolclass": NullPool}


config_by_name = {
    "development": DevelopmentConfig,
    "production": ProductionConfig,
}
