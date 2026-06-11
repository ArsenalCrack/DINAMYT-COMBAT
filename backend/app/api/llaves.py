"""
API: Llaves de eliminación directa (brackets)

- El admin crea una llave con la lista de competidores.
- El sistema los distribuye aleatoriamente y asigna byes automáticos
  (pases directos) cuando el número no es potencia de 2.
- Los ganadores avanzan ronda a ronda hasta la final.
"""

import math
import random

from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from ..extensions import db
from ..models.usuario import Usuario
from ..models.campeonato import Campeonato
from ..models.llave import Llave

llaves_bp = Blueprint("llaves", __name__)

MAX_COMPETIDORES = 64


def _require_admin():
    uid = get_jwt_identity()
    user = Usuario.query.get(int(uid))
    if not user or user.rol != "admin":
        return None
    return user


def generar_estructura(competidores):
    """
    Genera la estructura del bracket:
    - Sorteo aleatorio de competidores.
    - Tamaño = siguiente potencia de 2; los byes se reparten para que
      ningún competidor enfrente a otro bye en la primera ronda.
    - Los byes avanzan automáticamente a la segunda ronda.
    """
    comps = [
        {"id": i + 1, "nombre": c["nombre"], "club": c.get("club") or ""}
        for i, c in enumerate(competidores)
    ]
    random.shuffle(comps)

    n = len(comps)
    size = 2 ** max(1, math.ceil(math.log2(n))) if n > 1 else 2
    num_byes = size - n

    # Primera ronda: los primeros `num_byes` sorteados reciben bye;
    # el resto se empareja en orden de sorteo.
    partidos_r0 = []
    for i in range(num_byes):
        partidos_r0.append({"comp1": comps[i], "comp2": None, "ganador": None})
    resto = comps[num_byes:]
    for i in range(0, len(resto), 2):
        comp2 = resto[i + 1] if i + 1 < len(resto) else None
        partidos_r0.append({"comp1": resto[i], "comp2": comp2, "ganador": None})
    # Mezclar el orden de los partidos para repartir los byes en el cuadro
    random.shuffle(partidos_r0)

    # Rondas siguientes vacías
    rondas = [partidos_r0]
    partidos_en_ronda = len(partidos_r0)
    while partidos_en_ronda > 1:
        partidos_en_ronda //= 2
        rondas.append([
            {"comp1": None, "comp2": None, "ganador": None}
            for _ in range(partidos_en_ronda)
        ])

    estructura = {"competidores": comps, "rondas": rondas, "campeon": None}

    # Avanzar byes automáticamente
    for idx, partido in enumerate(rondas[0]):
        if partido["comp1"] and not partido["comp2"]:
            partido["ganador"] = 1
            _avanzar(estructura, 0, idx)
    return estructura


