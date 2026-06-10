"""
Socket.IO Handlers Registration
"""


def register_socketio_handlers(socketio):
    """Registra todos los namespaces de Socket.IO."""
    from .combate_ns import CombateNamespace
    socketio.on_namespace(CombateNamespace("/combate"))
