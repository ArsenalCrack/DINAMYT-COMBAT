import os
from datetime import timedelta


class Config:
    """Configuración base de la aplicación."""

    # Base de datos
    SQLALCHEMY_DATABASE_URI = os.getenv(
        "DATABASE_URL", "sqlite:///dinamyt.db"
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    # JWT
    JWT_SECRET_KEY = os.getenv(
        "JWT_SECRET_KEY", "dinamyt-dev-secret-key"
    )
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(hours=24)
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


config_by_name = {
    "development": DevelopmentConfig,
    "production": ProductionConfig,
}
