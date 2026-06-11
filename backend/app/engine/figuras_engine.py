"""
Motor de Figuras v2 — Sistema de puntuacion multi-competidor.

Cambios v2:
- Cada juez puntua UN SOLO criterio (J1=criterio[0], J2=criterio[1], etc.)
- Nota unica de 0.00 a 9.99 con 2 decimales
- El total del competidor es la SUMA de las notas de todos los jueces
- El Juez Central activa/desactiva la puntuacion por competidor
- Puntuaciones confirmadas son inmutables
- Nombre de categoria personalizable
"""
import copy
import re
import time


CRITERIOS_DEFAULT = [
    {"id": "tecnica", "nombre": "Técnica", "max_pts": 9.99},
    {"id": "fuerza", "nombre": "Fuerza / Potencia", "max_pts": 9.99},
    {"id": "equilibrio", "nombre": "Equilibrio", "max_pts": 9.99},
    {"id": "presentacion", "nombre": "Presentación", "max_pts": 9.99},
]

# Mapeo fijo juez → índice de criterio (máximo 4 jueces de esquina)
JUEZ_CRITERIO_MAP = {
    "j1": 0,
    "j2": 1,
    "j3": 2,
    "j4": 3,
}

CATEGORIA_NOMBRE_MAX = 40
CATEGORIA_NOMBRE_RE = re.compile(r"^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]+$")


def _normalizar_nombre_categoria(nombre):
    raw = str(nombre or "")
    limpio = re.sub(r"[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]", "", raw)
    return limpio[:CATEGORIA_NOMBRE_MAX]


def nombre_categoria_valido(nombre):
    valor = str(nombre or "").strip()
    return bool(valor and CATEGORIA_NOMBRE_RE.fullmatch(valor))


def criterio_para_juez(estado, juez_id):
    """Retorna el criterio asignado a un juez según su posición."""
    idx = JUEZ_CRITERIO_MAP.get(juez_id)
    if idx is None:
        return None
    criterios = estado.get("criterios", CRITERIOS_DEFAULT)
    if idx < len(criterios):
        return criterios[idx]
    return None


def estado_inicial_figuras(config=None):
    """Retorna el estado inicial de una sesion de Figuras v2."""
    criterios = list(CRITERIOS_DEFAULT)
    if config and config.get("criterios"):
        criterios = config["criterios"]

    return {
        "tipo": "figuras",
        # Configuración
        "criterios": criterios,
        "num_jueces": 4,
        # Nombre personalizable de la categoría
        "nombre_categoria": "Figuras",
        "nombres_jueces": {"j1": "", "j2": "", "j3": "", "j4": ""},
        # Competidores
        "competidores": [],       # [{id, nombre, club}]
        # Puntuaciones: { comp_id: { juez_id: valor_float } }
        "puntuaciones": {},
        # Confirmaciones: { comp_id: { juez_id: True } }
        "puntuaciones_confirmadas": {},
        # Control de turno (Juez Central)
        "competidor_activo_id": None,   # ID del competidor en turno
        "puntuacion_abierta": False,    # True = jueces pueden puntuar
        # Estado final
        "finalizado": False,
        "log": [],
}


def _agregar_log_f(estado, txt, color="info"):
    estado["log"].insert(0, {"txt": txt, "color": color, "ts": int(time.time() * 1000)})
    if len(estado["log"]) > 50:
        estado["log"] = estado["log"][:50]


def _jueces_activos_figuras(estado):
    jueces = []
    for i in range(1, int(estado.get("num_jueces", 4)) + 1):
        juez_id = f"j{i}"
        if criterio_para_juez(estado, juez_id):
            jueces.append(juez_id)
    return jueces


def puntuaciones_completas(estado):
    if not estado.get("competidores"):
        return False
    jueces = _jueces_activos_figuras(estado)
    if not jueces:
        return False
    confirmadas = estado.get("puntuaciones_confirmadas", {})
    for comp in estado["competidores"]:
        comp_id = str(comp["id"])
        for juez_id in jueces:
            if not confirmadas.get(comp_id, {}).get(juez_id):
                return False
    return True


def _juez_meta_evento(ev, juez_fallback):
    return {
        "nombre": ev.get("juez_nombre") or juez_fallback,
        "email": ev.get("juez_email") or "",
        "asignacion": ev.get("juez_asignacion") or juez_fallback,
        "rol": ev.get("juez_rol") or juez_fallback,
        "acceso": ev.get("juez_acceso") or "",
    }


def _juez_log_label(ev, juez_fallback):
    meta = _juez_meta_evento(ev, juez_fallback)
    base = f"{meta['asignacion']}: {meta['nombre']}"
    return f"{base} <{meta['email']}>" if meta["email"] else base


def calcular_total_competidor(estado, competidor_id):
    """
    Total = suma de todas las notas de todos los jueces para ese competidor.
    Cada juez aporta un solo número.
    """
    puntajes = estado["puntuaciones"].get(str(competidor_id), {})
    if not puntajes:
        return 0.0
    return round(sum(puntajes.values()), 2)


