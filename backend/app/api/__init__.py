"""
API Blueprints Registration
"""


def register_blueprints(app):
    """Registra todos los blueprints de la API."""
    from .auth import auth_bp
    from .campeonatos import campeonatos_bp
    from .tatamis import tatamis_bp
    from .categorias import categorias_bp
    from .combates import combates_bp
    from .reportes import reportes_bp

    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    app.register_blueprint(campeonatos_bp, url_prefix="/api/campeonatos")
    app.register_blueprint(tatamis_bp, url_prefix="/api/tatamis")
    app.register_blueprint(categorias_bp, url_prefix="/api/categorias")
    app.register_blueprint(combates_bp, url_prefix="/api/combates")
    app.register_blueprint(reportes_bp, url_prefix="/api/reportes")