def _avanzar(estructura, ronda_idx, partido_idx):
    """Coloca al ganador de un partido en su lugar de la siguiente ronda."""
    rondas = estructura["rondas"]
    partido = rondas[ronda_idx][partido_idx]
    ganador = None
    if partido["ganador"] == 1:
        ganador = partido["comp1"]
    elif partido["ganador"] == 2:
        ganador = partido["comp2"]

    if ronda_idx == len(rondas) - 1:
        estructura["campeon"] = ganador
        return

    siguiente = rondas[ronda_idx + 1][partido_idx // 2]
    slot = "comp1" if partido_idx % 2 == 0 else "comp2"
    siguiente[slot] = ganador


def _limpiar_descendientes(estructura, ronda_idx, partido_idx):
    """
    Si se corrige un resultado, borra todo lo que dependía de él
    (ganadores y posiciones en rondas siguientes).
    """
    rondas = estructura["rondas"]
    if ronda_idx == len(rondas) - 1:
        estructura["campeon"] = None
        return
    sig_idx = partido_idx // 2
    siguiente = rondas[ronda_idx + 1][sig_idx]
    slot = "comp1" if partido_idx % 2 == 0 else "comp2"
    if siguiente[slot] is not None or siguiente["ganador"] is not None:
        siguiente[slot] = None
        siguiente["ganador"] = None
        _limpiar_descendientes(estructura, ronda_idx + 1, sig_idx)


@llaves_bp.route("", methods=["POST"])
@jwt_required()
def crear():
    """
    POST /api/llaves
    Body: { "campeonato_id", "nombre", "competidores": [{"nombre", "club"?}] }
    """
    admin = _require_admin()
    if not admin:
        return jsonify({"error": "Solo administradores"}), 403

    data = request.get_json() or {}
    campeonato_id = data.get("campeonato_id")
    nombre = (data.get("nombre") or "").strip()
    competidores = data.get("competidores") or []

    if not campeonato_id or not Campeonato.query.get(campeonato_id):
        return jsonify({"error": "Campeonato no encontrado"}), 404
    if not nombre:
        return jsonify({"error": "El nombre de la llave es requerido"}), 400

    competidores = [
        {"nombre": str(c.get("nombre", "")).strip(), "club": str(c.get("club", "")).strip()}
        for c in competidores
        if str(c.get("nombre", "")).strip()
    ]
    if len(competidores) < 2:
        return jsonify({"error": "Se necesitan al menos 2 competidores"}), 400
    if len(competidores) > MAX_COMPETIDORES:
        return jsonify({"error": f"Máximo {MAX_COMPETIDORES} competidores"}), 400

    llave = Llave(
        campeonato_id=int(campeonato_id),
        nombre=nombre[:120],
        estructura=generar_estructura(competidores),
        created_by=admin.id,
    )
    db.session.add(llave)
    db.session.commit()
    return jsonify({"message": "Llave creada con sorteo aleatorio", "llave": llave.to_dict()}), 201


@llaves_bp.route("/campeonato/<int:camp_id>", methods=["GET"])
@jwt_required()
def listar_por_campeonato(camp_id):
    """GET /api/llaves/campeonato/:id — Llaves de un campeonato."""
    llaves = (
        Llave.query.filter_by(campeonato_id=camp_id)
        .order_by(Llave.created_at.desc())
        .all()
    )
    return jsonify([l.to_dict() for l in llaves]), 200


@llaves_bp.route("/<int:llave_id>", methods=["GET"])
@jwt_required()
def obtener(llave_id):
    """GET /api/llaves/:id — Detalle de una llave."""
    llave = Llave.query.get_or_404(llave_id)
    return jsonify(llave.to_dict()), 200


@llaves_bp.route("/<int:llave_id>/partido", methods=["PUT"])
@jwt_required()
def marcar_ganador(llave_id):
    """
    PUT /api/llaves/:id/partido
    Body: { "ronda": 0, "partido": 1, "ganador": 1|2|null }
    Marca (o corrige) el ganador de un partido y avanza el cuadro.
    """
    admin = _require_admin()
    if not admin:
        return jsonify({"error": "Solo administradores"}), 403

    llave = Llave.query.get_or_404(llave_id)
    data = request.get_json() or {}

    try:
        ronda_idx = int(data.get("ronda"))
        partido_idx = int(data.get("partido"))
    except (TypeError, ValueError):
        return jsonify({"error": "ronda y partido son requeridos"}), 400

    ganador = data.get("ganador")
    if ganador not in (1, 2, None):
        return jsonify({"error": "ganador debe ser 1, 2 o null"}), 400

    # Copia profunda implícita: JSON column requiere reasignar el objeto
    import copy
    estructura = copy.deepcopy(llave.estructura)
    rondas = estructura.get("rondas", [])
    if not (0 <= ronda_idx < len(rondas)) or not (0 <= partido_idx < len(rondas[ronda_idx])):
        return jsonify({"error": "Partido no encontrado"}), 404

    partido = rondas[ronda_idx][partido_idx]
    if ganador == 1 and not partido.get("comp1"):
        return jsonify({"error": "Ese lado del partido está vacío"}), 400
    if ganador == 2 and not partido.get("comp2"):
        return jsonify({"error": "Ese lado del partido está vacío"}), 400

    # Corregir resultado previo: limpiar lo que dependía de él
    _limpiar_descendientes(estructura, ronda_idx, partido_idx)
    partido["ganador"] = ganador
    if ganador is not None:
        _avanzar(estructura, ronda_idx, partido_idx)

    llave.estructura = estructura
    db.session.commit()
    return jsonify({"message": "Resultado registrado", "llave": llave.to_dict()}), 200


@llaves_bp.route("/<int:llave_id>", methods=["DELETE"])
@jwt_required()
def eliminar(llave_id):
    """DELETE /api/llaves/:id — Eliminar una llave."""
    admin = _require_admin()
    if not admin:
        return jsonify({"error": "Solo administradores"}), 403

    llave = Llave.query.get_or_404(llave_id)
    db.session.delete(llave)
    db.session.commit()
    return jsonify({"message": f"Llave '{llave.nombre}' eliminada"}), 200
