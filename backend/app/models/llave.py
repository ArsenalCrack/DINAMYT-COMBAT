"""
Modelo: Llave (bracket de eliminación directa)

Cada llave pertenece a un campeonato y guarda su estructura completa en JSON:
competidores sorteados aleatoriamente, byes automáticos y rondas con avance
de ganadores.
"""

from datetime import datetime, timezone
from ..extensions import db


class Llave(db.Model):
    __tablename__ = "llaves"

    id = db.Column(db.Integer, primary_key=True)
    campeonato_id = db.Column(
        db.Integer, db.ForeignKey("campeonatos.id"), nullable=False, index=True
    )
    # Tatami donde se disputa esta llave (sus combates se activan allí)
    tatami_id = db.Column(
        db.Integer, db.ForeignKey("tatamis.id"), nullable=True, index=True
    )
    nombre = db.Column(db.String(120), nullable=False)  # nombre de la categoría
    estructura = db.Column(db.JSON, nullable=False)
    created_by = db.Column(db.Integer, db.ForeignKey("usuarios.id"), nullable=True)
    created_at = db.Column(
        db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False
    )

    def to_dict(self, tatami_numero=None):
        return {
            "id": self.id,
            "campeonato_id": self.campeonato_id,
            "tatami_id": self.tatami_id,
            "tatami_numero": tatami_numero,
            "nombre": self.nombre,
            "estructura": self.estructura,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }

    def __repr__(self):
        return f"<Llave {self.nombre} (Campeonato {self.campeonato_id})>"
