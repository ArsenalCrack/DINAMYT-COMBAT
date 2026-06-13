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
from ..models.tatami import Tatami
from ..models.llave import Llave

llaves_bp = Blueprint("llaves", __name__)

MAX_COMPETIDORES = 64
# Figuras puntúa hasta 50 competidores (límite del motor de figuras)
MAX_COMPETIDORES_FIGURAS = 50
MIN_COMPETIDORES_FIGURAS = 2

RONDA_NOMBRES = {1: "Final", 2: "Semifinal", 3: "Cuartos", 4: "Octavos"}

# Sentinel de "ronda" para el partido por el 3er puesto (bronce). No vive en
# `rondas`, sino en `estructura["bronce"]`, para no tocar la lógica de avance.
BRONCE = "bronce"


def generar_estructura_figuras(competidores):
    """
    Estructura de un grupo de figuras: solo la lista de competidores, sin
    sorteo ni cuadro. Se mantienen `rondas` y `campeon` vacíos para que el
    front comparta el mismo tipo de dato que las llaves de combate.
    """
    comps = [
        {"id": i + 1, "nombre": c["nombre"], "club": c.get("club") or ""}
        for i, c in enumerate(competidores)
    ]
    return {"tipo": "figuras", "competidores": comps, "rondas": [], "campeon": None}


def _parse_competidores(data):
    return [
        {"nombre": str(c.get("nombre", "")).strip(), "club": str(c.get("club", "")).strip()}
        for c in (data.get("competidores") or [])
        if str(c.get("nombre", "")).strip()
    ]


def _validar_competidores(tipo, competidores):
    """Retorna un mensaje de error o None si la lista es válida para el tipo."""
    if tipo == "figuras":
        if len(competidores) < MIN_COMPETIDORES_FIGURAS:
            return (
                f"Un grupo de figuras necesita mínimo {MIN_COMPETIDORES_FIGURAS} "
                "competidores."
            )
        if len(competidores) > MAX_COMPETIDORES_FIGURAS:
            return f"Máximo {MAX_COMPETIDORES_FIGURAS} competidores en figuras."
        return None
    # Combate (eliminación)
    if len(competidores) < 3:
        return (
            "Una llave de eliminación necesita mínimo 3 competidores. "
            "Con solo 2, disputa un combate normal desde el tatami."
        )
    if len(competidores) > MAX_COMPETIDORES:
        return f"Máximo {MAX_COMPETIDORES} competidores"
    return None


def nombre_ronda(ronda_idx, total_rondas):
    """Nombre legible de una ronda: Final, Semifinal, Cuartos, ..."""
    restantes = total_rondas - ronda_idx
    return RONDA_NOMBRES.get(restantes, f"Ronda {ronda_idx + 1}")


def etiqueta_ronda(ronda_idx, total_rondas):
    """Como nombre_ronda, pero reconoce el partido por el bronce."""
    if ronda_idx == BRONCE:
        return "3er puesto"
    return nombre_ronda(ronda_idx, total_rondas)


def _semifinal_idx(estructura):
    """Índice de la ronda de semifinales (penúltima) o None."""
    rondas = estructura.get("rondas", [])
    return len(rondas) - 2 if len(rondas) >= 2 else None


def _actualizar_bronce(estructura):
    """
    Rellena `estructura["bronce"]` con los perdedores de las semifinales:
    - 2 perdedores reales → partido por el bronce a disputar.
    - 1 perdedor real (el otro lado fue bye) → ese competidor es 3° directo.
    - 0 → no hay bronce.
    Conserva el ganador del bronce si los competidores no cambiaron.
    """
    semi_idx = _semifinal_idx(estructura)
    if semi_idx is None:
        estructura.pop("bronce", None)
        return
    perdedores = []
    for p in estructura["rondas"][semi_idx]:
        if p.get("ganador") in (1, 2) and p.get("comp1") and p.get("comp2"):
            perdedores.append(p["comp2"] if p["ganador"] == 1 else p["comp1"])
        else:
            perdedores.append(None)
    reales = [x for x in perdedores if x]
    actual = estructura.get("bronce") or {}

    if len(reales) >= 2:
        comp1, comp2 = perdedores[0], perdedores[1]
        mismos = (
            (actual.get("comp1") or {}).get("id") == comp1["id"]
            and (actual.get("comp2") or {}).get("id") == comp2["id"]
        )
        estructura["bronce"] = {
            "comp1": comp1,
            "comp2": comp2,
            "ganador": actual.get("ganador") if mismos else None,
        }
    elif len(reales) == 1:
        # Bye en una semifinal: el único semifinalista es 3° sin disputar.
        estructura["bronce"] = {"comp1": reales[0], "comp2": None, "ganador": 1}
    else:
        estructura.pop("bronce", None)


