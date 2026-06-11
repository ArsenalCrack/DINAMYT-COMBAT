"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { getSocket, disconnectSocket } from "../lib/socket";
import type { Socket } from "socket.io-client";

// ── Combat State Type ──
export interface CombateState {
  nombreHong: string;
  nombreChung: string;
  jueces: Record<string, { hong: number; chung: number }>;
  nombresJueces: Record<string, string>;
  numJueces: number;
  arbHong: number;
  arbChung: number;
  historial: HistorialEntry[];
  kyongHong: number;
  kyongChung: number;
  faltasHong: number;
  faltasChung: number;
  segundos: number;
  segundosMax: number;
  activo: boolean;
  log: LogEntry[];
  alerta12Lanzada: boolean;
  ronda: string;
  oroResuelto: boolean;
  oroPendienteAprobacion: boolean;
  oroGanadorNombre?: string;
  oroGanadorColor?: "hong" | "chung" | "";
  ganadorManualColor?: "hong" | "chung" | "";
  ganadorManualMotivo?: string;
  ganadorPendienteCierre?: boolean;
  ganadorPendienteNombre?: string;
  ganadorPendienteColor?: "hong" | "chung" | "";
  ganadorPendienteMotivo?: string;
  _categoria?: string;
  _tatami_activo?: boolean;
  _nombre_categoria?: string;
  _tatami_numero?: number | null;
  _campeonato_nombre?: string | null;
}

export interface HistorialEntry {
  juez: string;
  color: string;
  pts: number;
  nombre: string;
  tiempo?: number;
  ronda?: string;
  esEspecial?: boolean;
  esKyongGo?: boolean;
  esGamJeum?: boolean;
}

export interface LogEntry {
  txt: string;
  color: string;
  ts: number;
}

function estadoInicial(): CombateState {
  return {
    nombreHong: "Hong",
    nombreChung: "Chung",
    jueces: {
      j1: { hong: 0, chung: 0 },
      j2: { hong: 0, chung: 0 },
      j3: { hong: 0, chung: 0 },
      j4: { hong: 0, chung: 0 },
    },
    nombresJueces: { j1: "", j2: "", j3: "", j4: "" },
    numJueces: 4,
    arbHong: 0,
    arbChung: 0,
    historial: [],
    kyongHong: 0,
    kyongChung: 0,
    faltasHong: 0,
    faltasChung: 0,
    segundos: 120,
    segundosMax: 120,
    activo: false,
    log: [],
    alerta12Lanzada: false,
    ronda: "r1",
    oroResuelto: false,
    oroPendienteAprobacion: false,
    ganadorManualColor: "",
    ganadorManualMotivo: "",
    ganadorPendienteCierre: false,
    ganadorPendienteNombre: "",
    ganadorPendienteColor: "",
    ganadorPendienteMotivo: "",
  };
}

// ── Scoring Helpers ──
export function promedioEsquinas(state: CombateState, color: "hong" | "chung") {
  if (!state.jueces) return 0;
  const n = state.numJueces || 4;
  // Solo cuentan los jueces activos (igual que calcular_marcador del backend)
  const activos = ["j1", "j2", "j3", "j4"].slice(0, n);
  const sum = activos.reduce(
    (s, id) => s + (state.jueces[id]?.[color] || 0),
    0
  );
  return sum / n;
}

export function marcadorFinal(state: CombateState, color: "hong" | "chung") {
  const esq = promedioEsquinas(state, color);
  const arb = color === "hong" ? state.arbHong : state.arbChung;
  return esq + arb;
}

export function marcadorDisplay(state: CombateState, color: "hong" | "chung") {
  const val = marcadorFinal(state, color);
  if (val === 0) return "0";
  return val.toFixed(1);
}

export function formatTime(seg: number) {
  return `${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, "0")}`;
}

