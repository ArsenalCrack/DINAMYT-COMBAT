"""
Modelo: Categoria
Extensible: "Combate" (ahora), "Figuras" (futuro).
Cada categoría tiene su propia config_puntuacion (JSON)
que define qué botones, puntos y reglas aplican.
"""

from datetime import datetime, timezone
from ..extensions import db


class Categoria(db.Model):
    __tablename__ = "categorias"

    id = db.Column(db.Integer, primary_key=True)
    nombre = db.Column(db.String(100), nullable=False)
    slug = db.Column(db.String(100), unique=True, nullable=False, index=True)
    descripcion = db.Column(db.Text, nullable=True)
    config_puntuacion = db.Column(db.JSON, nullable=True)
    activa = db.Column(db.Boolean, default=True, nullable=False)
    created_at = db.Column(
        db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False
    )

    # Relaciones
    sesiones = db.relationship(
        "SesionTatami", backref="categoria", lazy="dynamic"
    )
    combates = db.relationship(
        "Combate", backref="categoria", lazy="dynamic"
    )

    def to_dict(self):
        return {
            "id": self.id,
            "nombre": self.nombre,
            "slug": self.slug,
            "descripcion": self.descripcion,
            "config_puntuacion": self.config_puntuacion,
            "activa": self.activa,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }

    def __repr__(self):
        return f"<Categoria {self.nombre}>"
