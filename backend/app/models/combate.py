"""
Modelos: Combate y EventoCombate

Combate — Resultado final de cada combate con marcadores y ganador.
EventoCombate — Cada acción delta durante un combate (para replay y auditoría).
"""

from datetime import datetime, timezone
from ..extensions import db


class Combate(db.Model):
    __tablename__ = "combates"

    id = db.Column(db.Integer, primary_key=True)
    sesion_tatami_id = db.Column(
        db.Integer, db.ForeignKey("sesiones_tatami.id"), nullable=True, index=True
    )
    categoria_id = db.Column(
        db.Integer, db.ForeignKey("categorias.id"), nullable=True
    )

    # Nombres de competidores
    nombre_hong = db.Column(db.String(150), nullable=False, default="Hong")
    nombre_chung = db.Column(db.String(150), nullable=False, default="Chung")

    # Marcadores finales
    marcador_hong = db.Column(db.Float, default=0.0)
    marcador_chung = db.Column(db.Float, default=0.0)
    esq_hong = db.Column(db.Float, default=0.0)
    esq_chung = db.Column(db.Float, default=0.0)
    arb_hong = db.Column(db.Float, default=0.0)
    arb_chung = db.Column(db.Float, default=0.0)

    # Faltas y advertencias
    kyong_hong = db.Column(db.Integer, default=0)
    kyong_chung = db.Column(db.Integer, default=0)
    faltas_hong = db.Column(db.Integer, default=0)
    faltas_chung = db.Column(db.Integer, default=0)

    # Configuración del combate
    num_jueces = db.Column(db.Integer, default=4)
    duracion_segundos = db.Column(db.Integer, default=120)
    ronda_final = db.Column(db.String(20), nullable=True)

    # Resultado
    ganador = db.Column(
        db.Enum("hong", "chung", "empate", name="ganador_combate"),
        nullable=True,
    )

    # Datos completos (JSON para historial y detalles de jueces)
    historial_completo = db.Column(db.JSON, nullable=True)
    jueces_detalle = db.Column(db.JSON, nullable=True)

    # Timestamps
    inicio = db.Column(db.DateTime, nullable=True)
    fin = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(
        db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False
    )

    # Relaciones
    eventos = db.relationship(
        "EventoCombate", backref="combate", lazy="dynamic", cascade="all, delete-orphan"
    )

    def to_dict(self, include_historial=False):
        data = {
            "id": self.id,
            "sesion_tatami_id": self.sesion_tatami_id,
            "categoria_id": self.categoria_id,
            "nombre_hong": self.nombre_hong,
            "nombre_chung": self.nombre_chung,
            "marcador_hong": self.marcador_hong,
            "marcador_chung": self.marcador_chung,
            "esq_hong": self.esq_hong,
            "esq_chung": self.esq_chung,
            "arb_hong": self.arb_hong,
            "arb_chung": self.arb_chung,
            "kyong_hong": self.kyong_hong,
            "kyong_chung": self.kyong_chung,
            "faltas_hong": self.faltas_hong,
            "faltas_chung": self.faltas_chung,
            "num_jueces": self.num_jueces,
            "duracion_segundos": self.duracion_segundos,
            "ronda_final": self.ronda_final,
            "ganador": self.ganador,
            "inicio": self.inicio.isoformat() if self.inicio else None,
            "fin": self.fin.isoformat() if self.fin else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
        if include_historial:
            data["historial_completo"] = self.historial_completo
            data["jueces_detalle"] = self.jueces_detalle
        return data

    def __repr__(self):
        return f"<Combate {self.nombre_hong} vs {self.nombre_chung}>"


class EventoCombate(db.Model):
    __tablename__ = "eventos_combate"

    id = db.Column(db.Integer, primary_key=True)
    combate_id = db.Column(
        db.Integer, db.ForeignKey("combates.id"), nullable=False, index=True
    )
    ev_id = db.Column(db.String(100), unique=True, nullable=True, index=True)
    accion = db.Column(db.String(50), nullable=False)
    datos = db.Column(db.JSON, nullable=True)
    secuencia = db.Column(db.Integer, default=0)
    created_at = db.Column(
        db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False
    )

    def to_dict(self):
        return {
            "id": self.id,
            "combate_id": self.combate_id,
            "ev_id": self.ev_id,
            "accion": self.accion,
            "datos": self.datos,
            "secuencia": self.secuencia,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }

    def __repr__(self):
        return f"<EventoCombate {self.accion} (Combate {self.combate_id})>"