def partidos_jugables(estructura):
    """Partidos con ambos competidores definidos y sin ganador, en orden.
    Incluye el partido por el bronce cuando hay dos semifinalistas."""
    jugables = []
    for r, ronda in enumerate(estructura.get("rondas", [])):
        for i, p in enumerate(ronda):
            if p.get("ganador") is None and p.get("comp1") and p.get("comp2"):
                jugables.append((r, i, p))
    bronce = estructura.get("bronce")
    if bronce and bronce.get("comp1") and bronce.get("comp2") and bronce.get("ganador") is None:
        jugables.append((BRONCE, 0, bronce))
    return jugables


def siguiente_partido(estructura):
    """
    Elige el siguiente combate a disputar.
    Se intenta que los peleadores del último combate jugado no vuelvan
    a pelear de inmediato (descanso), cuando hay otra opción disponible.
    Retorna (ronda_idx, partido_idx, partido) o None si no quedan.
    """
    jugables = partidos_jugables(estructura)
    if not jugables:
        return None
    ultimo = estructura.get("ultimo_jugado") or []
    ids_descansando = set(ultimo)
    if ids_descansando:
        for r, i, p in jugables:
            ids = {p["comp1"]["id"], p["comp2"]["id"]}
            if not (ids & ids_descansando):
                return (r, i, p)
    return jugables[0]


def registrar_resultado(estructura, ronda_idx, partido_idx, ganador):
    """
    Marca (o corrige) el ganador de un partido, propaga el avance y
    registra quiénes acaban de pelear (para darles descanso).
    Lanza ValueError si el partido o el lado no son válidos.
    """
    if ganador not in (1, 2, None):
        raise ValueError("ganador debe ser 1, 2 o null")

    # Partido por el bronce: vive aparte, no avanza a ninguna ronda.
    if ronda_idx == BRONCE:
        bronce = estructura.get("bronce")
        if not bronce or not bronce.get("comp1") or not bronce.get("comp2"):
            raise ValueError("No hay partido por el bronce disponible")
        bronce["ganador"] = ganador
        if ganador is not None:
            estructura["ultimo_jugado"] = [bronce["comp1"]["id"], bronce["comp2"]["id"]]
        return estructura

    rondas = estructura.get("rondas", [])
    if not (0 <= ronda_idx < len(rondas)) or not (0 <= partido_idx < len(rondas[ronda_idx])):
        raise ValueError("Partido no encontrado")

    partido = rondas[ronda_idx][partido_idx]
    if ganador == 1 and not partido.get("comp1"):
        raise ValueError("Ese lado del partido está vacío")
    if ganador == 2 and not partido.get("comp2"):
        raise ValueError("Ese lado del partido está vacío")

    _limpiar_descendientes(estructura, ronda_idx, partido_idx)
    partido["ganador"] = ganador
    if ganador is not None:
        _avanzar(estructura, ronda_idx, partido_idx)
        if partido.get("comp1") and partido.get("comp2"):
            estructura["ultimo_jugado"] = [
                partido["comp1"]["id"], partido["comp2"]["id"],
            ]
    # Tras cualquier cambio en semifinales, recalcular el partido por el bronce.
    _actualizar_bronce(estructura)
    return estructura


def podio_llave(estructura):
    """
    Podio de una llave de eliminación a partir del cuadro:
    1° campeón · 2° finalista perdedor · 3° perdedores de la ronda anterior a la
    final (semifinales) — bronce compartido, estándar en artes marciales.
    Retorna [] si todavía no hay campeón.
    """
    estructura = estructura or {}
    rondas = estructura.get("rondas") or []
    if not estructura.get("campeon") or not rondas:
        return []

    def _comp(c, puesto):
        return {"puesto": puesto, "nombre": c.get("nombre", "-"), "club": c.get("club", "")}

    podio = []
    final = rondas[-1][0] if rondas[-1] else None
    if final and final.get("ganador") in (1, 2):
        gan = final["comp1"] if final["ganador"] == 1 else final["comp2"]
        perd = final["comp2"] if final["ganador"] == 1 else final["comp1"]
        if gan:
            podio.append(_comp(gan, 1))
        if perd:
            podio.append(_comp(perd, 2))
    # 3°: ganador del partido por el bronce (un único 3°, sin bronce compartido).
    bronce = estructura.get("bronce") or {}
    if bronce.get("ganador") in (1, 2):
        tercero = bronce["comp1"] if bronce["ganador"] == 1 else bronce["comp2"]
        if tercero:
            podio.append(_comp(tercero, 3))
    return podio


