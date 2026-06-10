"""
Modelos: Tatami y SesionTatami

Tatami — Cada tatami pertenece a un campeonato y tiene un PIN auto-generado.
SesionTatami — Vincula un tatami con una categoría activa (ej: tatami 1 ejecuta "Combate").
"""

import random
import string
from datetime import datetime, timezone
from ..extensions import db


def _generar_pin():
    """Genera un PIN numérico de 4 dígitos."""
    return "".join(random.choices(string.digits, k=4))


class Tatami(db.Model):
    __tablename__ = "tatamis"

    id = db.Column(db.Integer, primary_key=True)
    campeonato_id = db.Column(
        db.Integer, db.ForeignKey("campeonatos.id"), nullable=False, index=True
    )
    numero = db.Column(db.Integer, nullable=False)
    pin = db.Column(db.String(10), nullable=False, default=_generar_pin)
    activo = db.Column(db.Boolean, default=True, nullable=False)
    created_at = db.Column(
        db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False
    )

    # Relaciones
    sesiones = db.relationship(
        "SesionTatami", backref="tatami", lazy="dynamic", cascade="all, delete-orphan"
    )
    asignaciones = db.relationship(
        "AsignacionJuez", backref="tatami", lazy="dynamic", cascade="all, delete-orphan"
    )
    accesos = db.relationship(
        "AccesoTatami", backref="tatami", lazy="dynamic", cascade="all, delete-orphan"
    )

    # Constraint: número único dentro de un campeonato
    __table_args__ = (
        db.UniqueConstraint("campeonato_id", "numero", name="uq_tatami_campeonato_numero"),
    )

    def regenerar_pin(self):
        """Genera un nuevo PIN para el tatami."""
        self.pin = _generar_pin()

    def to_dict(self, include_pin=False):
        data = {
            "id": self.id,
            "campeonato_id": self.campeonato_id,
            "numero": self.numero,
            "activo": self.activo,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "num_asignaciones": self.asignaciones.count(),
        }
        if include_pin:
            data["pin"] = self.pin
        return data

    def __repr__(self):
        return f"<Tatami {self.numero} (Campeonato {self.campeonato_id})>"


class SesionTatami(db.Model):
    __tablename__ = "sesiones_tatami"

    id = db.Column(db.Integer, primary_key=True)
    tatami_id = db.Column(
        db.Integer, db.ForeignKey("tatamis.id"), nullable=False, index=True
    )
    categoria_id = db.Column(
        db.Integer, db.ForeignKey("categorias.id"), nullable=False
    )
    estado = db.Column(
        db.Enum("en_espera", "en_curso", "finalizada", name="estado_sesion"),
        nullable=False,
        default="en_espera",
    )
    inicio = db.Column(db.DateTime, nullable=True)
    fin = db.Column(db.DateTime, nullable=True)

    # Relaciones
    combates = db.relationship(
        "Combate", backref="sesion", lazy="dynamic", cascade="all, delete-orphan"
    )

    def to_dict(self):
        return {
            "id": self.id,
            "tatami_id": self.tatami_id,
            "categoria_id": self.categoria_id,
            "estado": self.estado,
            "inicio": self.inicio.isoformat() if self.inicio else None,
            "fin": self.fin.isoformat() if self.fin else None,
        }

    def __repr__(self):
        return f"<SesionTatami {self.id} (Tatami {self.tatami_id}, Estado: {self.estado})>"
