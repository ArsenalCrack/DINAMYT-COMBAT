"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import {
  useCombate,
  marcadorDisplay,
  formatTime,
  promedioEsquinas,
  type CombateState,
} from "@/hooks/useCombate";
import AlertSystem, {
  useAlertSystem,
  type FaltaFlashData,
  type GanadorData,
  type Alerta12Data,
  type DerrotaData,
} from "@/components/AlertSystem";
import LlavePanel from "@/components/LlavePanel";
import BracketTree from "@/components/BracketTree";
import Logo from "@/components/Logo";

// ─── Figuras Types ───────────────────────────────────────────────────────────
interface Criterio { id: string; nombre: string; max_pts: number; }
interface Competidor { id: number; nombre: string; club?: string; especial?: boolean; promedio?: number; }
interface CompetidorRankeado extends Competidor {
  total: number;
  puesto: number;
  empate: boolean;
  /** Todos los jueces activos ya confirmaron su nota */
  completo: boolean;
}
interface FigurasState {
  tipo: "figuras";
  criterios: Criterio[];
  competidores: Competidor[];
  puntuaciones: Record<string, Record<string, number>>; // { comp_id: { juez_id: float } }
  puntuaciones_confirmadas: Record<string, Record<string, boolean>>;
  competidor_activo_id: number | null;
  puntuacion_abierta: boolean;
  nombre_categoria: string;
  num_jueces: number;
  nombres_jueces: Record<string, string>;
  finalizado: boolean;
  en_desempate?: number[];
  log: { txt: string; color: string; ts: number }[];
  _categoria?: string;
  _tatami_activo?: boolean;
  _nombre_categoria?: string;
  _tatami_numero?: number | null;
  _campeonato_nombre?: string | null;
  _campeonato_id?: number | null;
}

type AnyState = (CombateState & { _categoria?: string }) | (FigurasState & { _categoria?: string });

// ─── Helpers ─────────────────────────────────────────────────────────────────
const RONDAS: Record<string, string> = {
  r1: "ILHaeJon — Round 1",
  r2: "EeHaeJon — Round 2",
  oro: "PUNTO DE ORO",
};

function isFiguras(state: AnyState): state is FigurasState {
  return (state as FigurasState).tipo === "figuras" || state._categoria === "figuras";
}

function combateActivo(state: CombateState): boolean {
  // Combate activo si: hay historial de puntos O el cronómetro ha bajado
  if (!state.historial) return false;
  const hayPuntos = state.historial.length > 0;
  const cronoMovio = state.segundos < state.segundosMax;
  return hayPuntos || cronoMovio;
}

function competidoresConNombre(state: CombateState): boolean {
  const hong = state.nombreHong?.trim();
  const chung = state.nombreChung?.trim();
  return Boolean(hong && chung && hong !== "Hong" && chung !== "Chung");
}

function formatScoreValue(value: number | string) {
  const parsed = typeof value === "number"
    ? value
    : Number(String(value).replace(",", "."));
  if (!Number.isFinite(parsed)) return "";
  return Math.max(0, Math.min(9.99, parsed)).toFixed(2);
}

function normalizeScoreInput(raw: string) {
  const cleaned = raw.trim().replace(",", ".");
  if (!cleaned) return "";
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 9.99) return "";
  return parsed.toFixed(2);
}

function isValidScore(raw: string) {
  if (!/^\d\.\d{2}$/.test(raw)) return false;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 9.99;
}

const CATEGORIA_NOMBRE_MAX = 40;

function sanitizeCategoryName(raw: string) {
  return raw.replace(/[^\p{L} ]/gu, "").slice(0, CATEGORIA_NOMBRE_MAX);
}

function categoriaNombreValido(raw?: string) {
  const value = (raw || "").trim();
  return Boolean(value && /^[\p{L} ]+$/u.test(value));
}

// Máximo 4 jueces de esquina por tatami
const JUECES_FIGURAS = ["j1", "j2", "j3", "j4"];

function juecesActivosFiguras(state: FigurasState) {
  return JUECES_FIGURAS
    .slice(0, state.num_jueces || 4)
    .filter((_, idx) => Boolean(state.criterios[idx]));
}

function figurasPuntuacionesCompletas(state: FigurasState) {
  if (!state.competidores.length) return false;
  const jueces = juecesActivosFiguras(state);
  if (!jueces.length) return false;
  return state.competidores.every((comp) => {
    const compId = String(comp.id);
    return jueces.every((juezId) => state.puntuaciones_confirmadas?.[compId]?.[juezId]);
  });
}

/**
 * Ranking de figuras (espejo de calcular_ranking del backend):
 * - TODOS los de categoría especial reciben el puesto 1 sin importar su
 *   puntuación: comparten el primer puesto con el 1° normal.
 * - Empate de totales en el podio normal = empate REAL: comparten puesto
 *   (1, 2, 2, 4) y se resuelve con presentación de desempate (Reevaluar).
 */
function rankingFiguras(state: FigurasState): CompetidorRankeado[] {
  const jueces = juecesActivosFiguras(state);

  function totalDe(comp: Competidor): number {
    const puntajes = Object.values(state.puntuaciones[String(comp.id)] || {}).map(Number);
    return Math.round(puntajes.reduce((s, v) => s + v, 0) * 100) / 100;
  }

  function completoDe(comp: Competidor): boolean {
    return jueces.length > 0 && jueces.every(
      (j) => state.puntuaciones_confirmadas?.[String(comp.id)]?.[j]
    );
  }

  function ordenar(lista: Competidor[], todosPrimero: boolean): CompetidorRankeado[] {
    const items = lista
      .map((c) => ({
        ...c, total: totalDe(c), puesto: 1, empate: false, completo: completoDe(c),
      }))
      .sort((a, b) => b.total - a.total);
    if (todosPrimero) return items;
    let puesto = 0;
    items.forEach((item, idx) => {
      if (idx === 0 || item.total !== items[idx - 1].total) puesto = idx + 1;
      item.puesto = puesto;
    });
    // Empate solo entre competidores con puntuación COMPLETA: dos sin
    // calificar (0.00) no están empatados, les falta puntuar.
    const grupos: Record<number, CompetidorRankeado[]> = {};
    items.forEach((r) => { (grupos[r.puesto] = grupos[r.puesto] || []).push(r); });
    Object.values(grupos).forEach((grupo) => {
      const esEmpate = grupo.length > 1 && grupo.every((g) => g.completo);
      grupo.forEach((g) => { g.empate = esEmpate; });
    });
    return items;
  }

  const especiales = state.competidores.filter((c) => c.especial);
  const normales = state.competidores.filter((c) => !c.especial);
  return [...ordenar(especiales, true), ...ordenar(normales, false)];
}

function colorPuesto(puesto: number, especial?: boolean) {
  if (especial || puesto === 1) return "var(--gold)";
  if (puesto === 2) return "#C0C0C0";
  if (puesto === 3) return "#CD7F32";
  return "var(--text-dim)";
}

function figurasConDatos(state: FigurasState) {
  // Solo competidores o puntuaciones reales bloquean el cambio de categoría;
  // el log o el nombre de la categoría no cuentan como "datos en curso".
  const tienePuntuaciones = Object.values(state.puntuaciones || {})
    .some((puntajes) => Object.keys(puntajes || {}).length > 0);
  return Boolean(state.competidores.length || tienePuntuaciones);
}

// ─── Category Selector ───────────────────────────────────────────────────────
function CatSelector({
  current, onSelect, figurasLabel,
}: { current: string; onSelect: (cat: string) => void; figurasLabel: string }) {
  const labels: Record<string, string> = {
    combate: "Combate",
    figuras: figurasLabel || "Figuras",
  };

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <span style={{ color: "var(--text-muted)", fontSize: "0.72rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em" }}>CAT:</span>
      {["combate", "figuras"].map((cat) => (
        <button
          key={cat}
          className="btn btn-sm"
          onClick={() => onSelect(cat)}
          style={{
            textTransform: "capitalize",
            background: current === cat ? (cat === "combate" ? "var(--hong-bg)" : "var(--gold-bg)") : undefined,
            borderColor: current === cat ? (cat === "combate" ? "var(--hong-border)" : "var(--gold-border)") : undefined,
            color: current === cat ? (cat === "combate" ? "var(--hong-light)" : "var(--gold)") : undefined,
            padding: "4px 10px", minHeight: 32, fontSize: "0.8rem",
          }}
        >
          {labels[cat]}
        </button>
      ))}
    </div>
  );
}