// ── Main Hook ──
export function useCombate(
  tatamiId: number | string | null,
  rol: string,
  token: string | null
) {
  const [state, setState] = useState<CombateState>(estadoInicial());
  const [connected, setConnected] = useState(false);
  const [hasServerState, setHasServerState] = useState(false);
  const [pendingEvents, setPendingEvents] = useState(0);
  const [socketError, setSocketError] = useState("");
  const [alerts, setAlerts] = useState<{
    alerta12?: { hong: string; chung: string; lider: string; diferencia?: string; motivo?: string };
    ganador?: { nombre: string; color: string; motivo?: string };
    derrota?: { perdedor: string; razon: string };
    faltaFlash?: { ico: string; titulo: string; sub: string; tipoFalta: string };
    rechazo?: { message: string };
  }>({});
  const socketRef = useRef<Socket | null>(null);
  const pendingMap = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Conectar al tatami
  useEffect(() => {
    if (!tatamiId) return;

    const sock = getSocket(tatamiId, rol, token);
    socketRef.current = sock;

    sock.on("connect", () => {
      setConnected(true);
      setSocketError("");
    });
    sock.on("disconnect", () => setConnected(false));
    sock.on("connect_error", (err: Error) => {
      setConnected(false);
      setSocketError(err.message || "No se pudo conectar al tatami");
    });

    sock.on("estado", (data: { datos: CombateState }) => {
      setHasServerState(true);
      if (pendingMap.current.size === 0) {
        setState(data.datos);
      }
    });

    sock.on("estado_confirmado", (data: { datos: CombateState }) => {
      setHasServerState(true);
      setState(data.datos);
      // Clear all pending
      pendingMap.current.forEach((timer) => clearTimeout(timer));
      pendingMap.current.clear();
      setPendingEvents(0);
    });

    sock.on("accion_rechazada", (data: { message?: string }) => {
      setAlerts((prev) => ({
        ...prev,
        rechazo: { message: data.message || "Acción rechazada" },
      }));
    });

    sock.on("ack", (data: { evId: string }) => {
      const timer = pendingMap.current.get(data.evId);
      if (timer) {
        clearTimeout(timer);
        pendingMap.current.delete(data.evId);
        setPendingEvents(pendingMap.current.size);
      }
    });

    // Pedir estado inicial
    sock.emit("pedir");

    const pending = pendingMap.current;
    return () => {
      pending.forEach((timer) => clearTimeout(timer));
      pending.clear();
      setPendingEvents(0);
      disconnectSocket();
      setConnected(false);
      setHasServerState(false);
      setSocketError("");
    };
  }, [tatamiId, rol, token]);

  // Event-specific listeners (separate effect to avoid re-binding on state change)
  useEffect(() => {
    const sock = socketRef.current;
    if (!sock) return;

    const onAlerta12 = (data: { hong: string; chung: string; lider: string; diferencia?: string; motivo?: string }) => {
      setAlerts((prev) => ({ ...prev, alerta12: data }));
    };
    const onGanador = (data: { nombre: string; color: string; motivo?: string }) => {
      setAlerts((prev) => ({ ...prev, ganador: data }));
    };
    const onDerrota = (data: { perdedor: string; razon: string }) => {
      setAlerts((prev) => ({ ...prev, derrota: data }));
    };
    const onFaltaFlash = (data: {
      data?: { ico: string; titulo: string; sub: string; tipo?: string; tipoFalta?: string };
      ico?: string;
      titulo?: string;
      sub?: string;
      tipo?: string;
      tipoFalta?: string;
    }) => {
      const payload = data.data || data;
      setAlerts((prev) => ({
        ...prev,
        faltaFlash: {
          ico: payload.ico || "",
          titulo: payload.titulo || "",
          sub: payload.sub || "",
          tipoFalta: payload.tipoFalta || payload.tipo || "adv",
        },
      }));
      // Auto-clear after 3s
      setTimeout(() => setAlerts((prev) => ({ ...prev, faltaFlash: undefined })), 3000);
    };

    sock.on("alerta12", onAlerta12);
    sock.on("ganador-flash", onGanador);
    sock.on("derrota", onDerrota);
    sock.on("falta-flash", onFaltaFlash);

    return () => {
      sock.off("alerta12", onAlerta12);
      sock.off("ganador-flash", onGanador);
      sock.off("derrota", onDerrota);
      sock.off("falta-flash", onFaltaFlash);
    };
  }, [tatamiId]);

  // ── Send Event ──
  const enviarEvento = useCallback(
    (accion: string, datos: Record<string, unknown> = {}) => {
      const sock = socketRef.current;
      if (!sock) return;

      const evId = `${rol}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const evento = { accion, ...datos };

      // Reintentos limitados: si nunca llega el ACK, soltar el evento para
      // no bloquear indefinidamente las actualizaciones de estado del servidor.
      const MAX_REINTENTOS = 3;
      const scheduleRetry = (intento: number) => {
        const timer = setTimeout(() => {
          if (!pendingMap.current.has(evId)) return;
          if (intento >= MAX_REINTENTOS) {
            pendingMap.current.delete(evId);
            setPendingEvents(pendingMap.current.size);
            return;
          }
          socketRef.current?.emit("evento", { evId, evento });
          scheduleRetry(intento + 1);
        }, 2000);
        pendingMap.current.set(evId, timer);
      };

      scheduleRetry(1);
      setPendingEvents(pendingMap.current.size);

      // The server will confirm with estado_confirmado.
      sock.emit("evento", { evId, evento });
    },
    [rol]
  );

  // ── Broadcast Event (no state change) ──
  const broadcast = useCallback(
    (data: Record<string, unknown>) => {
      socketRef.current?.emit("broadcast", data);
    },
    []
  );

  // ── Clear Alerts ──
  const clearAlert = useCallback((key: string) => {
    setAlerts((prev) => ({ ...prev, [key]: undefined }));
  }, []);

  return {
    state,
    connected,
    hasServerState,
    socketError,
    pendingEvents,
    enviarEvento,
    broadcast,
    alerts,
    clearAlert,
  };
}
