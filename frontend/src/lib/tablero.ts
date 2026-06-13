// Tablero local del Juez Central (modo sin conexión).
//
// Herramienta 100% client-side: el JC ingresa las puntuaciones a mano, se
// calcula el podio/ganador localmente y se proyecta a un TV por HDMI con una
// ventana emergente. La sincronización entre la ventana de control y la de
// proyección es por BroadcastChannel (instantánea) + localStorage (estado
// inicial al abrir la ventana). No toca el servidor: los resultados quedan en
// un historial local que la mesa reconcilia/sube después.

export type TableroModo = "figuras" | "combate";

export interface TableroCompetidor {
  id: number;
  nombre: string;
  club: string;
  // Nota de cada juez de esquina (índice = juez). null = sin calificar aún.
  notas: (number | null)[];
}

export interface TableroFiguras {
  categoria: string;
  descripcion: string;
  numJueces: number; // 2..4
  competidores: TableroCompetidor[];
  finalizado: boolean; // true = se proyecta el podio
}

export interface TableroCombate {
  nombreHong: string;
  nombreChung: string;
  duracionSeg: number;
  segundos: number;
  activo: boolean;
  puntosHong: number | null;
  puntosChung: number | null;
  finalizado: boolean; // true = se proyecta el ganador
}

export interface TableroState {
  modo: TableroModo;
  campeonato: string;
  tatami: string;
  figuras: TableroFiguras;
  combate: TableroCombate;
  updatedAt: number;
}

export interface RankItem extends TableroCompetidor {
  total: number;
  puesto: number;
  empate: boolean;
  completo: boolean;
}

// ── Historial local de resultados guardados ──
export interface HistorialFiguras {
  tipo: "figuras";
  ts: number;
  categoria: string;
  descripcion: string;
  ranking: { puesto: number; nombre: string; club: string; total: number; empate: boolean }[];
}
export interface HistorialCombate {
  tipo: "combate";
  ts: number;
  nombreHong: string;
  nombreChung: string;
  puntosHong: number;
  puntosChung: number;
  ganador: "hong" | "chung" | "empate";
}
export type HistorialItem = HistorialFiguras | HistorialCombate;

const STORAGE_KEY = "dinamyt_tablero_estado";
const HISTORIAL_KEY = "dinamyt_tablero_historial";
const CHANNEL = "dinamyt_tablero";

export const DURACIONES = [30, 60, 90, 120];

export function estadoInicialTablero(): TableroState {
  return {
    modo: "figuras",
    campeonato: "",
    tatami: "",
    figuras: {
      categoria: "FIGURA CON ARMAS",
      descripcion: "",
      numJueces: 4,
      competidores: [],
      finalizado: false,
    },
    combate: {
      nombreHong: "",
      nombreChung: "",
      duracionSeg: 120,
      segundos: 120,
      activo: false,
      puntosHong: null,
      puntosChung: null,
      finalizado: false,
    },
    updatedAt: Date.now(),
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/** Total de un competidor = suma de las notas de los jueces activos. */
export function totalCompetidor(c: TableroCompetidor, numJueces: number): number {
  const notas = c.notas.slice(0, numJueces);
  return round2(notas.reduce<number>((s, v) => s + (v ?? 0), 0));
}

function competidorCompleto(c: TableroCompetidor, numJueces: number): boolean {
  const notas = c.notas.slice(0, numJueces);
  return notas.length === numJueces && notas.every((v) => v !== null);
}

/**
 * Ranking con puestos estándar de competencia: los empatados comparten puesto
 * y el siguiente se salta (1, 2, 2, 4). Espejo del motor de figuras del backend.
 */
export function rankingTablero(fig: TableroFiguras): RankItem[] {
  const items: RankItem[] = fig.competidores.map((c) => ({
    ...c,
    total: totalCompetidor(c, fig.numJueces),
    puesto: 0,
    empate: false,
    completo: competidorCompleto(c, fig.numJueces),
  }));
  items.sort((a, b) => b.total - a.total);

  let puesto = 0;
  let prev: number | null = null;
  items.forEach((it, idx) => {
    if (prev === null || it.total !== prev) puesto = idx + 1;
    it.puesto = puesto;
    prev = it.total;
  });

  const conteo: Record<number, number> = {};
  items.forEach((it) => { conteo[it.puesto] = (conteo[it.puesto] || 0) + 1; });
  items.forEach((it) => {
    it.empate = conteo[it.puesto] > 1 && it.completo;
  });
  return items;
}

export function ganadorCombate(c: TableroCombate): "hong" | "chung" | "empate" {
  const h = c.puntosHong ?? 0;
  const ch = c.puntosChung ?? 0;
  if (h > ch) return "hong";
  if (ch > h) return "chung";
  return "empate";
}

// ── Persistencia + sincronización entre ventanas ──
export function cargarTablero(): TableroState {
  if (typeof window === "undefined") return estadoInicialTablero();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...estadoInicialTablero(), ...JSON.parse(raw) };
  } catch { /* almacenamiento no disponible */ }
  return estadoInicialTablero();
}

let _canal: BroadcastChannel | null = null;
function canal(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  if (!_canal) _canal = new BroadcastChannel(CHANNEL);
  return _canal;
}

/** Guarda el estado y lo difunde a la ventana de proyección (y viceversa). */
export function publicarTablero(state: TableroState) {
  const conSello = { ...state, updatedAt: Date.now() };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(conSello)); } catch { /* */ }
  canal()?.postMessage(conSello);
  return conSello;
}

/** Suscribe a cambios del tablero (BroadcastChannel + storage como respaldo). */
export function suscribirTablero(cb: (s: TableroState) => void): () => void {
  const c = canal();
  const onMsg = (ev: MessageEvent) => cb(ev.data as TableroState);
  c?.addEventListener("message", onMsg);
  const onStorage = (ev: StorageEvent) => {
    if (ev.key === STORAGE_KEY && ev.newValue) {
      try { cb(JSON.parse(ev.newValue) as TableroState); } catch { /* */ }
    }
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    c?.removeEventListener("message", onMsg);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

// ── Historial local ──
export function cargarHistorial(): HistorialItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(HISTORIAL_KEY);
    if (raw) return JSON.parse(raw) as HistorialItem[];
  } catch { /* */ }
  return [];
}

export function guardarHistorial(items: HistorialItem[]) {
  try { localStorage.setItem(HISTORIAL_KEY, JSON.stringify(items)); } catch { /* */ }
}
