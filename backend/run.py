"""
DINAMYT Backend — Entry Point
Ejecutar con: python run.py
"""

import os
from dotenv import load_dotenv

load_dotenv()

from app import create_app
from app.extensions import socketio, db

app = create_app()

# Crear tablas y ejecutar seeds al iniciar (solo desarrollo)
with app.app_context():
    db.create_all()

    # Seeds automáticos en desarrollo
    if os.getenv("FLASK_ENV") == "development":
        from app.seeds.seed_categorias import seed_categorias
        from app.seeds.seed_admin import seed_admin

        seed_categorias()
        seed_admin(app.config)


if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    print(f"""
==============================================
     DINAMYT v4 -- BACKEND FLASK
==============================================
  API REST:    http://localhost:{port}
  Socket.IO:   http://localhost:{port}/combate
  Frontend:    {app.config['FRONTEND_URL']}
==============================================
  Ctrl+C para detener
==============================================
""")
    socketio.run(
        app,
        host="0.0.0.0",
        port=port,
        debug=app.config.get("DEBUG", False),
        use_reloader=False,  # eventlet no soporta reloader
        allow_unsafe_werkzeug=True,
    )
