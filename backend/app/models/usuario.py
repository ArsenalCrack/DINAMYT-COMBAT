"""
Modelo: Usuario
Roles: admin (gestiona campeonatos, tatamis, jueces) | juez (puntúa combates)
"""

from datetime import datetime, timezone
from ..extensions import db
import bcrypt


class Usuario(db.Model):
    __tablename__ = "usuarios"

    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(255), unique=True, nullable=False, index=True)
    nombre = db.Column(db.String(150), nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    rol = db.Column(
        db.Enum("admin", "juez", name="rol_usuario"),
        nullable=False,
        default="juez",
    )
    activo = db.Column(db.Boolean, default=True, nullable=False)
    created_at = db.Column(
        db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False
    )
    updated_at = db.Column(
        db.DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    # Relaciones
    campeonatos_creados = db.relationship(
        "Campeonato", backref="creador", lazy="dynamic"
    )
    asignaciones = db.relationship(
        "AsignacionJuez", backref="usuario", lazy="dynamic"
    )
    accesos = db.relationship(
        "AccesoTatami", backref="usuario", lazy="dynamic"
    )

    def set_password(self, password: str):
        """Hashea y almacena la contraseña."""
        salt = bcrypt.gensalt()
        self.password_hash = bcrypt.hashpw(
            password.encode("utf-8"), salt
        ).decode("utf-8")

    def check_password(self, password: str) -> bool:
        """Verifica la contraseña contra el hash almacenado."""
        return bcrypt.checkpw(
            password.encode("utf-8"),
            self.password_hash.encode("utf-8"),
        )

    def to_dict(self):
        return {
            "id": self.id,
            "email": self.email,
            "nombre": self.nombre,
            "rol": self.rol,
            "activo": self.activo,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }

    def __repr__(self):
        return f"<Usuario {self.email} ({self.rol})>"
