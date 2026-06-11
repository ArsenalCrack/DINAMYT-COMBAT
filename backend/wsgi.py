"""
DINAMYT Backend — Punto de entrada WSGI para producción.

Render / gunicorn lo usan así (un solo worker, obligatorio):
    gunicorn -k eventlet -w 1 wsgi:app

El estado de los tatamis, los rooms de Socket.IO y el limitador de
intentos viven en la memoria del proceso: NUNCA usar más de 1 worker.
"""
import os

from dotenv import load_dotenv

load_dotenv()

from app import create_app  # noqa: E402
from app.extensions import db  # noqa: E402

app = create_app(os.getenv("FLASK_ENV", "production"))

# Crear tablas y seeds en el primer arranque (idempotente)
with app.app_context():
    db.create_all()
    from app.schema_compat import ensure_optional_columns
    ensure_optional_columns()

    from app.seeds.seed_categorias import seed_categorias
    from app.seeds.seed_admin import seed_admin
    seed_categorias()
    seed_admin(app.config)
