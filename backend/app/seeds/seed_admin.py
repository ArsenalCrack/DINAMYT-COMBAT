"""
Seed: Admin inicial
Crea el usuario admin con la contraseña configurada.
"""

from ..extensions import db
from ..models.usuario import Usuario


def seed_admin(config):
    """Crea el usuario admin inicial si no existe."""
    email = config.get("ADMIN_EMAIL", "admin@dinamyt.com")
    password = config.get("ADMIN_PASSWORD", "Amy2026*")
    nombre = config.get("ADMIN_NOMBRE", "Administrador DINAMYT")

    admin = Usuario.query.filter_by(email=email).first()
    if admin:
        print(f"  [OK] Admin '{email}' ya existe.")
        return

    admin = Usuario(
        email=email,
        nombre=nombre,
        rol="admin",
        activo=True,
    )
    admin.set_password(password)
    db.session.add(admin)
    db.session.commit()
    print(f"  [OK] Admin '{email}' creado con password configurada.")
