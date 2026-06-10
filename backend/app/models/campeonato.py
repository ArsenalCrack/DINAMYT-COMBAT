"""
Modelo: Campeonato
Un campeonato agrupa tatamis y tiene fechas.
Soporta múltiples campeonatos simultáneos.
"""

from datetime import datetime, timezone
from ..extensions import db


class Campeonato(db.Model):
    __tablename__ = "campeonatos"

    id = db.Column(db.Integer, primary_key=True)
    nombre = db.Column(db.String(255), nullable=False)
    descripcion = db.Column(db.Text, nullable=True)
    fecha_inicio = db.Column(db.Date, nullable=True)
    fecha_fin = db.Column(db.Date, nullable=True)
    activo = db.Column(db.Boolean, default=True, nullable=False)
    created_by = db.Column(
        db.Integer, db.ForeignKey("usuarios.id"), nullable=True
    )
    created_at = db.Column(
        db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False
    )

    # Relaciones
    tatamis = db.relationship(
        "Tatami", backref="campeonato", lazy="dynamic", cascade="all, delete-orphan"
    )

    def to_dict(self, include_tatamis=False):
        data = {
            "id": self.id,
            "nombre": self.nombre,
            "descripcion": self.descripcion,
            "fecha_inicio": self.fecha_inicio.isoformat() if self.fecha_inicio else None,
            "fecha_fin": self.fecha_fin.isoformat() if self.fecha_fin else None,
            "activo": self.activo,
            "created_by": self.created_by,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "num_tatamis": self.tatamis.count() if self.tatamis else 0,
        }
        if include_tatamis:
            data["tatamis"] = [t.to_dict(include_pin=True) for t in self.tatamis.all()]
        return data

    def __repr__(self):
        return f"<Campeonato {self.nombre}>"
