"""
Modelo: Llave (cola de categoría asignable a un tatami)

Una llave agrupa competidores de una categoría y se encola para disputarse en
un tatami. Hay dos tipos:

- "combate": eliminación directa. `estructura` guarda el cuadro completo
  (competidores sorteados, byes automáticos y rondas con avance de ganadores).
- "figuras": grupo puntuado. `estructura` solo guarda la lista de competidores
  (sin rondas); al activarla, el Juez Central puntúa y se arma el podio.

Estado del ciclo de vida (`estado`): "pendiente" → "activa" → "terminada".
El `tatami_id` es opcional: una llave puede quedar en el pool sin asignar y
asignarse después, a medida que un tatami se desocupa.
"""

from datetime import datetime, timezone
from ..extensions import db

TIPOS = ("combate", "figuras")
ESTADOS = ("pendiente", "activa", "terminada")


class Llave(db.Model):
    __tablename__ = "llaves"

    id = db.Column(db.Integer, primary_key=True)
    campeonato_id = db.Column(
        db.Integer, db.ForeignKey("campeonatos.id"), nullable=False, index=True
    )
    # Tatami donde se disputa esta llave (sus combates se activan allí).
    # Nullable: las llaves del pool esperan sin tatami hasta que se asigne una.
    tatami_id = db.Column(
        db.Integer, db.ForeignKey("tatamis.id"), nullable=True, index=True
    )
    # "combate" (eliminación) | "figuras" (grupo puntuado). NULL = combate
    # (compatibilidad con llaves creadas antes de esta columna).
    tipo = db.Column(db.String(20), nullable=True)
    nombre = db.Column(db.String(120), nullable=False)  # nombre de la categoría
    # Descripción pública (ej: "Intermedios 15-17 años"). Admite números, a
    # diferencia del nombre de categoría que se normaliza a solo letras.
    descripcion = db.Column(db.Text, nullable=True)
    # "pendiente" | "activa" | "terminada". NULL = pendiente (compatibilidad).
    estado = db.Column(db.String(20), nullable=True)
    estructura = db.Column(db.JSON, nullable=False)
    created_by = db.Column(db.Integer, db.ForeignKey("usuarios.id"), nullable=True)
    created_at = db.Column(
        db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False
    )

    @property
    def tipo_norm(self):
        """Tipo efectivo: las llaves antiguas (NULL) son de combate."""
        return self.tipo or "combate"

    @property
    def estado_norm(self):
        """Estado efectivo: NULL se interpreta como pendiente."""
        return self.estado or "pendiente"

    def to_dict(self, tatami_numero=None):
        return {
            "id": self.id,
            "campeonato_id": self.campeonato_id,
            "tatami_id": self.tatami_id,
            "tatami_numero": tatami_numero,
            "tipo": self.tipo_norm,
            "nombre": self.nombre,
            "descripcion": self.descripcion or "",
            "estado": self.estado_norm,
            "estructura": self.estructura,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }

    def __repr__(self):
        return f"<Llave {self.tipo_norm}:{self.nombre} (Campeonato {self.campeonato_id})>"
