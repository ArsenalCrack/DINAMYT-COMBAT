"""
Modelos: AsignacionJuez y AccesoTatami

AsignacionJuez — Admin asigna un juez a un tatami con un rol específico.
AccesoTatami — Auditoría: quién entró, cuándo, con qué IP, a qué tatami.
"""

from datetime import datetime, timezone
from ..extensions import db


class AsignacionJuez(db.Model):
    __tablename__ = "asignaciones_juez"

    id = db.Column(db.Integer, primary_key=True)
    usuario_id = db.Column(
        db.Integer, db.ForeignKey("usuarios.id"), nullable=False, index=True
    )
    tatami_id = db.Column(
        db.Integer, db.ForeignKey("tatamis.id"), nullable=False, index=True
    )
    rol_tatami = db.Column(
        db.Enum("arbitro", "j1", "j2", "j3", "j4", name="rol_tatami"),
        nullable=False,
    )
    nombre_display = db.Column(db.String(150), nullable=True)
    asignado_at = db.Column(
        db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False
    )

    # Constraint: un usuario solo puede tener un rol por tatami
    __table_args__ = (
        db.UniqueConstraint(
            "usuario_id", "tatami_id", name="uq_asignacion_usuario_tatami"
        ),
    )

    def to_dict(self):
        return {
            "id": self.id,
            "usuario_id": self.usuario_id,
            "tatami_id": self.tatami_id,
            "rol_tatami": self.rol_tatami,
            "nombre_display": self.nombre_display,
            "asignado_at": self.asignado_at.isoformat() if self.asignado_at else None,
            "usuario": self.usuario.to_dict() if self.usuario else None,
        }

    def __repr__(self):
        return f"<AsignacionJuez User:{self.usuario_id} Tatami:{self.tatami_id} Rol:{self.rol_tatami}>"


class AccesoTatami(db.Model):
    __tablename__ = "accesos_tatami"

    id = db.Column(db.Integer, primary_key=True)
    tatami_id = db.Column(
        db.Integer, db.ForeignKey("tatamis.id"), nullable=False, index=True
    )
    usuario_id = db.Column(
        db.Integer, db.ForeignKey("usuarios.id"), nullable=True
    )
    nombre_visitante = db.Column(db.String(150), nullable=True)
    rol_seleccionado = db.Column(db.String(50), nullable=True)
    ip_address = db.Column(db.String(45), nullable=True)
    acceso_at = db.Column(
        db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False
    )

    def to_dict(self):
        return {
            "id": self.id,
            "tatami_id": self.tatami_id,
            "usuario_id": self.usuario_id,
            "nombre_visitante": self.nombre_visitante,
            "rol_seleccionado": self.rol_seleccionado,
            "ip_address": self.ip_address,
            "acceso_at": self.acceso_at.isoformat() if self.acceso_at else None,
        }

    def __repr__(self):
        return f"<AccesoTatami Tatami:{self.tatami_id} IP:{self.ip_address}>"