// ─── Crono Display ────────────────────────────────────────────────────────────
function CronoDisplay({ segundos, activo, big = false }: {
  segundos: number; activo: boolean; segundosMax?: number; big?: boolean;
}) {
  const cls = !activo ? "pause"
    : segundos <= 5 ? "urgente-5"
    : segundos <= 10 ? "urgente"
    : "activo";
  return (
    <div
      className={`crono-display ${cls}`}
      style={{ fontSize: big ? "clamp(3rem,7vw,6rem)" : "2rem" }}
    >
      {formatTime(segundos)}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// FIGURAS — Juez Central (Arbitro)
// ══════════════════════════════════════════════════════════════════════════════
function FigurasArbitro({
  state, enviarEvento, tatamiId, onShowConfirm,
}: {
  state: FigurasState;
  enviarEvento: (accion: string, datos?: Record<string, unknown>) => void;
  tatamiId: string;
  onShowConfirm: (data: import("@/components/AlertSystem").ConfirmData) => void;
}) {
  const [newComp, setNewComp] = useState({ nombre: "", club: "", especial: false });
  const [showAddComp, setShowAddComp] = useState(false);
  const [categoriaError, setCategoriaError] = useState("");
  const [categoriaDraft, setCategoriaDraft] = useState(state.nombre_categoria ?? "");
  const [categoriaFocused, setCategoriaFocused] = useState(false);
  const [categoriaPendiente, setCategoriaPendiente] = useState(false);
  const nombreCategoriaValido = categoriaNombreValido(categoriaDraft);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const serverName = state.nombre_categoria ?? "";
      if (serverName === categoriaDraft) {
        setCategoriaPendiente(false);
        return;
      }
      if (!categoriaFocused && !categoriaPendiente) {
        setCategoriaDraft(serverName);
      }
    });
    return () => { cancelled = true; };
  }, [categoriaDraft, categoriaFocused, categoriaPendiente, state.nombre_categoria]);

  function commitNombreCategoria() {
    const nombre = sanitizeCategoryName(categoriaDraft);
    if (nombre !== categoriaDraft) {
      setCategoriaDraft(nombre);
    }
    if (nombre !== (state.nombre_categoria ?? "")) {
      setCategoriaPendiente(true);
      enviarEvento("cambiar_nombre_categoria", { nombre });
    }
    return nombre;
  }

  function validarNombreCategoria() {
    const nombre = commitNombreCategoria();
    if (!categoriaNombreValido(nombre)) {
      setCategoriaError("Ingresa el nombre de la categoría usando solo letras y espacios.");
      return false;
    }
    setCategoriaError("");
    return true;
  }

  const ranking = rankingFiguras(state);

  const MAX_COMPETIDORES = 50;
  const puedeAgregar = state.competidores.length < MAX_COMPETIDORES;
  const puntuacionesCompletas = figurasPuntuacionesCompletas(state);

  // Empate real en el podio normal (la categoría especial no se reevalúa)
  const empatadosNormales = (puntuacionesCompletas || state.finalizado)
    ? ranking.filter((r) => r.empate && !r.especial)
    : [];

  // Presentación de desempate en curso: solo los empatados se activan
  const enDesempate = state.en_desempate || [];

  function handleReevaluarEmpate() {
    if (!validarNombreCategoria() || empatadosNormales.length === 0) return;
    const nombres = empatadosNormales.map((r) => r.nombre).join(", ");
    onShowConfirm({
      titulo: "REEVALUAR EMPATE",
      mensaje: `Presentación de desempate para: ${nombres}. Se limpiarán SOLO sus puntuaciones para que los jueces los evalúen de nuevo; el podio se ocultará hasta completar. La categoría especial no se afecta y quedará constancia en el reporte.`,
      tipo: "advertencia",
      confirmLabel: "REEVALUAR",
      cancelLabel: "Cancelar",
      onConfirm: () => enviarEvento("reevaluar_empate"),
    });
  }

  // No se puede pasar el turno a otro competidor si al activo
  // le falta alguna puntuación por confirmar.
  const juecesActivos = juecesActivosFiguras(state);
  const activoId = state.competidor_activo_id;
  const activoIncompleto = Boolean(
    activoId !== null
    && juecesActivos.length > 0
    && !juecesActivos.every(
      (j) => state.puntuaciones_confirmadas?.[String(activoId)]?.[j]
    )
  );

  return (
    <div style={{ padding: 16, maxWidth: 800, margin: "0 auto" }}>
      {/* Nombre de la categoría: input en su propia línea, centrado y
          ocupando el espacio; debajo, el rol y el tatami */}
      <div style={{ marginBottom: 16, display: "flex", flexDirection: "column", gap: 8 }}>
        <input
          className="input"
          value={categoriaDraft}
          placeholder="Nombre de la categoría"
          maxLength={CATEGORIA_NOMBRE_MAX}
          onChange={(e) => {
            const nombre = sanitizeCategoryName(e.target.value);
            setCategoriaDraft(nombre);
            setCategoriaPendiente(true);
            setCategoriaError("");
            enviarEvento("cambiar_nombre_categoria", { nombre });
          }}
          onFocus={() => setCategoriaFocused(true)}
          onBlur={() => {
            setCategoriaFocused(false);
            const nombre = commitNombreCategoria();
            if (nombre && !categoriaNombreValido(nombre)) {
              setCategoriaError("Usa solo letras y espacios.");
            }
          }}
          style={{
            width: "100%",
            textAlign: "center",
            fontWeight: 800,
            fontSize: "1.05rem",
            borderColor: nombreCategoriaValido ? "var(--green-border)" : "var(--hong-border)",
          }}
        />
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          gap: 8, flexWrap: "wrap",
        }}>
          <span className="card-title" style={{ marginBottom: 0, fontSize: "0.8rem" }}>
            Juez Central · Tatami {tatamiId}
          </span>
          {state.puntuacion_abierta && state.competidor_activo_id && (
            <button className="btn btn-sm btn-danger" onClick={() => {
              if (validarNombreCategoria()) enviarEvento("cerrar_puntuacion");
            }}>
              Cerrar Puntuación
            </button>
          )}
        </div>
      </div>
      {categoriaError && (
        <div style={{ color: "var(--orange)", fontWeight: 700, fontSize: "0.82rem", margin: "-8px 0 12px" }}>
          {categoriaError}
        </div>
      )}

      {/* Número de jueces (máximo 4 de esquina) */}
      <div className="card" style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", flexWrap: "wrap" }}>
        <span style={{ color: "var(--text-muted)", fontSize: "0.82rem", fontWeight: 700 }}>Jueces:</span>
        {[2, 3, 4].map((n) => (
          <button key={n} className="btn btn-sm"
            onClick={() => {
              if (validarNombreCategoria()) enviarEvento("set_num_jueces", { num_jueces: n });
            }}
            style={{
              background: state.num_jueces === n ? "var(--gold-bg)" : undefined,
              borderColor: state.num_jueces === n ? "var(--gold-border)" : undefined,
              color: state.num_jueces === n ? "var(--gold)" : undefined,
              padding: "4px 12px", minHeight: 32,
            }}>
            {n}
          </button>
        ))}
        <span style={{
          marginLeft: "auto",
          color: puntuacionesCompletas ? "var(--green)" : "var(--text-dim)",
          fontSize: "0.78rem", fontWeight: 700,
        }}>
          {puntuacionesCompletas
            ? "Puntuaciones completas — podio visible"
            : "El podio aparece al completar todas las puntuaciones"}
        </span>
      </div>

      {/* Competidores */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>
            Competidores ({state.competidores.length}/{MAX_COMPETIDORES})
          </div>
          <button className="btn btn-sm btn-primary"
            onClick={() => {
              if (validarNombreCategoria()) setShowAddComp(!showAddComp);
            }}
            disabled={!puedeAgregar}>
            + Agregar
          </button>
        </div>

        {!puedeAgregar && (
          <p style={{ color: "var(--orange)", fontSize: "0.82rem", marginBottom: 8 }}>
            Máximo {MAX_COMPETIDORES} competidores alcanzado.
          </p>
        )}

        {showAddComp && (
          <div className="animate-fade" style={{ marginBottom: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input className="input" placeholder="Nombre del competidor" value={newComp.nombre}
                onChange={(e) => setNewComp((v) => ({ ...v, nombre: e.target.value }))}
                style={{ flex: "2 1 180px" }} />
              <input className="input" placeholder="Club / Equipo (opc.)" value={newComp.club}
                onChange={(e) => setNewComp((v) => ({ ...v, club: e.target.value }))}
                style={{ flex: "1 1 140px" }} />
              <button className="btn btn-primary"
                onClick={() => {
                  if (validarNombreCategoria() && newComp.nombre.trim()) {
                    enviarEvento("agregar_competidor", {
                      nombre: newComp.nombre.trim(),
                      club: newComp.club.trim(),
                      especial: newComp.especial,
                    });
                    setNewComp({ nombre: "", club: "", especial: false });
                    setShowAddComp(false);
                  }
                }}>
                Agregar
              </button>
            </div>
            <label style={{
              display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
              fontSize: "0.82rem", fontWeight: 700, userSelect: "none",
              color: newComp.especial ? "var(--gold)" : "var(--text-muted)",
            }}>
              <input
                type="checkbox"
                checked={newComp.especial}
                onChange={(e) => setNewComp((v) => ({ ...v, especial: e.target.checked }))}
                style={{ accentColor: "var(--gold)", width: 16, height: 16 }}
              />
              Categoría especial — recibe su propio primer puesto sin afectar el podio del resto
            </label>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {ranking.map((comp) => {
            const isActive = state.competidor_activo_id === comp.id;
            const esPrimero = comp.puesto === 1;
            return (
              <div key={comp.id} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "8px 12px",
                background: isActive ? "rgba(240,184,0,0.1)" : (esPrimero ? "rgba(240,184,0,0.04)" : "var(--bg-elevated)"),
                borderRadius: "var(--radius-sm)",
                border: `1.5px solid ${isActive ? "var(--gold)" : (esPrimero ? "var(--gold-border)" : "var(--border)")}`,
              }}>
                <span style={{
                  fontFamily: "var(--font-display)", fontSize: "1.5rem", minWidth: 32, textAlign: "center",
                  color: colorPuesto(comp.puesto, comp.especial),
                }}>{comp.puesto}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: isActive ? "var(--gold)" : "inherit", overflowWrap: "anywhere" }}>
                    {comp.nombre}
                    {comp.especial && <span className="badge badge-gold" style={{ marginLeft: 8, verticalAlign: "middle" }}>Especial</span>}
                    {comp.empate && <span className="badge badge-gray" style={{ marginLeft: 8, verticalAlign: "middle", color: "var(--orange)", borderColor: "rgba(255,140,0,0.4)" }}>Desempate</span>}
                    {enDesempate.includes(comp.id) && !comp.empate && (
                      <span className="badge badge-gray" style={{ marginLeft: 8, verticalAlign: "middle", color: "var(--orange)", borderColor: "rgba(255,140,0,0.4)" }}>Reevaluando</span>
                    )}
                    {isActive && <span style={{ marginLeft: 8, fontSize: "0.7rem", background: "var(--gold)", color: "#000", padding: "2px 6px", borderRadius: 4 }}>EN TURNO</span>}
                  </div>
                  {comp.club && <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{comp.club}</div>}
                </div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: "1.8rem", color: esPrimero || isActive ? "var(--gold)" : "var(--text)" }}>
                  {comp.total.toFixed(2)}
                </div>
                {!isActive && (() => {
                  const fueraDelDesempate = enDesempate.length > 0 && !enDesempate.includes(comp.id);
                  const bloqueado = activoIncompleto || fueraDelDesempate || comp.completo;
                  return (
                    <button className="btn btn-sm"
                      disabled={bloqueado}
                      title={comp.completo
                        ? "Ya fue calificado por completo (sus notas son inmutables)"
                        : fueraDelDesempate
                          ? "Desempate en curso: solo los empatados pueden presentarse"
                          : activoIncompleto
                            ? "El competidor en turno aún tiene puntuaciones pendientes"
                            : undefined}
                      onClick={() => {
                        if (!validarNombreCategoria()) return;
                        if (activoIncompleto) {
                          onShowConfirm({
                            titulo: "TURNO EN CURSO",
                            mensaje: "No puedes activar otro competidor: al competidor en turno le falta la puntuación de algún juez. Espera a que todos confirmen.",
                            tipo: "advertencia",
                            solo_ok: true,
                            onConfirm: () => {},
                          });
                          return;
                        }
                        enviarEvento("activar_competidor", { competidor_id: comp.id });
                      }}
                      style={{
                        padding: "4px 8px", fontSize: "0.7rem",
                        background: "var(--bg-card)", borderColor: "var(--gold)",
                        opacity: bloqueado ? 0.45 : 1,
                      }}>
                      ACTIVAR
                    </button>
                  );
                })()}
                <button className="btn btn-sm btn-danger"
                  title="Eliminar competidor"
                  onClick={() => {
                    if (!validarNombreCategoria()) return;
                    const tieneNotas = Object.keys(state.puntuaciones[String(comp.id)] || {}).length > 0;
                    onShowConfirm({
                      titulo: "ELIMINAR COMPETIDOR",
                      mensaje: `¿Estás seguro de eliminar a "${comp.nombre}"${comp.club ? ` (${comp.club})` : ""}?${tieneNotas ? " Se perderán las puntuaciones que ya le registraron los jueces." : ""} Esta acción no se puede deshacer.`,
                      tipo: "peligro",
                      confirmLabel: "ELIMINAR",
                      cancelLabel: "Cancelar",
                      onConfirm: () => enviarEvento("eliminar_competidor", { competidor_id: comp.id }),
                    });
                  }}
                  style={{ padding: "3px 8px", minHeight: 30, fontSize: "0.72rem" }}>
                  ✕
                </button>
              </div>
            );
          })}
          {state.competidores.length === 0 && (
            <p style={{ textAlign: "center", color: "var(--text-dim)", padding: "20px 0", fontSize: "0.88rem" }}>
              Agrega competidores para comenzar
            </p>
          )}
        </div>
      </div>

      {/* Criterios */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-title">Criterios de Puntuación</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {state.criterios.map((c) => (
            <div key={c.id} style={{
              padding: "6px 14px", background: "var(--bg-elevated)",
              border: "1px solid var(--border-light)", borderRadius: "var(--radius-sm)",
              fontSize: "0.82rem", fontWeight: 700,
            }}>
              {c.nombre} <span style={{ color: "var(--gold)", marginLeft: 4 }}>/{c.max_pts}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Empate real: presentación de desempate solo para los empatados */}
      {empatadosNormales.length > 0 && (
        <div className="animate-fade" style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          gap: 10, flexWrap: "wrap", marginBottom: 12, padding: "10px 14px",
          background: "rgba(255,140,0,0.08)",
          border: "1.5px solid rgba(255,140,0,0.4)",
          borderRadius: "var(--radius)",
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: "var(--orange)", fontWeight: 800, fontSize: "0.82rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Empate en el puesto {empatadosNormales[0].puesto} — deben desempatar
            </div>
            <div style={{ fontSize: "0.82rem", color: "var(--text-muted)", marginTop: 2, overflowWrap: "anywhere" }}>
              {empatadosNormales.map((r) => r.nombre).join(" · ")}
            </div>
          </div>
          <button
            className="btn btn-sm"
            onClick={handleReevaluarEmpate}
            style={{
              background: "rgba(255,140,0,0.15)",
              borderColor: "rgba(255,140,0,0.5)",
              color: "var(--orange)",
              fontWeight: 800,
            }}
          >
            Reevaluar
          </button>
        </div>
      )}

      {/* Acciones — el podio se muestra automáticamente al completar */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
        <button className="btn btn-primary"
          style={{ whiteSpace: "normal", lineHeight: 1.25, padding: "12px 18px", minHeight: 48 }}
          onClick={() => {
            if (!validarNombreCategoria()) return;
            if (!state.competidores.length) {
              setCategoriaError("Agrega competidores antes de guardar.");
              return;
            }
            onShowConfirm({
              titulo: "GUARDAR Y NUEVA CATEGORÍA",
              mensaje: `¿Guardar "${state.nombre_categoria || "Figuras"}" e iniciar una nueva categoría? El ranking y las puntuaciones quedarán registrados en el reporte.`,
              tipo: "advertencia",
              confirmLabel: "GUARDAR + NUEVO",
              cancelLabel: "Cancelar",
              onConfirm: () => enviarEvento("nuevo_combate"),
            });
          }}>
          Guardar + Nuevo
        </button>
        <button className="btn btn-danger"
          style={{ whiteSpace: "normal", lineHeight: 1.25, padding: "12px 18px", minHeight: 48 }}
          onClick={() => {
            if (!validarNombreCategoria()) return;
            onShowConfirm({
              titulo: "RESETEAR FIGURAS",
              mensaje: "¿Reiniciar la categoría de figuras? Se perderán los competidores y todas las puntuaciones. Usa 'Guardar + Nuevo' si quieres conservarlas.",
              tipo: "peligro",
              confirmLabel: "RESETEAR",
              cancelLabel: "Cancelar",
              onConfirm: () => enviarEvento("reset_figuras"),
            });
          }}>
          Resetear
        </button>
      </div>
      {!puntuacionesCompletas && state.competidores.length > 0 && (
        <p style={{ color: "var(--text-dim)", fontSize: "0.76rem", marginTop: 8, textAlign: "center" }}>
          El podio aparecerá automáticamente en la pantalla pública cuando todos los competidores hayan sido calificados en todos sus criterios.
        </p>
      )}

      {/* Log */}
      {state.log.length > 0 && (
        <div className="card" style={{ marginTop: 12, padding: "10px 14px" }}>
          <div className="card-title" style={{ marginBottom: 6 }}>Log</div>
          <div style={{ maxHeight: 120, overflowY: "auto", fontSize: "0.78rem" }}>
            {state.log.slice(0, 8).map((l, i) => (
              <div key={i} style={{ padding: "3px 0", borderBottom: "1px solid var(--border)", color: "var(--text-muted)" }}>
                {l.txt}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// FIGURAS — Juez Normal
// ══════════════════════════════════════════════════════════════════════════════
function FigurasScoreCard({
  state, enviarEvento, juezId, miCriterio, comp,
}: {
  state: FigurasState;
  enviarEvento: (accion: string, datos?: Record<string, unknown>) => void;
  juezId: string;
  miCriterio: Criterio;
  comp: Competidor;
}) {
  const compId = String(comp.id);
  const valCommitted = state.puntuaciones[compId]?.[juezId];
  const isConfirmed = state.puntuaciones_confirmadas?.[compId]?.[juezId];
  const [nota, setNota] = useState(
    valCommitted !== undefined ? formatScoreValue(valCommitted) : ""
  );
  const [error, setError] = useState("");

  function handleBlur(val: string) {
    if (!val.trim()) {
      setError("");
      return;
    }
    const formatted = normalizeScoreInput(val);
    if (!formatted) {
      setError("La puntuación debe estar entre 0.00 y 9.99.");
      return;
    }
    setNota(formatted);
    setError("");
  }

  function handleGuardar() {
    if (isConfirmed) return;
    if (!categoriaNombreValido(state.nombre_categoria)) {
      setError("El Juez Central debe ingresar un nombre de categoría válido.");
      return;
    }
    const formatted = normalizeScoreInput(nota);
    if (!formatted || !isValidScore(formatted)) {
      setError("Ingresa la puntuación con números, por ejemplo 875 para 8.75.");
      return;
    }
    setNota(formatted);
    setError("");
    enviarEvento("puntuar", {
      juez_id: juezId, competidor_id: comp.id, valor: formatted,
    });
    enviarEvento("confirmar_puntuacion", {
      juez_id: juezId, competidor_id: comp.id,
    });
  }

  const canSave = Boolean(nota && isValidScore(normalizeScoreInput(nota) || nota) && !isConfirmed);

  return (
    <div style={{ padding: 12, maxWidth: 500, margin: "0 auto" }}>
      <div style={{ textAlign: "center", marginBottom: 14 }}>
        <div className="card-title" style={{ fontSize: "1rem" }}>
          {state.nombre_categoria || "FIGURAS"} — {juezId.toUpperCase()}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 10, textAlign: "center", padding: "20px 10px" }}>
        <div style={{ fontWeight: 800, fontSize: "1.4rem", marginBottom: 4, color: "var(--gold)" }}>
          {comp.nombre}
        </div>
        <div style={{ fontSize: "0.82rem", color: "var(--text-muted)", marginBottom: 20 }}>
          {comp.club}
        </div>

        <label style={{ fontSize: "0.8rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-dim)" }}>
          CALIFICA:
        </label>
        <div style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--gold)", marginBottom: 16 }}>
          {miCriterio.nombre} (Max {miCriterio.max_pts})
        </div>

        <input
          className="input"
          type="text"
          inputMode="numeric"
          placeholder="0.00"
          value={nota}
          disabled={isConfirmed}
          onChange={(e) => {
            // Solo números: el punto decimal se inserta automáticamente
            // después del primer dígito (875 → 8.75, 90 → 9.0)
            const digitos = e.target.value.replace(/\D/g, "").slice(0, 3);
            setNota(digitos.length <= 1 ? digitos : `${digitos[0]}.${digitos.slice(1)}`);
            setError("");
          }}
          onBlur={(e) => handleBlur(e.target.value)}
          style={{
            fontFamily: "var(--font-mono)", fontSize: "3rem", textAlign: "center", padding: "16px",
            borderColor: isConfirmed ? "var(--green-border)" : "var(--gold)",
            background: isConfirmed ? "rgba(0, 212, 114, 0.1)" : "var(--bg-elevated)",
            color: isConfirmed ? "var(--green)" : "var(--text)",
            maxWidth: 200, margin: "0 auto", height: 80,
          }}
        />

        {!isConfirmed && (
          <div style={{ marginTop: 8, color: "var(--text-dim)", fontSize: "0.78rem" }}>
            Escribe solo los números: <strong style={{ color: "var(--text-muted)" }}>875</strong> se
            convierte en <strong style={{ color: "var(--gold)" }}>8.75</strong>
          </div>
        )}

        {error && (
          <div style={{ marginTop: 10, color: "var(--orange)", fontWeight: 700, fontSize: "0.86rem" }}>
            {error}
          </div>
        )}

        {isConfirmed ? (
          <div style={{ marginTop: 20, color: "var(--green)", fontWeight: 700, fontSize: "1.1rem" }}>
            ✓ PUNTUACIÓN GUARDADA: {formatScoreValue(valCommitted ?? 0)}
          </div>
        ) : (
          <button className="btn btn-primary"
            onClick={handleGuardar}
            disabled={!canSave}
            style={{ marginTop: 20, width: "100%", padding: 16, fontSize: "1.1rem", fontWeight: 800 }}>
            ✓ GUARDAR PUNTUACIÓN
          </button>
        )}
      </div>
    </div>
  );
}

function FigurasJuez({
  state, enviarEvento, juezId,
}: {
  state: FigurasState;
  enviarEvento: (accion: string, datos?: Record<string, unknown>) => void;
  juezId: string;
}) {
  const MAP_JUEZ = { j1: 0, j2: 1, j3: 2, j4: 3 };
  const idxCriterio = MAP_JUEZ[juezId as keyof typeof MAP_JUEZ];
  const miCriterio = idxCriterio !== undefined ? state.criterios[idxCriterio] : undefined;

  if (!categoriaNombreValido(state.nombre_categoria)) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--text-dim)" }}>
        <p style={{ fontSize: "1.4rem", marginBottom: 8 }}>Esperando nombre de categoría...</p>
        <p style={{ fontSize: "0.85rem" }}>El Juez Central debe ingresar un nombre válido usando solo letras y espacios.</p>
      </div>
    );
  }

  if (state.competidores.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--text-dim)" }}>
        <p style={{ fontSize: "1.4rem", marginBottom: 8 }}>Esperando competidores...</p>
        <p style={{ fontSize: "0.85rem" }}>El Juez Central agregará los competidores.</p>
      </div>
    );
  }

  if (!state.puntuacion_abierta || !state.competidor_activo_id) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--text-dim)" }}>
        <p style={{ fontSize: "1.4rem", marginBottom: 8 }}>Esperando autorización...</p>
        <p style={{ fontSize: "0.85rem" }}>El Juez Central debe activar el turno del competidor.</p>
      </div>
    );
  }

  if (!miCriterio) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--red-alert)" }}>
        <p style={{ fontSize: "1.4rem", marginBottom: 8 }}>No tienes un criterio asignado.</p>
        <p style={{ fontSize: "0.85rem" }}>Este rol no está configurado en los criterios actuales.</p>
      </div>
    );
  }

  const compId = String(state.competidor_activo_id);
  const comp = state.competidores.find((c) => c.id === state.competidor_activo_id);
  if (!comp) return null;

  const valCommitted = state.puntuaciones[compId]?.[juezId];
  const isConfirmed = state.puntuaciones_confirmadas?.[compId]?.[juezId];

  return (
    <FigurasScoreCard
      key={`${compId}-${juezId}-${isConfirmed ? "ok" : "edit"}-${valCommitted ?? "empty"}`}
      state={state}
      enviarEvento={enviarEvento}
      juezId={juezId}
      miCriterio={miCriterio}
      comp={comp}
    />
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// FIGURAS — Pantalla Pública
// ══════════════════════════════════════════════════════════════════════════════
function FigurasPantalla({ state, tatamiId }: { state: FigurasState; tatamiId: string }) {
  const ranking = rankingFiguras(state);
  const nombreCategoria = state._nombre_categoria || state.nombre_categoria || "Figuras";
  const puntuacionesCompletas = figurasPuntuacionesCompletas(state);
  // El podio aparece automáticamente cuando TODOS los competidores fueron
  // calificados en todos sus criterios (el backend finaliza solo al completar).
  const shouldShowPodio = state.finalizado || puntuacionesCompletas;
  const activeComp = state.competidores.find((c) => c.id === state.competidor_activo_id);
  const juecesActivos = juecesActivosFiguras(state);
  const activeCompId = activeComp ? String(activeComp.id) : "";
  const activeTotal = ranking.find((r) => r.id === activeComp?.id)?.total ?? 0;
  // "Comparten puesto" solo cuando hay categoría especial: la comparten los
  // especiales y el 1° del podio normal
  const hayEspeciales = ranking.some((r) => r.especial);
  // En la vista de puntuación en vivo el logo va sobre "EN TURNO", no arriba
  const vistaEnVivo = !shouldShowPodio && Boolean(activeComp) && ranking.length > 0;

  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{
        textAlign: "center", padding: "14px 20px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-card)",
      }}>
        {!vistaEnVivo && <Logo fontSize="clamp(1.5rem, 4vw, 2rem)" />}
        {state._campeonato_nombre && (
          <div style={{
            fontSize: "0.78rem", color: "var(--text-muted)", fontWeight: 700,
            textTransform: "uppercase", letterSpacing: "0.12em", marginTop: 2,
          }}>{state._campeonato_nombre}</div>
        )}
        <div style={{
          fontFamily: "var(--font-display)", fontSize: "clamp(2rem,4vw,3.5rem)",
          color: "var(--gold)", letterSpacing: "0.15em", lineHeight: 1,
          marginTop: 8,
        }}>
          TATAMI {tatamiId}
        </div>
        <div style={{
          fontFamily: "var(--font-body)", fontSize: "0.85rem",
          color: "var(--gold)", fontWeight: 700, textTransform: "uppercase",
          letterSpacing: "0.15em", marginTop: 2,
        }}>{nombreCategoria}</div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "12px 20px" }}>
        {ranking.length === 0 ? (
          <div style={{ textAlign: "center", marginTop: "25%", color: "var(--text-dim)" }}>
            <p style={{ fontSize: "1.6rem" }}>Esperando participantes...</p>
          </div>
        ) : !shouldShowPodio ? (
          activeComp ? (
            /* ── Competidor en turno: puntuación en vivo por criterio ── */
            <div style={{
              height: "100%", display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", textAlign: "center",
              maxWidth: 1100, margin: "0 auto", gap: "clamp(10px, 2vh, 24px)",
            }}>
              <div>
                {/* Logo protagonista, como en el marcador de combates */}
                <Logo
                  soloImagen
                  fontSize="clamp(3.2rem, 16vh, 10.5rem)"
                  style={{ marginBottom: 8 }}
                />
                <div style={{ fontSize: "0.9rem", textTransform: "uppercase", letterSpacing: "0.16em", color: "var(--text-dim)", fontWeight: 800 }}>
                  En turno
                </div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: "clamp(2.2rem,5.5vw,4.5rem)", color: "var(--text)", lineHeight: 1.05 }}>
                  {activeComp.nombre}
                </div>
                {activeComp.club && (
                  <div style={{ marginTop: 4, color: "var(--text-muted)", fontSize: "clamp(0.85rem,1.5vw,1.1rem)" }}>
                    {activeComp.club}
                  </div>
                )}
              </div>

              {/* Criterios según jueces activos */}
              <div style={{
                display: "grid",
                gridTemplateColumns: `repeat(auto-fit, minmax(min(150px, 100%), 1fr))`,
                gap: 12, width: "100%",
              }}>
                {juecesActivos.map((juezId) => {
                  const idx = Number(juezId.slice(1)) - 1;
                  const criterio = state.criterios[idx];
                  if (!criterio) return null;
                  const valor = state.puntuaciones[activeCompId]?.[juezId];
                  const confirmado = Boolean(state.puntuaciones_confirmadas?.[activeCompId]?.[juezId]);
                  const tieneNota = valor !== undefined && valor !== null;
                  return (
                    <div key={juezId} className="animate-fade" style={{
                      padding: "clamp(10px, 2vh, 20px) 12px",
                      background: confirmado ? "rgba(0, 212, 114, 0.08)" : "var(--bg-card)",
                      border: `1.5px solid ${confirmado ? "var(--green-border)" : "var(--border)"}`,
                      borderRadius: "var(--radius)",
                      display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                    }}>
                      <div style={{
                        fontSize: "clamp(0.7rem,1.2vw,0.95rem)", fontWeight: 800,
                        textTransform: "uppercase", letterSpacing: "0.1em",
                        color: "var(--text-muted)",
                      }}>
                        {criterio.nombre}
                      </div>
                      <div style={{
                        fontFamily: "var(--font-display)",
                        fontSize: "clamp(2.2rem,4.5vw,4rem)", lineHeight: 1,
                        color: tieneNota ? (confirmado ? "var(--green)" : "var(--text)") : "var(--text-dim)",
                      }}>
                        {tieneNota ? Number(valor).toFixed(2) : "—"}
                      </div>
                      <div style={{ fontSize: "0.68rem", color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                        {juezId.toUpperCase()}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Total acumulado */}
              <div style={{
                display: "flex", alignItems: "baseline", gap: 14,
                padding: "clamp(8px,1.5vh,16px) clamp(20px,4vw,48px)",
                background: "rgba(240,184,0,0.08)",
                border: "1.5px solid var(--gold-border)",
                borderRadius: "var(--radius-lg)",
              }}>
                <span style={{ fontSize: "clamp(0.8rem,1.4vw,1.1rem)", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.14em", color: "var(--text-muted)" }}>
                  Total
                </span>
                <span style={{ fontFamily: "var(--font-display)", fontSize: "clamp(3rem,7vw,6rem)", color: "var(--gold)", lineHeight: 1 }}>
                  {activeTotal.toFixed(2)}
                </span>
              </div>
            </div>
          ) : (
            /* ── Sin competidor activo: esperando ── */
            <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", color: "var(--text-muted)" }}>
              <div style={{ fontFamily: "var(--font-display)", fontSize: "clamp(2rem,5vw,4rem)", color: "var(--gold)", letterSpacing: "0.08em" }}>
                Puntuaciones en curso
              </div>
              <div style={{ marginTop: 12, fontSize: "clamp(0.9rem,1.6vw,1.2rem)", color: "var(--text-dim)" }}>
                {puntuacionesCompletas
                  ? "Todas las puntuaciones registradas — esperando podio"
                  : "Esperando al siguiente competidor"}
              </div>
            </div>
          )
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 960, margin: "0 auto" }}>
            {ranking.map((comp) => {
              const isActive = state.competidor_activo_id === comp.id;
              const esPrimero = comp.puesto === 1;
              return (
                <div key={comp.id} className="animate-fade" style={{
                  display: "flex", alignItems: "center", gap: 16,
                  padding: "16px 24px",
                  background: isActive ? "rgba(240,184,0,0.12)" : (esPrimero ? "rgba(240,184,0,0.08)" : "var(--bg-card)"),
                  border: `1.5px solid ${isActive ? "var(--gold)" : (esPrimero ? "var(--gold-border)" : "var(--border)")}`,
                  borderRadius: "var(--radius)",
                  boxShadow: esPrimero || isActive ? "var(--shadow-gold)" : undefined,
                }}>
                  <span style={{
                    fontFamily: "var(--font-display)", fontSize: "clamp(3rem,6vw,5rem)",
                    color: colorPuesto(comp.puesto, comp.especial),
                    minWidth: 80, textAlign: "center", lineHeight: 1,
                  }}>{comp.puesto}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontFamily: "var(--font-display)",
                      fontSize: "clamp(2rem,4vw,3.5rem)",
                      letterSpacing: "0.04em", lineHeight: 1,
                      overflowWrap: "anywhere",
                      color: isActive || esPrimero ? "var(--gold)" : "var(--text)",
                    }}>
                      {comp.nombre}
                    </div>
                    {comp.club && (
                      <div style={{
                        fontSize: "clamp(0.85rem,1.6vw,1.1rem)",
                        color: "var(--text-muted)", marginTop: 4,
                        overflowWrap: "anywhere",
                      }}>
                        {comp.club}
                      </div>
                    )}
                    {(comp.especial || comp.empate || (hayEspeciales && comp.puesto === 1)) && (
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
                        {comp.especial && (
                          <span className="badge badge-gold" style={{ fontSize: "clamp(0.6rem,1.2vw,0.85rem)" }}>
                            Categoría Especial
                          </span>
                        )}
                        {hayEspeciales && comp.puesto === 1 && (
                          <span className="badge badge-gold" style={{ fontSize: "clamp(0.6rem,1.2vw,0.85rem)" }}>
                            Comparten puesto
                          </span>
                        )}
                        {comp.empate && (
                          <span className="badge" style={{
                            fontSize: "clamp(0.6rem,1.2vw,0.85rem)",
                            background: "rgba(255,140,0,0.12)",
                            border: "1px solid rgba(255,140,0,0.4)",
                            color: "var(--orange)",
                          }}>
                            Desempate pendiente
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <div style={{
                    fontFamily: "var(--font-display)",
                    fontSize: "clamp(3rem,5vw,5rem)",
                    color: esPrimero || isActive ? "var(--gold)" : "var(--text)",
                    letterSpacing: "0.04em",
                  }}>
                    {comp.total.toFixed(2)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// COMBATE — Pantalla Pública
// ══════════════════════════════════════════════════════════════════════════════
function CombatePantalla({
  state, tatamiId, connected,
}: {
  state: CombateState; tatamiId: string; connected: boolean;
}) {
  const totalHong = marcadorDisplay(state, "hong");
  const totalChung = marcadorDisplay(state, "chung");

  const cronoClass = !state.activo ? "pause"
    : state.segundos <= 5 ? "urgente-5"
    : state.segundos <= 10 ? "urgente"
    : "activo";

  // ── Sonido: gong al terminar el tiempo (requiere activarlo con un toque
  // por la política de autoplay de los navegadores) ──
  const [soundOn, setSoundOn] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const prevSegundosRef = useRef(state.segundos);

  function toggleSound() {
    if (!soundOn) {
      type AudioWindow = Window & { webkitAudioContext?: typeof AudioContext };
      const Ctx = window.AudioContext || (window as AudioWindow).webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
      void audioCtxRef.current.resume();
    }
    setSoundOn(!soundOn);
  }

  useEffect(() => {
    const prev = prevSegundosRef.current;
    prevSegundosRef.current = state.segundos;
    if (!soundOn || !audioCtxRef.current) return;
    // Gong cuando el cronómetro llega a 0 viniendo de un valor mayor
    if (prev > 0 && state.segundos === 0) {
      const ctx = audioCtxRef.current;
      const ahora = ctx.currentTime;
      [196, 98].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, ahora);
        gain.gain.exponentialRampToValueAtTime(i === 0 ? 0.5 : 0.3, ahora + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ahora + 2.2);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ahora);
        osc.stop(ahora + 2.3);
      });
    }
  }, [state.segundos, soundOn]);

  // ── Árbol de la llave en pantalla pública (antes/entre combates) ──
  if (state._mostrar_arbol && state._llave_arbol) {
    return (
      <div style={{ height: "100dvh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{
          textAlign: "center", padding: "12px 20px",
          borderBottom: "1px solid var(--border)", background: "var(--bg-card)",
        }}>
          <Logo fontSize="clamp(1.4rem, 3.5vw, 1.8rem)" />
          {state._campeonato_nombre && (
            <div style={{
              fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 700,
              textTransform: "uppercase", letterSpacing: "0.12em", marginTop: 2,
            }}>{state._campeonato_nombre} · Tatami {tatamiId}</div>
          )}
          <div style={{
            fontFamily: "var(--font-display)", fontSize: "clamp(1.6rem,3.5vw,3rem)",
            color: "var(--gold)", letterSpacing: "0.1em", lineHeight: 1.05, marginTop: 6,
          }}>
            {state._llave_arbol.nombre}
          </div>
          {state._combate_llave && (
            <div style={{
              fontSize: "clamp(0.75rem,1.4vw,1rem)", color: "var(--text)",
              fontWeight: 700, marginTop: 4,
            }}>
              Próximo ({state._combate_llave.ronda_nombre}):{" "}
              <span style={{ color: "var(--hong-light)" }}>{state._combate_llave.comp1.nombre}</span>
              {" vs "}
              <span style={{ color: "var(--chung-light)" }}>{state._combate_llave.comp2.nombre}</span>
            </div>
          )}
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "clamp(10px,2vh,24px) clamp(12px,2vw,28px)" }}>
          <BracketTree
            estructura={state._llave_arbol.estructura}
            variant="pantalla"
            destacar={state._combate_llave
              ? { ronda: state._combate_llave.ronda, partido: state._combate_llave.partido }
              : null}
          />
        </div>
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "8px 24px", borderTop: "1px solid var(--border)",
          fontSize: "0.78rem", color: "var(--text-dim)",
        }}>
          <Logo fontSize="1.1rem" />
          <span>Tatami {tatamiId}</span>
          <span>
            <span className={`status-dot ${connected ? "online" : "offline"}`} />
            {connected ? "En vivo" : "Desconectado"}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
      {/* Main scoreboard */}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center" }}>
        {/* HONG */}
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", padding: "20px 16px",
          borderRight: "1px solid var(--border)", height: "100%",
        }}>
          <div style={{
            fontFamily: "var(--font-display)", fontSize: "clamp(1.2rem,3vw,2.2rem)",
            color: "var(--hong-light)", letterSpacing: "0.06em", textTransform: "uppercase",
          }}>{state.nombreHong}</div>
          <div
            className="proy-score hong"
            key={`h-${totalHong}`}
            style={{ animation: "boom 0.3s ease-out" }}
          >
            {totalHong}
          </div>
          <div style={{ display: "flex", gap: 16, color: "var(--text-muted)", fontSize: "clamp(0.8rem,1.5vw,1.1rem)", fontFamily: "var(--font-mono)", marginTop: 8 }}>
            <span>ESQ {promedioEsquinas(state, "hong").toFixed(1)}</span>
            <span>ARB {state.arbHong}</span>
          </div>
          <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
            {state.kyongHong > 0 && <span style={{ color: "var(--orange)", fontSize: "0.9rem" }}>K:{state.kyongHong}</span>}
            {state.faltasHong > 0 && <span style={{ color: "var(--red-alert)", fontSize: "0.9rem" }}>G:{state.faltasHong}</span>}
          </div>
        </div>

        {/* CENTER */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "0 20px" }}>
          {/* Logo encima del nombre del campeonato — protagonista del centro */}
          <Logo
            soloImagen
            fontSize="clamp(3.2rem, 16vh, 10.5rem)"
            style={{ marginBottom: 8 }}
          />
          {state._campeonato_nombre && (
            <div style={{
              fontSize: "clamp(0.65rem,1.2vw,0.9rem)", color: "var(--text-muted)",
              fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em",
              marginBottom: 4,
            }}>
              {state._campeonato_nombre}
            </div>
          )}
          <div style={{
            fontSize: "clamp(2rem,4vw,3.5rem)", fontFamily: "var(--font-display)",
            color: "var(--gold)", letterSpacing: "0.15em", marginBottom: 12,
            lineHeight: 1
          }}>
            TATAMI {tatamiId}
          </div>
          <div className={`crono-display ${cronoClass}`} style={{ fontSize: "clamp(2.5rem,7vw,6rem)" }}>
            {formatTime(state.segundos)}
          </div>
          <div style={{
            fontFamily: "var(--font-display)", fontSize: "clamp(0.7rem,1.5vw,1.1rem)",
            letterSpacing: "0.2em",
            color: state.ronda === "oro" ? "var(--gold)" : "var(--text-muted)",
            animation: state.ronda === "oro" ? "glow-oro 1.2s infinite alternate" : undefined,
            padding: "4px 12px",
            border: state.ronda === "oro" ? "1.5px solid var(--gold)" : "1px solid transparent",
            borderRadius: 20,
            marginTop: 6,
          }}>
            {RONDAS[state.ronda] || state.ronda}
          </div>
          {state._combate_llave && (
            <div style={{
              fontSize: "clamp(0.65rem,1.2vw,0.95rem)", fontWeight: 800,
              color: "var(--gold)", textTransform: "uppercase",
              letterSpacing: "0.1em", marginTop: 8,
            }}>
              {state._combate_llave.nombre} · {state._combate_llave.ronda_nombre}
            </div>
          )}
        </div>

        {/* CHUNG */}
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", padding: "20px 16px",
          borderLeft: "1px solid var(--border)", height: "100%",
        }}>
          <div style={{
            fontFamily: "var(--font-display)", fontSize: "clamp(1.2rem,3vw,2.2rem)",
            color: "var(--chung-light)", letterSpacing: "0.06em", textTransform: "uppercase",
          }}>{state.nombreChung}</div>
          <div className="proy-score chung" key={`c-${totalChung}`} style={{ animation: "boom 0.3s ease-out" }}>
            {totalChung}
          </div>
          <div style={{ display: "flex", gap: 16, color: "var(--text-muted)", fontSize: "clamp(0.8rem,1.5vw,1.1rem)", fontFamily: "var(--font-mono)", marginTop: 8 }}>
            <span>ESQ {promedioEsquinas(state, "chung").toFixed(1)}</span>
            <span>ARB {state.arbChung}</span>
          </div>
          <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
            {state.kyongChung > 0 && <span style={{ color: "var(--orange)", fontSize: "0.9rem" }}>K:{state.kyongChung}</span>}
            {state.faltasChung > 0 && <span style={{ color: "var(--red-alert)", fontSize: "0.9rem" }}>G:{state.faltasChung}</span>}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "8px 24px", borderTop: "1px solid var(--border)",
        fontSize: "0.78rem", color: "var(--text-dim)",
      }}>
        <Logo fontSize="1.1rem" />
        <span>Tatami {tatamiId}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            type="button"
            onClick={toggleSound}
            title={soundOn ? "Silenciar gong de fin de tiempo" : "Activar gong de fin de tiempo"}
            style={{
              background: "none", border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)", padding: "3px 10px",
              color: soundOn ? "var(--gold)" : "var(--text-dim)",
              cursor: "pointer", fontSize: "0.75rem", fontFamily: "var(--font-body)",
              fontWeight: 700,
            }}
          >
            {soundOn ? "🔊 Sonido ON" : "🔇 Sonido OFF"}
          </button>
          <span>
            <span className={`status-dot ${connected ? "online" : "offline"}`} />
            {connected ? "En vivo" : "Desconectado"}
          </span>
        </span>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// COMBATE — Juez Esquina (botones VERTICALES, solo sus puntos)