def _info_siguiente(llave):
    """Resumen para el panel del Juez Central según el tipo de llave."""
    estructura = llave.estructura or {}
    competidores = estructura.get("competidores", [])

    # Figuras: no hay cuadro; solo importa el grupo y su estado.
    if llave.tipo_norm == "figuras":
        return {
            "num_competidores": len(competidores),
            "pendientes": 0,
            "siguiente": None,
            "campeon": None,
        }

    # Combate: siguiente partido sugerido.
    sig = siguiente_partido(estructura)
    total = len(estructura.get("rondas", []))
    return {
        "num_competidores": len(competidores),
        "pendientes": len(partidos_jugables(estructura)),
        "siguiente": None if sig is None else {
            "ronda": sig[0],
            "partido": sig[1],
            "ronda_nombre": etiqueta_ronda(sig[0], total),
            "comp1": sig[2]["comp1"],
            "comp2": sig[2]["comp2"],
        },
        "campeon": estructura.get("campeon"),
    }


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
    # Inicializa el partido por el bronce (vacío hasta jugar las semifinales).
    _actualizar_bronce(estructura)
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
    Body: {
      "campeonato_id", "nombre", "tipo"?: "combate"|"figuras",
      "descripcion"?, "tatami_id"?, "competidores": [{"nombre", "club"?}]
    }
    El tatami es opcional: sin tatami la llave queda en el pool (pendiente)
    para asignarse después.
    """
    admin = _require_admin()
    if not admin:
        return jsonify({"error": "Solo administradores"}), 403

    data = request.get_json() or {}
    campeonato_id = data.get("campeonato_id")
    tatami_id = data.get("tatami_id")
    tipo = (data.get("tipo") or "combate").strip().lower()
    nombre = (data.get("nombre") or "").strip()
    descripcion = (data.get("descripcion") or "").strip()
    competidores = _parse_competidores(data)

    if tipo not in ("combate", "figuras"):
        return jsonify({"error": "Tipo de llave inválido"}), 400
    if not campeonato_id or not Campeonato.query.get(campeonato_id):
        return jsonify({"error": "Campeonato no encontrado"}), 404
    if not nombre:
        return jsonify({"error": "El nombre de la categoría es requerido"}), 400

    # El tatami (opcional) es donde se disputará esta llave
    tatami = None
    if tatami_id:
        tatami = Tatami.query.get(int(tatami_id))
        if not tatami or tatami.campeonato_id != int(campeonato_id):
            return jsonify({"error": "El tatami no pertenece a este campeonato"}), 400

    error = _validar_competidores(tipo, competidores)
    if error:
        return jsonify({"error": error}), 400

    estructura = (
        generar_estructura_figuras(competidores) if tipo == "figuras"
        else generar_estructura(competidores)
    )
    llave = Llave(
        campeonato_id=int(campeonato_id),
        tatami_id=tatami.id if tatami else None,
        tipo=tipo,
        nombre=nombre[:120],
        descripcion=descripcion[:500] or None,
        estado="pendiente",
        estructura=estructura,
        created_by=admin.id,
    )
    db.session.add(llave)
    db.session.commit()
    mensaje = (
        "Grupo de figuras creado" if tipo == "figuras"
        else "Llave creada con sorteo aleatorio"
    )
    return jsonify({
        "message": mensaje,
        "llave": llave.to_dict(tatami_numero=tatami.numero if tatami else None),
    }), 201


@llaves_bp.route("/<int:llave_id>", methods=["PUT"])
@jwt_required()
def editar(llave_id):
    """
    PUT /api/llaves/:id
    Edita una llave SOLO si está pendiente (no activa ni terminada): nombre,
    descripción, tatami (incluido dejarla sin asignar) y competidores.
    Body: { "nombre"?, "descripcion"?, "tatami_id"?: int|null, "competidores"? }
    """
    admin = _require_admin()
    if not admin:
        return jsonify({"error": "Solo administradores"}), 403

    llave = Llave.query.get_or_404(llave_id)
    if llave.estado_norm != "pendiente":
        return jsonify({
            "error": "Solo se pueden editar llaves pendientes. Una llave activa "
                     "o terminada no se modifica para no corromper resultados."
        }), 409

    data = request.get_json() or {}
    tipo = llave.tipo_norm

    if "nombre" in data:
        nombre = (data.get("nombre") or "").strip()
        if not nombre:
            return jsonify({"error": "El nombre de la categoría es requerido"}), 400
        llave.nombre = nombre[:120]

    if "descripcion" in data:
        llave.descripcion = (data.get("descripcion") or "").strip()[:500] or None

    if "tatami_id" in data:
        tatami_id = data.get("tatami_id")
        if tatami_id in (None, "", 0):
            llave.tatami_id = None
        else:
            tatami = Tatami.query.get(int(tatami_id))
            if not tatami or tatami.campeonato_id != llave.campeonato_id:
                return jsonify({"error": "El tatami no pertenece a este campeonato"}), 400
            llave.tatami_id = tatami.id

    if "competidores" in data:
        competidores = _parse_competidores(data)
        error = _validar_competidores(tipo, competidores)
        if error:
            return jsonify({"error": error}), 400
        llave.estructura = (
            generar_estructura_figuras(competidores) if tipo == "figuras"
            else generar_estructura(competidores)
        )

    db.session.commit()
    return jsonify({
        "message": "Llave actualizada",
        "llave": _con_numero_tatami([llave])[0],
    }), 200


def _con_numero_tatami(llaves):
    """Adjunta el número de tatami a cada llave (una consulta por lote)."""
    tatami_ids = {l.tatami_id for l in llaves if l.tatami_id}
    numeros = {}
    if tatami_ids:
        for t in Tatami.query.filter(Tatami.id.in_(tatami_ids)).all():
            numeros[t.id] = t.numero
    return [l.to_dict(tatami_numero=numeros.get(l.tatami_id)) for l in llaves]


@llaves_bp.route("/campeonato/<int:camp_id>", methods=["GET"])
@jwt_required()
def listar_por_campeonato(camp_id):
    """GET /api/llaves/campeonato/:id — Llaves de un campeonato."""
    llaves = (
        Llave.query.filter_by(campeonato_id=camp_id)
        .order_by(Llave.created_at.desc())
        .all()
    )
    return jsonify(_con_numero_tatami(llaves)), 200


@llaves_bp.route("/tatami/<int:tatami_id>", methods=["GET"])
@jwt_required()
def listar_por_tatami(tatami_id):
    """
    GET /api/llaves/tatami/:id — Llaves asignadas a un tatami, con el
    siguiente combate sugerido (lo usa el panel del Juez Central).
    """
    llaves = (
        Llave.query.filter_by(tatami_id=tatami_id)
        .order_by(Llave.created_at.asc())
        .all()
    )
    result = []
    for llave_obj, datos in zip(llaves, _con_numero_tatami(llaves)):
        datos.update(_info_siguiente(llave_obj))
        # El cuadro completo no hace falta en el panel del tatami
        datos.pop("estructura", None)
        result.append(datos)
    return jsonify(result), 200


@llaves_bp.route("/<int:llave_id>", methods=["GET"])
@jwt_required()
def obtener(llave_id):
    """GET /api/llaves/:id — Detalle de una llave."""
    llave = Llave.query.get_or_404(llave_id)
    return jsonify(_con_numero_tatami([llave])[0]), 200


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
    if llave.tipo_norm != "combate":
        return jsonify({"error": "Solo las llaves de combate tienen partidos."}), 400
    data = request.get_json() or {}

    # El partido por el bronce se direcciona con ronda == "bronce".
    if data.get("ronda") == BRONCE:
        ronda_idx, partido_idx = BRONCE, 0
    else:
        try:
            ronda_idx = int(data.get("ronda"))
            partido_idx = int(data.get("partido"))
        except (TypeError, ValueError):
            return jsonify({"error": "ronda y partido son requeridos"}), 400

    ganador = data.get("ganador")

    # Copia profunda: la columna JSON requiere reasignar el objeto completo
    import copy
    estructura = copy.deepcopy(llave.estructura)
    try:
        registrar_resultado(estructura, ronda_idx, partido_idx, ganador)
    except ValueError as e:
        codigo = 404 if "no encontrado" in str(e) else 400
        return jsonify({"error": str(e)}), codigo

    llave.estructura = estructura
    # La llave queda terminada cuando ya no quedan partidos por jugar (incluido
    # el bronce); si se corrige un resultado y reaparece alguno, vuelve a abrir.
    if estructura.get("campeon") and not partidos_jugables(estructura):
        llave.estado = "terminada"
    elif llave.estado_norm == "terminada":
        llave.estado = "pendiente"
    db.session.commit()
    return jsonify({
        "message": "Resultado registrado",
        "llave": _con_numero_tatami([llave])[0],
    }), 200


@llaves_bp.route("/<int:llave_id>", methods=["DELETE"])
@jwt_required()
def eliminar(llave_id):
    """DELETE /api/llaves/:id — Eliminar una llave."""
    admin = _require_admin()
    if not admin:
        return jsonify({"error": "Solo administradores"}), 403

    llave = Llave.query.get_or_404(llave_id)
    # Capturar el nombre ANTES de borrar: tras el commit el objeto queda
    # expirado y acceder a sus atributos lanza ObjectDeletedError (500).
    nombre = llave.nombre
    db.session.delete(llave)
    db.session.commit()
    return jsonify({"message": f"Llave '{nombre}' eliminada"}), 200
