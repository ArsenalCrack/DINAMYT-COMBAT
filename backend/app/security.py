"""
Seguridad: límite de intentos (rate limiting) en memoria.

Ventana deslizante por clave (IP + identificador). Pensado para un solo
proceso (eventlet), que es como se despliega DINAMYT. Si algún día se
escala a múltiples workers, reemplazar por un backend compartido (Redis).
"""

import threading
import time

_intentos = {}
_lock = threading.Lock()

# Límite de entradas en memoria para evitar crecimiento sin control
_MAX_CLAVES = 10000


def _podar(ahora):
    """Elimina claves cuyos intentos ya expiraron (se llama con _lock tomado)."""
    if len(_intentos) <= _MAX_CLAVES:
        return
    for clave in list(_intentos.keys()):
        marcas, ventana = _intentos[clave]
        vigentes = [t for t in marcas if ahora - t < ventana]
        if vigentes:
            _intentos[clave] = (vigentes, ventana)
        else:
            del _intentos[clave]


def intento_bloqueado(clave, max_intentos, ventana_segundos):
    """
    Registra un intento para la clave y retorna True si superó el límite.

    Args:
        clave: identificador único, p. ej. "login:1.2.3.4:user@x.com"
        max_intentos: número máximo de intentos permitidos en la ventana
        ventana_segundos: tamaño de la ventana deslizante en segundos
    """
    ahora = time.time()
    with _lock:
        marcas, _ = _intentos.get(clave, ([], ventana_segundos))
        marcas = [t for t in marcas if ahora - t < ventana_segundos]
        if len(marcas) >= max_intentos:
            _intentos[clave] = (marcas, ventana_segundos)
            return True
        marcas.append(ahora)
        _intentos[clave] = (marcas, ventana_segundos)
        _podar(ahora)
        return False


def limpiar_intentos(clave):
    """Borra los intentos de una clave (p. ej. tras un login exitoso)."""
    with _lock:
        _intentos.pop(clave, None)


def segundos_restantes(clave):
    """Segundos hasta que la clave vuelva a tener intentos disponibles."""
    ahora = time.time()
    with _lock:
        marcas, ventana = _intentos.get(clave, ([], 0))
        if not marcas:
            return 0
        return max(0, int(ventana - (ahora - min(marcas))) + 1)