// ══════════════════════════════════════════════════════════════════════════════
function CombateJuez({
  state, rol, enviarEvento, pendingEvents, connected, onFlash,
}: {
  state: CombateState; rol: string;
  enviarEvento: (accion: string, datos?: Record<string, unknown>) => void;
  pendingEvents: number; connected: boolean;
  onFlash: (ico: string, txt: string) => void;
}) {
  const miPuntaje = state.jueces?.[rol] || { hong: 0, chung: 0 };
  const nombresListos = competidoresConNombre(state);
  const juezBloqueado = !nombresListos || Boolean(state.ganadorPendienteCierre);
  // Rol fuera de la configuración actual (ej: j3 en combate de 2 jueces)
  const rolNum = rol.startsWith("j") ? Number(rol.slice(1)) : 0;
  const rolInactivo = rolNum > (state.numJueces || 4);

  const PUNTOS = [
    { pts: 1, label: "CUERPO" },
    { pts: 2, label: "GIRO / PAT. CABEZA" },
    { pts: 3, label: "GIRO CABEZA" },
  ];

  function anotar(color: "hong" | "chung", pts: number, label: string) {
    if (!nombresListos) {
      onFlash("⚠️", "NOMBRES REQUERIDOS");
      return;
    }
    onFlash(color === "hong" ? "🔴" : "🔵", `+${pts} JEUMSU`);
    enviarEvento("punto_juez", { juez: rol, color, pts, nombre: label });
  }

  if (rolInactivo) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--text-dim)" }}>
        <p style={{ fontSize: "1.4rem", marginBottom: 8 }}>
          {rol.toUpperCase()} no participa en este combate
        </p>
        <p style={{ fontSize: "0.85rem" }}>
          El Juez Central configuró el combate con {state.numJueces} jueces de esquina.
          Tus puntos no contarían en el marcador.
        </p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 520, margin: "0 auto", padding: "12px 14px", height: "calc(100dvh - 48px)", display: "flex", flexDirection: "column" }}>
      {/* Mini crono + nombre rol */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        marginBottom: 10, padding: "8px 14px",
        background: "var(--bg-card)", borderRadius: "var(--radius)",
        border: "1px solid var(--border)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className={`status-dot ${connected ? "online" : "offline"}`} />
          <span style={{ fontFamily: "var(--font-display)", fontSize: "1rem", letterSpacing: "0.06em" }}>
            {rol.toUpperCase()} · T{state.segundosMax}s
          </span>
        </div>
        <CronoDisplay segundos={state.segundos} activo={state.activo} segundosMax={state.segundosMax} />
      </div>

      {/* Mis puntos — solo los propios */}
      <div className="grid-2" style={{ marginBottom: 10 }}>
        <div className="card card-hong" style={{ textAlign: "center", padding: "10px 8px" }}>
          <div style={{ fontSize: "0.65rem", color: "var(--hong-light)", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em" }}>
            {state.nombreHong}
          </div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: "2.5rem", color: "var(--hong-vivid)" }}>
            {miPuntaje.hong}
          </div>
          <div style={{ fontSize: "0.65rem", color: "var(--text-dim)" }}>Mis puntos</div>
        </div>
        <div className="card card-chung" style={{ textAlign: "center", padding: "10px 8px" }}>
          <div style={{ fontSize: "0.65rem", color: "var(--chung-light)", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em" }}>
            {state.nombreChung}
          </div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: "2.5rem", color: "var(--chung-vivid)" }}>
            {miPuntaje.chung}
          </div>
          <div style={{ fontSize: "0.65rem", color: "var(--text-dim)" }}>Mis puntos</div>
        </div>
      </div>

      {/* Botones VERTICALES en 2 columnas */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, flex: 1 }}>
        {/* Columna HONG */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="card-title" style={{ color: "var(--hong-light)", textAlign: "center" }}>
            HONG
          </div>
          {PUNTOS.map((p) => (
            <button
              key={`h${p.pts}`}
              className="combat-btn hong"
              style={{ flex: 1, opacity: state.oroResuelto || juezBloqueado ? 0.5 : 1 }}
              onClick={() => anotar("hong", p.pts, p.label)}
              disabled={state.oroResuelto || juezBloqueado}
            >
              <span className="pts">+{p.pts}</span>
              <span className="label">{p.label}</span>
            </button>
          ))}
          <button
            className="btn btn-danger"
            style={{ marginTop: 4, padding: "10px 6px", fontSize: "0.82rem", opacity: state.oroResuelto || juezBloqueado ? 0.5 : 1 }}
            disabled={state.oroResuelto || juezBloqueado}
            onClick={() => {
              const hay = state.historial?.some((h) => h.juez === rol && h.color === "hong");
              if (hay) enviarEvento("deshacer_juez", { juez: rol, color: "hong" });
              else onFlash("⚠️", "NADA QUE DESHACER");
            }}
          >
            ↩ Deshacer
          </button>
        </div>

        {/* Columna CHUNG */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="card-title" style={{ color: "var(--chung-light)", textAlign: "center" }}>
            CHUNG
          </div>
          {PUNTOS.map((p) => (
            <button
              key={`c${p.pts}`}
              className="combat-btn chung"
              style={{ flex: 1, opacity: state.oroResuelto || juezBloqueado ? 0.5 : 1 }}
              onClick={() => anotar("chung", p.pts, p.label)}
              disabled={state.oroResuelto || juezBloqueado}
            >
              <span className="pts">+{p.pts}</span>
              <span className="label">{p.label}</span>
            </button>
          ))}
          <button
            className="btn btn-danger"
            style={{ marginTop: 4, padding: "10px 6px", fontSize: "0.82rem", opacity: state.oroResuelto || juezBloqueado ? 0.5 : 1 }}
            disabled={state.oroResuelto || juezBloqueado}
            onClick={() => {
              const hay = state.historial?.some((h) => h.juez === rol && h.color === "chung");
              if (hay) enviarEvento("deshacer_juez", { juez: rol, color: "chung" });
              else onFlash("⚠️", "NADA QUE DESHACER");
            }}
          >
            ↩ Deshacer
          </button>
        </div>
      </div>

      {pendingEvents > 0 && (
        <div style={{ textAlign: "center", marginTop: 8 }}>
          <span className="status-dot pending" />
          <span style={{ color: "var(--orange)", fontSize: "0.78rem" }}>{pendingEvents} pendiente(s)</span>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// COMBATE — Juez Central (Arbitro)
// ══════════════════════════════════════════════════════════════════════════════
function CombateArbitro({
  state, enviarEvento, tatamiDbId,
  onFlash, onFaltaFlash, onShowConfirm, broadcast
}: {
  state: CombateState;
  enviarEvento: (accion: string, datos?: Record<string, unknown>) => void;
  tatamiId: string;
  tatamiDbId: string;
  onFlash: (ico: string, txt: string) => void;
  onFaltaFlash: (data: FaltaFlashData) => void;
  onShowConfirm: (data: import("@/components/AlertSystem").ConfirmData) => void;
  broadcast: (data: Record<string, unknown>) => void;
}) {
  const totalHong = marcadorDisplay(state, "hong");
  const totalChung = marcadorDisplay(state, "chung");
  const esqHong = promedioEsquinas(state, "hong").toFixed(1);
  const esqChung = promedioEsquinas(state, "chung").toFixed(1);
  const nombresListos = competidoresConNombre(state);
  const accionesBloqueadas = !nombresListos || Boolean(state.ganadorPendienteCierre);

  const PUNTOS_ARB = [
    { pts: 2, nombre: "Knock Down" },
    { pts: 2, nombre: "Derribo/Barrida" },
    { pts: 2, nombre: "Proyeccion" },
  ];
  const RONDAS_BTN = [
    { id: "r1", label: "Round 1" }, { id: "r2", label: "Round 2" }, { id: "oro", label: "Pto. Oro" },
  ];
  const DURACIONES = [30, 60, 90, 120];

  // Validar nombres antes de iniciar crono
  function handleCronoStart() {
    if (!nombresListos) {
      onShowConfirm({
        titulo: "NOMBRES REQUERIDOS",
        mensaje: "Debes ingresar el nombre de ambos competidores antes de iniciar el cronómetro. El nombre aparecerá en la pantalla pública y en los reportes.",
        tipo: "advertencia",
        solo_ok: true,
        onConfirm: () => {},
      });
      return;
    }
    enviarEvento("crono_start");
  }

  function handleEspecial(color: "hong" | "chung", pts: number, nombre: string) {
    if (!nombresListos) {
      onFlash("⚠️", "NOMBRES REQUERIDOS");
      return;
    }
    if (state.oroResuelto) {
      onFlash("⚠️", "PUNTO DE ORO BLOQUEADO");
      return;
    }
    const data: FaltaFlashData = {
      ico: "⭐",
      titulo: `+${pts} ${nombre.toUpperCase()}`,
      sub: `${color === "hong" ? "🔴 HONG" : "🔵 CHUNG"}`,
      tipo: "especial",
    };
    onFaltaFlash(data);
    broadcast({ tipo: "falta-flash", ico: data.ico, titulo: data.titulo, sub: data.sub, tipoFalta: data.tipo });
    enviarEvento("especial", { color, pts, nombre });
  }

  function handleKyonggo(color: "hong" | "chung") {
    if (!nombresListos) {
      onFlash("⚠️", "NOMBRES REQUERIDOS");
      return;
    }
    const num = (color === "hong" ? state.kyongHong : state.kyongChung) + 1;
    const data: FaltaFlashData = {
      ico: "⚠️",
      titulo: "KYONGGO −0.5",
      sub: `${color === "hong" ? "🔴 HONG" : "🔵 CHUNG"} · Advertencia #${num}`,
      tipo: "adv",
    };
    onFaltaFlash(data);
    broadcast({ tipo: "falta-flash", ico: data.ico, titulo: data.titulo, sub: data.sub, tipoFalta: data.tipo });
    enviarEvento("kyonggo", { color });
  }

  function handleGamjeum(color: "hong" | "chung") {
    if (!nombresListos) {
      onFlash("⚠️", "NOMBRES REQUERIDOS");
      return;
    }
    const num = (color === "hong" ? state.faltasHong : state.faltasChung) + 1;
    const data: FaltaFlashData = {
      ico: "🚫",
      titulo: "GAMJEUM −1",
      sub: `${color === "hong" ? "🔴 HONG" : "🔵 CHUNG"} · Falta #${num}`,
      tipo: "falta",
    };
    onFaltaFlash(data);
    broadcast({ tipo: "falta-flash", ico: data.ico, titulo: data.titulo, sub: data.sub, tipoFalta: data.tipo });
    enviarEvento("gamjeum", { color });
  }

  function handleDeclararGanador(color: "hong" | "chung", motivo: string) {
    if (!nombresListos) {
      onShowConfirm({
        titulo: "NOMBRES REQUERIDOS",
        mensaje: "Debes ingresar el nombre de ambos competidores antes de declarar un ganador.",
        tipo: "advertencia",
        solo_ok: true,
        onConfirm: () => {},
      });
      return;
    }

    const nombre = color === "hong" ? state.nombreHong : state.nombreChung;
    onShowConfirm({
      titulo: motivo.toUpperCase(),
      mensaje: `¿Declarar ganador a ${nombre}? Esta decisión pausará el combate y bloqueará todas las pantallas hasta que el Juez Central cierre la alerta.`,
      tipo: "advertencia",
      confirmLabel: "DECLARAR GANADOR",
      cancelLabel: "Cancelar",
      onConfirm: () => enviarEvento("declarar_ganador", { color, motivo }),
    });
  }

  function handleNuevoCombate() {
    onShowConfirm({
      titulo: "GUARDAR Y NUEVO COMBATE",
      mensaje: "¿Guardar este combate e iniciar uno nuevo? Los puntos quedarán registrados en el reporte.",
      tipo: "advertencia",
      confirmLabel: "GUARDAR + NUEVO",
      cancelLabel: "Cancelar",
      onConfirm: () => {
        onFlash("📁", "COMBATE GUARDADO");
        enviarEvento("nuevo_combate");
      },
    });
  }

  function handleReset() {
    onShowConfirm({
      titulo: "RESETEAR MARCADOR",
      mensaje: "¿Reiniciar el marcador? Los puntos se perderán. Usa 'Guardar + Nuevo' si quieres conservarlos.",
      tipo: "peligro",
      confirmLabel: "RESETEAR",
      onConfirm: () => enviarEvento("reset"),
    });
  }

  return (
    <div style={{ maxWidth: 780, margin: "0 auto", padding: "10px 14px", position: "relative" }}>
      {state.oroPendienteAprobacion && (
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(15,15,25,0.9)", zIndex: 10,
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          backdropFilter: "blur(5px)", borderRadius: "var(--radius)"
        }}>
          <div style={{ fontSize: "3rem", marginBottom: 12 }}>🏆</div>
          <div style={{ color: "var(--gold)", fontWeight: 800, fontSize: "1.5rem", letterSpacing: "0.05em", textAlign: "center", padding: "0 20px" }}>
            PUNTO DE ORO REGISTRADO
          </div>
          <div style={{ color: "var(--text)", marginTop: 8, textAlign: "center", maxWidth: 400, fontSize: "0.9rem" }}>
            Un juez ha marcado un punto de oro para {state.oroGanadorNombre || "el competidor"}. El combate finaliza si lo apruebas.
          </div>
          <div style={{ display: "flex", gap: 16, marginTop: 24 }}>
            <button className="btn btn-primary" onClick={() => enviarEvento("aprobar_oro")} style={{ padding: "12px 24px", fontSize: "1.1rem" }}>
              ✓ APROBAR Y FINALIZAR
            </button>
            <button className="btn btn-danger" onClick={() => enviarEvento("rechazar_oro")} style={{ padding: "12px 24px", fontSize: "1.1rem" }}>
              ✕ RECHAZAR Y CONTINUAR
            </button>
          </div>
        </div>
      )}

      {/* Combates de eliminación (llaves asignadas a este tatami) */}
      <LlavePanel
        tatamiDbId={tatamiDbId}
        combateLlave={state._combate_llave}
        mostrarArbol={Boolean(state._mostrar_arbol)}
        hayArbol={Boolean(state._hay_arbol)}
        enviarEvento={enviarEvento}
        onShowConfirm={onShowConfirm}
      />

      {/* Nombres */}
      <div className="grid-2" style={{ marginBottom: 10 }}>
        <input className="input" placeholder="Nombre Hong (Requerido)" value={state.nombreHong === "Hong" ? "" : state.nombreHong}
          onChange={(e) => enviarEvento("nombres", { nombreHong: e.target.value || "Hong", nombreChung: state.nombreChung })}
          style={{
            borderColor: state.nombreHong === "Hong" ? "var(--hong-border)" : "var(--green-border)",
            textAlign: "center", fontWeight: 700, color: "var(--hong-light)",
          }} />
        <input className="input" placeholder="Nombre Chung (Requerido)" value={state.nombreChung === "Chung" ? "" : state.nombreChung}
          onChange={(e) => enviarEvento("nombres", { nombreHong: state.nombreHong, nombreChung: e.target.value || "Chung" })}
          style={{
            borderColor: state.nombreChung === "Chung" ? "var(--chung-border)" : "var(--green-border)",
            textAlign: "center", fontWeight: 700, color: "var(--chung-light)",
          }} />
      </div>
      {(state.nombreHong === "Hong" || state.nombreChung === "Chung") && (
        <p style={{ color: "var(--orange)", fontSize: "0.78rem", textAlign: "center", marginBottom: 8 }}>
          ⚠️ Ingresa los nombres antes de iniciar el cronómetro
        </p>
      )}

      {/* Scores + Timer */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 8, marginBottom: 10 }}>
        <div className="card card-hong" style={{ textAlign: "center", padding: "10px 8px" }}>
          <div style={{ fontSize: "0.65rem", color: "var(--hong-light)", fontWeight: 800 }}>{state.nombreHong}</div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: "3rem", color: "var(--hong-vivid)" }}>{totalHong}</div>
          <div style={{ fontSize: "0.65rem", color: "var(--text-dim)" }}>ESQ:{esqHong} ARB:{state.arbHong}</div>
          <div style={{ fontSize: "0.65rem", marginTop: 2 }}>
            {state.kyongHong > 0 && <span style={{ color: "var(--orange)", marginRight: 4 }}>K:{state.kyongHong}</span>}
            {state.faltasHong > 0 && <span style={{ color: "var(--red-alert)" }}>G:{state.faltasHong}</span>}
          </div>
        </div>

        {/* Timer */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minWidth: 100 }}>
          <CronoDisplay segundos={state.segundos} activo={state.activo} segundosMax={state.segundosMax} />
          <div style={{ display: "flex", gap: 5, marginTop: 6 }}>
            <button className="btn btn-sm"
              onClick={state.activo ? () => enviarEvento("crono_pause") : handleCronoStart}
              disabled={Boolean(state.ganadorPendienteCierre)}
              style={{
                padding: "5px 10px", fontWeight: 800,
                opacity: state.ganadorPendienteCierre ? 0.45 : 1,
                background: state.activo ? "rgba(255,68,68,0.15)" : "rgba(0,212,114,0.15)",
                borderColor: state.activo ? "rgba(255,68,68,0.4)" : "rgba(0,212,114,0.4)",
                color: state.activo ? "var(--red-alert)" : "var(--green)",
              }}>
              {state.activo ? "PAUSA" : "PLAY"}
            </button>
            <button className="btn btn-sm"
              onClick={() => enviarEvento("crono_reset", { segundosMax: state.segundosMax })}
              disabled={accionesBloqueadas}
              style={{ padding: "5px 8px", opacity: accionesBloqueadas ? 0.45 : 1 }}>RST</button>
          </div>
        </div>

        <div className="card card-chung" style={{ textAlign: "center", padding: "10px 8px" }}>
          <div style={{ fontSize: "0.65rem", color: "var(--chung-light)", fontWeight: 800 }}>{state.nombreChung}</div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: "3rem", color: "var(--chung-vivid)" }}>{totalChung}</div>
          <div style={{ fontSize: "0.65rem", color: "var(--text-dim)" }}>ESQ:{esqChung} ARB:{state.arbChung}</div>
          <div style={{ fontSize: "0.65rem", marginTop: 2 }}>
            {state.kyongChung > 0 && <span style={{ color: "var(--orange)", marginRight: 4 }}>K:{state.kyongChung}</span>}
            {state.faltasChung > 0 && <span style={{ color: "var(--red-alert)" }}>G:{state.faltasChung}</span>}
          </div>
        </div>
      </div>

      {/* Ronda + Duración */}
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
        {RONDAS_BTN.map((r) => (
          <button key={r.id} className="btn btn-sm"
            onClick={() => enviarEvento("ronda", { ronda: r.id })}
            disabled={accionesBloqueadas}
            style={{
              opacity: accionesBloqueadas ? 0.45 : 1,
              background: state.ronda === r.id ? "var(--gold-bg)" : undefined,
              borderColor: state.ronda === r.id ? "var(--gold-border)" : undefined,
              color: state.ronda === r.id ? "var(--gold)" : undefined,
              animation: state.ronda === "oro" && r.id === "oro" ? "glow-oro 1.2s infinite alternate" : undefined,
            }}>{r.label}</button>
        ))}
        <span style={{ color: "var(--border-light)", alignSelf: "center", fontSize: "1.2rem" }}>|</span>
        {DURACIONES.map((d) => (
          <button key={d} className="btn btn-sm"
            onClick={() => enviarEvento("crono_reset", { segundosMax: d })}
            disabled={accionesBloqueadas}
            style={{
              opacity: accionesBloqueadas ? 0.45 : 1,
              background: state.segundosMax === d ? "var(--chung-bg)" : undefined,
              borderColor: state.segundosMax === d ? "var(--chung-border)" : undefined,
            }}>{d}s</button>
        ))}
        <span style={{ color: "var(--border-light)", alignSelf: "center", fontSize: "1.2rem" }}>|</span>
        <span style={{ color: "var(--text-muted)", fontSize: "0.78rem", alignSelf: "center", fontWeight: 700 }}>Jueces:</span>
        {[2, 3, 4].map((n) => (
          <button key={n} className="btn btn-sm"
            onClick={() => enviarEvento("set_num_jueces", { numJueces: n })}
            disabled={accionesBloqueadas}
            style={{
              opacity: accionesBloqueadas ? 0.45 : 1,
              background: state.numJueces === n ? "var(--gold-bg)" : undefined,
              borderColor: state.numJueces === n ? "var(--gold-border)" : undefined,
              color: state.numJueces === n ? "var(--gold)" : undefined,
            }}>{n}</button>
        ))}
      </div>

      {/* Puntos árbitro */}
      <div className="card-title">Puntos del Juez Central</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 8 }}>
        {PUNTOS_ARB.map((p) => (
          <div key={p.nombre} style={{ display: "contents" }}>
            <button
              className="combat-btn hong"
              onClick={() => handleEspecial("hong", p.pts, p.nombre)}
              disabled={state.oroResuelto || accionesBloqueadas}
              style={{ opacity: state.oroResuelto || accionesBloqueadas ? 0.5 : 1 }}
            >
              <span className="pts">+{p.pts}</span>
              <span className="label">{p.nombre}</span>
            </button>
            <button
              className="combat-btn chung"
              onClick={() => handleEspecial("chung", p.pts, p.nombre)}
              disabled={state.oroResuelto || accionesBloqueadas}
              style={{ opacity: state.oroResuelto || accionesBloqueadas ? 0.5 : 1 }}
            >
              <span className="pts">+{p.pts}</span>
              <span className="label">{p.nombre}</span>
            </button>
          </div>
        ))}
      </div>

      {/* Faltas */}
      <div className="card-title">Faltas</div>
      <div className="grid-2" style={{ marginBottom: 8 }}>
        <button className="combat-btn hong" onClick={() => handleKyonggo("hong")} disabled={accionesBloqueadas} style={{ opacity: accionesBloqueadas ? 0.5 : 1 }}>
          <span className="pts">−0.5</span><span className="label">KyongGo HONG</span>
        </button>
        <button className="combat-btn chung" onClick={() => handleKyonggo("chung")} disabled={accionesBloqueadas} style={{ opacity: accionesBloqueadas ? 0.5 : 1 }}>
          <span className="pts">−0.5</span><span className="label">KyongGo CHUNG</span>
        </button>
        <button className="combat-btn falta" onClick={() => handleGamjeum("hong")} disabled={accionesBloqueadas} style={{ opacity: accionesBloqueadas ? 0.5 : 1 }}>
          <span className="pts">−1</span><span className="label">GamJeum HONG</span>
        </button>
        <button className="combat-btn falta" onClick={() => handleGamjeum("chung")} disabled={accionesBloqueadas} style={{ opacity: accionesBloqueadas ? 0.5 : 1 }}>
          <span className="pts">−1</span><span className="label">GamJeum CHUNG</span>
        </button>
      </div>

      {/* Decisiones */}
      <div className="card-title">Decisión del Juez Central</div>
      <div className="grid-2" style={{ marginBottom: 8 }}>
        <button
          className="combat-btn hong"
          onClick={() => handleDeclararGanador("hong", "Superioridad técnica")}
          disabled={accionesBloqueadas}
          style={{ opacity: accionesBloqueadas ? 0.5 : 1 }}
        >
          <span className="pts">S.T.</span><span className="label">Superioridad Hong</span>
        </button>
        <button
          className="combat-btn chung"
          onClick={() => handleDeclararGanador("chung", "Superioridad técnica")}
          disabled={accionesBloqueadas}
          style={{ opacity: accionesBloqueadas ? 0.5 : 1 }}
        >
          <span className="pts">S.T.</span><span className="label">Superioridad Chung</span>
        </button>
        <button
          className="combat-btn hong"
          onClick={() => handleDeclararGanador("hong", "Decisión del Juez Central")}
          disabled={accionesBloqueadas}
          style={{ opacity: accionesBloqueadas ? 0.5 : 1 }}
        >
          <span className="pts">SUNG</span><span className="label">Ganador Hong</span>
        </button>
        <button
          className="combat-btn chung"
          onClick={() => handleDeclararGanador("chung", "Decisión del Juez Central")}
          disabled={accionesBloqueadas}
          style={{ opacity: accionesBloqueadas ? 0.5 : 1 }}
        >
          <span className="pts">SUNG</span><span className="label">Ganador Chung</span>
        </button>
      </div>

      {/* Deshacer + Guardar */}
      <div className="grid-2" style={{ marginBottom: 8 }}>
        <button className="btn btn-sm btn-danger"
          disabled={accionesBloqueadas}
          style={{ opacity: accionesBloqueadas ? 0.5 : 1 }}
          onClick={() => enviarEvento("deshacer_arbitro", { color: "hong" })}>
          ↩ Deshacer Hong
        </button>
        <button className="btn btn-sm btn-danger"
          disabled={accionesBloqueadas}
          style={{ opacity: accionesBloqueadas ? 0.5 : 1 }}
          onClick={() => enviarEvento("deshacer_arbitro", { color: "chung" })}>
          ↩ Deshacer Chung
        </button>
      </div>

      <div className="grid-2" style={{ marginBottom: 10 }}>
        <button className="btn btn-primary" onClick={handleNuevoCombate} disabled={accionesBloqueadas} style={{ opacity: accionesBloqueadas ? 0.5 : 1 }}>
          Guardar + Nuevo
        </button>
        <button className="btn btn-danger" onClick={handleReset} disabled={accionesBloqueadas} style={{ opacity: accionesBloqueadas ? 0.5 : 1 }}>
          Reset Total
        </button>
      </div>

      {/* Log */}
      {state.log && state.log.length > 0 && (
        <div className="card" style={{ padding: "8px 14px" }}>
          <div className="card-title" style={{ marginBottom: 4, fontSize: "0.72rem" }}>Log reciente</div>
          <div style={{ maxHeight: 140, overflowY: "auto", fontSize: "0.76rem" }}>
            {state.log.map((l, i) => (
              <div key={i} style={{ padding: "3px 0", borderBottom: "1px solid var(--border)", color: "var(--text-muted)" }}>
                {l.txt}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ══════════════════════════════════════════════════════════════════════════════
function TatamiContent() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();

  const tatamiId = params.id as string;
  const rol = searchParams.get("rol") || "pantalla";

  const token = typeof window !== "undefined" ? localStorage.getItem("dinamyt_token") : null;
  const { state, connected, hasServerState, socketError, pendingEvents, enviarEvento, broadcast, alerts: socketAlerts, clearAlert } = useCombate(tatamiId, rol, token);

  const alertSystem = useAlertSystem();

  // Wire socket alerts → alertSystem
  useEffect(() => {
    if (socketAlerts.faltaFlash) {
      alertSystem.showFaltaFlash({
        ico: socketAlerts.faltaFlash.ico,
        titulo: socketAlerts.faltaFlash.titulo,
        sub: socketAlerts.faltaFlash.sub,
        tipo: (socketAlerts.faltaFlash.tipoFalta as "adv" | "falta" | "especial") || "adv",
      });
      clearAlert("faltaFlash");
    }
  }, [socketAlerts.faltaFlash]);

  useEffect(() => {
    if (socketAlerts.ganador) {
      alertSystem.showGanador(socketAlerts.ganador as GanadorData);
      clearAlert("ganador");
    }
  }, [socketAlerts.ganador]);

  useEffect(() => {
    if (socketAlerts.alerta12) {
      alertSystem.showAlerta12(socketAlerts.alerta12 as Alerta12Data);
      clearAlert("alerta12");
    }
  }, [socketAlerts.alerta12]);

  useEffect(() => {
    if (socketAlerts.derrota) {
      alertSystem.showDerrota(socketAlerts.derrota as DerrotaData);
      clearAlert("derrota");
    }
  }, [socketAlerts.derrota]);

  useEffect(() => {
    if (socketAlerts.rechazo) {
      alertSystem.showConfirm({
        titulo: "ACCIÓN RECHAZADA",
        mensaje: socketAlerts.rechazo.message,
        tipo: "advertencia",
        solo_ok: true,
        onConfirm: () => {},
      });
      clearAlert("rechazo");
    }
  }, [socketAlerts.rechazo]);

  const anyState = state as unknown as AnyState;
  const categoria = anyState._categoria || "combate";
  const esFiguras = isFiguras(anyState);
  const nombreCategoria = anyState._nombre_categoria || (isFiguras(anyState) ? anyState.nombre_categoria : "") || "Figuras";
  // Número visible del tatami dentro de su campeonato (no el ID interno)
  const tatamiLabel = String(anyState._tatami_numero ?? tatamiId);

  const isArbitro = rol === "arbitro";
  const isPantalla = rol === "pantalla";

  useEffect(() => {
    if (
      state.ganadorPendienteCierre
      && state.ganadorPendienteNombre
      && (state.ganadorPendienteColor === "hong" || state.ganadorPendienteColor === "chung")
    ) {
      alertSystem.showGanador({
        nombre: state.ganadorPendienteNombre,
        color: state.ganadorPendienteColor,
        motivo: state.ganadorPendienteMotivo,
      });
    } else if (!state.ganadorPendienteCierre) {
      alertSystem.clearGanador();
    }
  }, [
    state.ganadorPendienteCierre,
    state.ganadorPendienteNombre,
    state.ganadorPendienteColor,
    state.ganadorPendienteMotivo,
  ]);

  // Auth check
  useEffect(() => {
    if (!isPantalla) {
      const user = localStorage.getItem("dinamyt_user");
      if (!user) { router.replace("/login"); }
    }
  }, [isPantalla, router]);

  function getRolBack() {
    const user = localStorage.getItem("dinamyt_user");
    if (!user) return "/login";
    if (JSON.parse(user).rol !== "admin") return "/juez";
    // El admin vuelve a los tatamis del campeonato de este tatami,
    // no hasta la lista general de campeonatos.
    const campId = anyState._campeonato_id;
    return campId ? `/admin/campeonato/${campId}` : "/admin";
  }

  function handleVolver() {
    alertSystem.showConfirm({
      titulo: "VOLVER",
      mensaje: "¿Volver al panel? Los puntos están guardados en el servidor y se pueden recuperar.",
      tipo: "info",
      confirmLabel: "Volver",
      onConfirm: () => router.push(getRolBack()),
    });
  }

  function handleChangeCategoria(cat: string) {
    if (cat === categoria) return;
    if (esFiguras && figurasConDatos(anyState as FigurasState)) {
      alertSystem.showConfirm({
        titulo: "FIGURAS EN CURSO",
        mensaje: "Guarda o resetea la categoría de figuras antes de cambiar a combate.",
        tipo: "peligro",
        solo_ok: true,
        onConfirm: () => {},
      });
      return;
    }
    const combateState = state as CombateState;
    if (combateActivo(combateState)) {
      alertSystem.showConfirm({
        titulo: "COMBATE EN CURSO",
        mensaje: "Hay un combate activo con puntos o tiempo transcurrido. Debes guardar o resetear antes de cambiar la categoría.",
        tipo: "peligro",
        solo_ok: true,
        onConfirm: () => {},
      });
      return;
    }
    enviarEvento("cambiar_categoria", { categoria: cat });
  }

  function handleClearGanador() {
    if (isArbitro && state.ganadorPendienteCierre) {
      enviarEvento("cerrar_ganador");
    }
    alertSystem.clearGanador();
  }

  if (socketError && !isPantalla) {
    return (
      <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <div className="card" style={{ maxWidth: 460, width: "100%", textAlign: "center" }}>
          <Logo stacked fontSize="1.9rem" style={{ marginBottom: 12 }} />
          <div style={{ color: "var(--gold)", fontWeight: 800, fontSize: "1rem", marginBottom: 8 }}>
            Rol no disponible
          </div>
          <p style={{ color: "var(--text-muted)", marginBottom: 16 }}>
            {socketError}
          </p>
          <button className="btn btn-primary" onClick={() => router.push(getRolBack())}>
            Volver
          </button>
        </div>
      </div>
    );
  }

  if (!hasServerState) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100dvh" }}>
        <Logo stacked className="animate-fade" fontSize="2.4rem" />
      </div>
    );
  }

  // Pantalla pública — sin auth, renderizar inmediatamente
  if (isPantalla) {
    if (anyState._tatami_activo === false) {
      return (
        <div style={{ height: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <Logo stacked fontSize="clamp(2rem, 6vw, 3rem)" style={{ marginBottom: 16 }} />
          <div style={{ fontSize: "2.5rem", color: "var(--text-dim)", fontFamily: "var(--font-display)", letterSpacing: "0.15em", marginBottom: 8 }}>
            TATAMI {tatamiLabel}
          </div>
          <div style={{ color: "var(--orange)", fontSize: "1.2rem", fontWeight: 700, letterSpacing: "0.1em" }}>
            ESTE TATAMI SE ENCUENTRA DESACTIVADO
          </div>
        </div>
      );
    }

    return (
      <div style={{ position: "relative" }}>
        <AlertSystem
          alerts={alertSystem.alerts}
          onClearGanador={handleClearGanador}
          onClearAlerta12={alertSystem.clearAlerta12}
          onClearDerrota={alertSystem.clearDerrota}
          onClearConfirm={alertSystem.clearConfirm}
          isPantalla
          canCloseGanador={false}
        />
        {esFiguras
          ? <FigurasPantalla state={anyState as FigurasState} tatamiId={tatamiLabel} />
          : <CombatePantalla
              state={state}
              tatamiId={tatamiLabel}
              connected={connected}
            />
        }
      </div>
    );
  }

  // Juez / Árbitro
  return (
    <div style={{ minHeight: "100dvh" }}>
      {/* Global alert system */}
      <AlertSystem
        alerts={alertSystem.alerts}
        onClearGanador={handleClearGanador}
        onClearAlerta12={alertSystem.clearAlerta12}
        onClearDerrota={alertSystem.clearDerrota}
        onClearConfirm={alertSystem.clearConfirm}
        canCloseGanador={isArbitro}
      />

      {/* Top bar */}
      <div className="tatami-topbar" style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "8px 14px",
        background: "var(--bg-card)", borderBottom: "1px solid var(--border)",
        position: "sticky", top: 0, zIndex: 100,
      }}>
        {/* Left: Volver */}
        <button className="btn btn-ghost btn-sm" onClick={handleVolver}
          style={{ gap: 4 }}>
          ← Volver
        </button>

        {/* Center: estado + categoría selector */}
        <div className="tatami-topbar-center" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className={`status-dot ${connected ? "online" : "offline"}`} />
          <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>T{tatamiLabel}</span>
          {isArbitro && <CatSelector current={categoria} onSelect={handleChangeCategoria} figurasLabel={nombreCategoria} />}
          {!isArbitro && (
            <span style={{ fontSize: "0.72rem", color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
              {categoria} · {rol.toUpperCase()}
            </span>
          )}
        </div>

        {/* Right: rol label + tatami activo */}
        <div className="tatami-topbar-right" style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {isArbitro && (
            <button
              className={`tatami-active-btn btn btn-sm ${anyState._tatami_activo ? "btn-primary" : "btn-danger"}`}
              onClick={() => {
                if (anyState._tatami_activo) {
                  alertSystem.showConfirm({
                    titulo: "DESACTIVAR TATAMI",
                    mensaje: "¿Estás seguro? La pantalla pública mostrará 'Desactivado' y los jueces no podrán puntuar.",
                    tipo: "peligro",
                    confirmLabel: "Desactivar",
                    onConfirm: () => enviarEvento("desactivar_tatami"),
                  });
                } else {
                  enviarEvento("activar_tatami");
                }
              }}
              style={{ fontWeight: 800, padding: "6px 12px", fontSize: "0.7rem", minHeight: 32 }}
            >
              {anyState._tatami_activo ? "ACTIVO" : "DESACTIVADO"}
            </button>
          )}
          <span className="tatami-topbar-rol-label" style={{ fontSize: "0.72rem", color: "var(--text-dim)" }}>
            {isArbitro ? "Juez Central" : rol.toUpperCase()}
          </span>
        </div>
      </div>

      {/* Estilos del topbar — a nivel de página para que apliquen en
          combate Y figuras (antes vivían dentro de FigurasScoreCard). */}
      <style>{`
        .tatami-topbar {
          flex-wrap: wrap;
          gap: 8px;
          max-width: 100%;
        }
        .tatami-topbar > * {
          min-width: 0;
        }
        .tatami-topbar-center {
          min-width: 0;
          flex: 1 1 auto;
          justify-content: center;
          flex-wrap: wrap;
        }
        .tatami-topbar-right {
          flex: 0 1 auto;
          flex-wrap: wrap;
          justify-content: flex-end;
          min-width: 0;
        }
        .tatami-active-btn {
          min-width: 0;
          max-width: 100%;
          line-height: 1.1;
          white-space: nowrap;
          flex: 0 1 auto;
        }
        @media (max-width: 640px) {
          .tatami-topbar {
            align-items: stretch !important;
            padding: 8px 10px !important;
          }
          .tatami-topbar > .btn {
            flex: 0 1 auto;
          }
          .tatami-topbar-center {
            order: 3;
            flex-basis: 100%;
            justify-content: flex-start;
            overflow-x: auto;
            padding-bottom: 2px;
          }
          .tatami-topbar-right {
            flex: 1 1 auto;
            gap: 8px !important;
            align-items: center;
          }
          .tatami-topbar-rol-label {
            display: none;
          }
          .tatami-active-btn {
            min-height: 40px;
            height: auto !important;
            padding: 8px 10px !important;
            flex: 1 1 auto;
            font-size: 0.72rem !important;
          }
        }
        @media (max-width: 380px) {
          .tatami-active-btn {
            white-space: normal;
            word-break: break-word;
          }
        }
      `}</style>

      {/* Content */}
      <div style={{ position: "relative", flex: 1 }}>
        {anyState._tatami_activo === false && !isArbitro && (
          <div style={{
            position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
            background: "rgba(15,15,25,0.85)", zIndex: 50,
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            backdropFilter: "blur(4px)"
          }}>
            <div style={{ fontSize: "2rem", marginBottom: 12 }}>⏸️</div>
            <div style={{ color: "var(--orange)", fontWeight: 800, fontSize: "1.2rem", letterSpacing: "0.05em" }}>TATAMI DESACTIVADO</div>
            <div style={{ color: "var(--text-muted)", marginTop: 8 }}>Esperando activación del Juez Central</div>
          </div>
        )}

        {esFiguras ? (
          isArbitro
            ? <FigurasArbitro
                state={anyState as FigurasState}
                enviarEvento={enviarEvento}
                tatamiId={tatamiLabel}
                onShowConfirm={alertSystem.showConfirm}
              />
            : <FigurasJuez state={anyState as FigurasState} enviarEvento={enviarEvento} juezId={rol} />
        ) : (
          isArbitro
            ? <CombateArbitro
                state={state}
                enviarEvento={enviarEvento}
                tatamiId={tatamiLabel}
                tatamiDbId={tatamiId}
                onFlash={alertSystem.showFlash}
                onFaltaFlash={alertSystem.showFaltaFlash}
                onShowConfirm={alertSystem.showConfirm}
                broadcast={broadcast}
              />
            : <CombateJuez
                state={state}
                rol={rol}
                enviarEvento={enviarEvento}
                pendingEvents={pendingEvents}
                connected={connected}
                onFlash={alertSystem.showFlash}
              />
        )}
      </div>
    </div>
  );
}

export default function TatamiPage() {
  return (
    <Suspense fallback={
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100dvh" }}>
        <Logo stacked className="animate-fade" fontSize="2.4rem" />
      </div>
    }>
      <TatamiContent />
    </Suspense>
  );
}
