"""
Seed: Categorias "Combate" y "Figuras"
Crea las categorias iniciales con su config_puntuacion completa.
"""

from ..extensions import db
from ..models.categoria import Categoria


# Configuracion de puntuacion para la categoria "Combate"
COMBATE_CONFIG = {
    "tipo": "combate",
    "puntos_esquina": [
        {"nombre": "Golpe/Patada cuerpo", "pts": 1, "label": "CUERPO"},
        {"nombre": "Giro cuerpo / Pat. cabeza", "pts": 2, "label": "GIRO CUERPO / PAT. CABEZA"},
        {"nombre": "Giro a la cabeza", "pts": 3, "label": "GIRO CABEZA"},
    ],
    "puntos_arbitro": [
        {"nombre": "Knock Down", "pts": 2, "label": "Knock Down"},
        {"nombre": "Derribo/Barrida", "pts": 2, "label": "Derribo/Barrida"},
        {"nombre": "Proyeccion", "pts": 2, "label": "Proyeccion / Lanzamiento"},
    ],
    "faltas": {
        "kyonggo": {"pts": -0.5, "label": "KyongGo"},
        "gamjeum": {"pts": -1, "label": "GamJeum"},
        "max_kyonggo_dq": 6,
        "max_gamjeum_dq": 3,
    },
    "formula": "promedio_esquinas + arbitro",
    "alerta_diferencia": 12,
    "rondas": [
        {"id": "r1", "nombre": "ILHaeJon - Round 1"},
        {"id": "r2", "nombre": "EeHaeJon - Round 2"},
        {"id": "oro", "nombre": "Punto de Oro"},
    ],
    "duraciones": [30, 60, 90, 120],
    "duracion_default": 120,
    "max_jueces_esquina": 4,
    "min_jueces_esquina": 2,
    "roles": ["arbitro", "j1", "j2", "j3", "j4", "pantalla"],
}

# Configuracion de puntuacion para la categoria "Figuras"
FIGURAS_CONFIG = {
    "tipo": "figuras",
    "criterios": [
        {"id": "tecnica", "nombre": "Tecnica", "max_pts": 10},
        {"id": "fuerza", "nombre": "Fuerza/Potencia", "max_pts": 10},
        {"id": "equilibrio", "nombre": "Equilibrio", "max_pts": 10},
        {"id": "presentacion", "nombre": "Presentacion", "max_pts": 10},
    ],
    "max_competidores": 30,
    "max_jueces": 7,
    "formula": "promedio_jueces_por_criterio",
    "roles": ["arbitro", "j1", "j2", "j3", "j4", "j5", "j6", "j7", "pantalla"],
}


def seed_categorias():
    """Crea o actualiza las categorias Combate y Figuras."""
    # Combate
    cat = Categoria.query.filter_by(slug="combate").first()
    if cat:
        cat.config_puntuacion = COMBATE_CONFIG
        print("  [OK] Categoria 'Combate' actualizada.")
    else:
        cat = Categoria(
            nombre="Combate",
            slug="combate",
            descripcion="Combate de Hapkido - puntuacion por jueces de esquina y refereri central.",
            config_puntuacion=COMBATE_CONFIG,
            activa=True,
        )
        db.session.add(cat)
        print("  [OK] Categoria 'Combate' creada.")

    # Figuras
    fig = Categoria.query.filter_by(slug="figuras").first()
    if fig:
        fig.config_puntuacion = FIGURAS_CONFIG
        print("  [OK] Categoria 'Figuras' actualizada.")
    else:
        fig = Categoria(
            nombre="Figuras",
            slug="figuras",
            descripcion="Figuras de Hapkido - puntuacion multi-competidor por criterios: Tecnica, Fuerza/Potencia, Equilibrio, Presentacion.",
            config_puntuacion=FIGURAS_CONFIG,
            activa=True,
        )
        db.session.add(fig)
        print("  [OK] Categoria 'Figuras' creada.")

    db.session.commit()
