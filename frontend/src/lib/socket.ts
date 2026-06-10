"use client";

import { io, Socket } from "socket.io-client";

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:5000";

let socket: Socket | null = null;
let socketKey: string | null = null;

export function getSocket(
  tatamiId: number | string,
  rol: string,
  token?: string | null,
  nombre?: string
): Socket {
  const nextKey = JSON.stringify({ tatamiId: String(tatamiId), rol, token: token || "", nombre: nombre || "" });

  // Si ya existe una conexión con los mismos params, reutilizarla.
  if (socket && socketKey === nextKey) {
    return socket;
  }

  // Desconectar socket previo
  if (socket) {
    socket.disconnect();
    socket = null;
    socketKey = null;
  }

  const query: Record<string, string> = {
    tatami_id: String(tatamiId),
    rol,
  };
  if (token) query.token = token;
  if (nombre) query.nombre = nombre;

  socket = io(`${SOCKET_URL}/combate`, {
    query,
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionDelay: 2000,
    reconnectionAttempts: Infinity,
    timeout: 10000,
  });
  socketKey = nextKey;

  socket.on("connect", () => {
    console.log("[Socket.IO] Conectado al tatami", tatamiId);
  });

  socket.on("disconnect", (reason) => {
    console.log("[Socket.IO] Desconectado:", reason);
  });

  socket.on("connect_error", (err) => {
    console.error("[Socket.IO] Error de conexion:", err.message);
  });

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
    socketKey = null;
  }
}

export function getExistingSocket(): Socket | null {
  return socket;
}
