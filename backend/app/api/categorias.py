"""
API: Categorías
Lista las categorías disponibles.
"""

from flask import Blueprint, jsonify
from flask_jwt_extended import jwt_required
from ..models.categoria import Categoria

categorias_bp = Blueprint("categorias", __name__)


@categorias_bp.route("", methods=["GET"])
@jwt_required()
def listar():
    """GET /api/categorias — Lista categorías activas."""
    categorias = Categoria.query.filter_by(activa=True).order_by(Categoria.nombre).all()
    return jsonify([c.to_dict() for c in categorias]), 200


@categorias_bp.route("/<int:cat_id>", methods=["GET"])
@jwt_required()
def obtener(cat_id):
    """GET /api/categorias/:id — Detalle de una categoría con su config_puntuacion."""
    cat = Categoria.query.get_or_404(cat_id)
    return jsonify(cat.to_dict()), 200