def calcular_ranking(estado):
    """Retorna la lista de competidores ordenados por total desc."""
    ranking = []
    for comp in estado["competidores"]:
        cid = str(comp["id"])
        total = calcular_total_competidor(estado, cid)
        ranking.append({**comp, "total": total})
    ranking.sort(key=lambda x: x["total"], reverse=True)
    for i, item in enumerate(ranking):
        item["puesto"] = i + 1
    return ranking


def _parse_puntuacion(valor):
    """
    Valida puntuaciones con dos decimales obligatorios: 0.00 a 9.99.
    El valor puede llegar como string desde el cliente o como numero legacy.
    """
    raw = str(valor).strip().replace(",", ".")
    if not re.fullmatch(r"\d\.\d{2}", raw):
        return None
    numero = float(raw)
    if numero < 0 or numero > 9.99:
        return None
    return round(numero, 2)


def aplicar_evento_figuras(estado, ev):
    """Aplica un evento al estado de Figuras v2."""
    accion = ev.get("accion")

    # ── Nombre de categoría ──────────────────────────────────────────────────
    if accion == "cambiar_nombre_categoria":
        estado["nombre_categoria"] = _normalizar_nombre_categoria(ev.get("nombre", ""))

    # ── Número de jueces (máximo 4 de esquina) ──────────────────────────────
    elif accion == "set_num_jueces":
        estado["num_jueces"] = max(2, min(4, int(ev.get("num_jueces", 4))))

    # ── Competidores ─────────────────────────────────────────────────────────
    elif accion == "agregar_competidor":
        nombre = ev.get("nombre", "Competidor").strip()
        club = ev.get("club", "").strip()
        if not nombre:
            return estado
        if len(estado["competidores"]) >= 50:
            return estado
        max_id = max((c["id"] for c in estado["competidores"]), default=0)
        nuevo_id = max_id + 1
        estado["competidores"].append({
            "id": nuevo_id,
            "nombre": nombre,
            "club": club,
        })
        estado["puntuaciones"][str(nuevo_id)] = {}
        estado["puntuaciones_confirmadas"][str(nuevo_id)] = {}
        _agregar_log_f(estado, f"[+] {nombre}", "info")

    elif accion == "eliminar_competidor":
        cid = ev.get("competidor_id")
        estado["competidores"] = [
            c for c in estado["competidores"] if str(c["id"]) != str(cid)
        ]
        estado["puntuaciones"].pop(str(cid), None)
        estado["puntuaciones_confirmadas"].pop(str(cid), None)
        if str(estado.get("competidor_activo_id")) == str(cid):
            estado["competidor_activo_id"] = None
            estado["puntuacion_abierta"] = False
        _agregar_log_f(estado, "[-] Competidor eliminado", "info")

    # ── Control de turno (Juez Central) ─────────────────────────────────────
    elif accion == "activar_competidor":
        comp_id = ev.get("competidor_id")
        # Verificar que existe
        comp = next(
            (c for c in estado["competidores"] if str(c["id"]) == str(comp_id)),
            None
        )
        if comp:
            # No se puede pasar a otro competidor si al activo le falta
            # alguna puntuación por confirmar.
            activo_id = estado.get("competidor_activo_id")
            if activo_id is not None and str(activo_id) != str(comp["id"]):
                jueces = _jueces_activos_figuras(estado)
                confirmadas = estado.get("puntuaciones_confirmadas", {}).get(
                    str(activo_id), {}
                )
                if jueces and not all(confirmadas.get(j) for j in jueces):
                    _agregar_log_f(
                        estado,
                        "[TURNO] Bloqueado: el competidor en turno tiene puntuaciones pendientes",
                        "arb",
                    )
                    return estado
            estado["competidor_activo_id"] = comp["id"]
            estado["puntuacion_abierta"] = True
            _agregar_log_f(estado, f"[TURNO] {comp['nombre']}", "arb")

    elif accion == "cerrar_puntuacion":
        estado["puntuacion_abierta"] = False
        _agregar_log_f(estado, "[CERRADO] Puntuación cerrada", "arb")

    # ── Puntuación (un solo valor por juez por competidor) ───────────────────
    elif accion == "puntuar":
        juez_id = ev.get("juez_id")
        comp_id = str(ev.get("competidor_id", ""))
        valor = ev.get("valor", "")

        # Validar apertura
        if not estado.get("puntuacion_abierta"):
            return estado

        # Solo el competidor activo
        if str(estado.get("competidor_activo_id", "")) != comp_id:
            return estado

        # No si ya fue confirmada
        confirmadas = estado.get("puntuaciones_confirmadas", {})
        if confirmadas.get(comp_id, {}).get(juez_id):
            return estado

        if not criterio_para_juez(estado, juez_id):
            return estado

        # Validar y formatear valor (0.00 - 9.99, 2 decimales obligatorios)
        valor = _parse_puntuacion(valor)
        if valor is None:
            return estado

        if comp_id not in estado["puntuaciones"]:
            estado["puntuaciones"][comp_id] = {}
        estado["puntuaciones"][comp_id][juez_id] = valor

        # Log
        comp_nombre = next(
            (c["nombre"] for c in estado["competidores"] if str(c["id"]) == comp_id),
            comp_id
        )
        criterio = criterio_para_juez(estado, juez_id)
        crit_nombre = criterio["nombre"] if criterio else juez_id
        _agregar_log_f(
            estado,
            f"[{juez_id}] {comp_nombre}: {valor:.2f} ({crit_nombre}) · {_juez_log_label(ev, juez_id)}",
            "info",
        )

    # ── Confirmar puntuación (inmutable después de esto) ─────────────────────
    elif accion == "confirmar_puntuacion":
        juez_id = ev.get("juez_id")
        comp_id = str(ev.get("competidor_id", ""))

        # Solo se confirma durante la ventana abierta para el competidor activo.
        if not estado.get("puntuacion_abierta"):
            return estado
        if str(estado.get("competidor_activo_id", "")) != comp_id:
            return estado

        # Solo si tiene puntuación registrada
        if estado["puntuaciones"].get(comp_id, {}).get(juez_id) is None:
            return estado

        if comp_id not in estado["puntuaciones_confirmadas"]:
            estado["puntuaciones_confirmadas"][comp_id] = {}
        estado["puntuaciones_confirmadas"][comp_id][juez_id] = True

        valor = estado["puntuaciones"][comp_id][juez_id]
        comp_nombre = next(
            (c["nombre"] for c in estado["competidores"] if str(c["id"]) == comp_id),
            comp_id
        )
        _agregar_log_f(
            estado,
            f"[✓] {comp_nombre} = {valor:.2f} CONFIRMADO · {_juez_log_label(ev, juez_id)}",
            "info",
        )
        # Podio automático: al confirmar la última puntuación pendiente
        # se finaliza la categoría y el podio aparece en pantalla.
        if puntuaciones_completas(estado):
            estado["finalizado"] = True
            estado["puntuacion_abierta"] = False
            _agregar_log_f(estado, "[PODIO] Puntuaciones completas — Podio habilitado", "arb")

    # ── Nombre de juez ───────────────────────────────────────────────────────
    elif accion == "set_nombre_juez":
        juez_id = ev.get("juez_id")
        nombre = ev.get("nombre", "")
        if juez_id and "nombres_jueces" in estado:
            estado["nombres_jueces"][juez_id] = nombre

    # ── Finalizar sesión ─────────────────────────────────────────────────────
    elif accion == "finalizar":
        # El podio solo se muestra cuando todos los competidores pasaron y
        # fueron calificados en todos sus criterios.
        if not puntuaciones_completas(estado):
            _agregar_log_f(
                estado,
                "[PODIO] Bloqueado: faltan competidores o criterios por calificar",
                "arb",
            )
            return estado
        estado["finalizado"] = True
        estado["puntuacion_abierta"] = False
        ranking = calcular_ranking(estado)
        if ranking:
            ganador = ranking[0]
            _agregar_log_f(
                estado,
                f"[1°] {ganador['nombre']} — {ganador['total']} pts",
                "info"
            )

    # ── Reset ────────────────────────────────────────────────────────────────
    elif accion in ("reset_figuras", "reset"):
        config = ev.get("config") if accion == "reset_figuras" else None
        nombre_cat = estado.get("nombre_categoria", "Figuras")
        num_j = estado.get("num_jueces", 4)
        criterios = estado.get("criterios", CRITERIOS_DEFAULT)
        nuevo = estado_inicial_figuras(config)
        nuevo["nombre_categoria"] = nombre_cat
        nuevo["num_jueces"] = num_j
        if not config:
            nuevo["criterios"] = criterios
        estado.update(nuevo)
        estado.pop("podio_modo", None)

    return estado


def guardar_figuras_snapshot(estado):
    """Snapshot para persistir en DB."""
    ranking = calcular_ranking(estado)
    return {
        "tipo": "figuras",
        "nombre_categoria": estado.get("nombre_categoria", "Figuras"),
        "competidores": copy.deepcopy(estado["competidores"]),
        "criterios": copy.deepcopy(estado["criterios"]),
        "puntuaciones": copy.deepcopy(estado["puntuaciones"]),
        "puntuaciones_confirmadas": copy.deepcopy(
            estado.get("puntuaciones_confirmadas", {})
        ),
        "ranking": ranking,
        "num_jueces": estado["num_jueces"],
        "puntuaciones_completas": puntuaciones_completas(estado),
        "finalizado": estado["finalizado"],
        "log": copy.deepcopy(estado.get("log", [])),
    }
