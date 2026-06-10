"use client";

import { Suspense, useEffect, useState } from "react";
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

// ─── Figuras Types ───────────────────────────────────────────────────────────
interface Criterio { id: string; nombre: string; max_pts: number; }
interface Competidor { id: number; nombre: string; club?: string; promedio?: number; }
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
  podio_modo?: "manual" | "automatico";
  finalizado: boolean;
  log: { txt: string; color: string; ts: number }[];
  _categoria?: string;
  _tatami_activo?: boolean;
  _nombre_categoria?: string;
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

const JUECES_FIGURAS = ["j1", "j2", "j3", "j4", "j5", "j6", "j7"];

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
function CronoDisplay({ segundos, activo, segundosMax, big = false }: {
  segundos: number; activo: boolean; segundosMax: number; big?: boolean;
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
  state, enviarEvento, tatamiId,
}: {
  state: FigurasState;
  enviarEvento: (accion: string, datos?: Record<string, unknown>) => void;
  tatamiId: string;
}) {
  const [newComp, setNewComp] = useState({ nombre: "", club: "" });
  const [showAddComp, setShowAddComp] = useState(false);

  function calcTotal(comp: Competidor) {
    const puntajes = state.puntuaciones[String(comp.id)] || {};
    let total = 0;
    Object.values(puntajes).forEach((val) => {
      total += val || 0;
    });
    return total;
  }

  const ranking = [...state.competidores]
    .map((c) => ({ ...c, total: calcTotal(c) }))
    .sort((a, b) => b.total - a.total);

  const MAX_COMPETIDORES = 50;
  const puedeAgregar = state.competidores.length < MAX_COMPETIDORES;
  const podioModo = state.podio_modo || "manual";
  const puntuacionesCompletas = figurasPuntuacionesCompletas(state);

  return (
    <div style={{ padding: 16, maxWidth: 800, margin: "0 auto" }}>
      <div className="card-title" style={{ fontSize: "1rem", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>
          <input
            className="input"
            value={state.nombre_categoria || "Figuras"}
            onChange={(e) => enviarEvento("cambiar_nombre_categoria", { nombre: e.target.value })}
            onBlur={(e) => {
              if (!e.target.value.trim()) enviarEvento("cambiar_nombre_categoria", { nombre: "Figuras" });
            }}
            style={{ width: 180, fontWeight: 800, padding: "2px 6px", height: 28 }}
          /> — Juez Central · Tatami {tatamiId}
        </span>
        {state.puntuacion_abierta && state.competidor_activo_id && (
          <button className="btn btn-sm btn-danger" onClick={() => enviarEvento("cerrar_puntuacion")}>
            Cerrar Puntuación
          </button>
        )}
      </div>

      {/* Número de jueces */}
      <div className="card" style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", flexWrap: "wrap" }}>
        <span style={{ color: "var(--text-muted)", fontSize: "0.82rem", fontWeight: 700 }}>Jueces:</span>
        {[2, 3, 4, 5, 6, 7].map((n) => (
          <button key={n} className="btn btn-sm"
            onClick={() => enviarEvento("set_num_jueces", { num_jueces: n })}
            style={{
              background: state.num_jueces === n ? "var(--gold-bg)" : undefined,
              borderColor: state.num_jueces === n ? "var(--gold-border)" : undefined,
              color: state.num_jueces === n ? "var(--gold)" : undefined,
              padding: "4px 12px", minHeight: 32,
            }}>
            {n}
          </button>
        ))}
      </div>

      {/* Podio */}
      <div className="card" style={{ marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 14px", flexWrap: "wrap" }}>
        <div>
          <div style={{ color: "var(--text-muted)", fontSize: "0.78rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em" }}>Podio</div>
          <div style={{ color: puntuacionesCompletas ? "var(--green)" : "var(--text-dim)", fontSize: "0.78rem", marginTop: 2 }}>
            {puntuacionesCompletas ? "Puntuaciones completas" : "Puntuaciones pendientes"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {(["manual", "automatico"] as const).map((modo) => (
            <button
              key={modo}
              className="btn btn-sm"
              onClick={() => enviarEvento("set_podio_modo", { modo })}
              style={{
                background: podioModo === modo ? "var(--gold-bg)" : undefined,
                borderColor: podioModo === modo ? "var(--gold-border)" : undefined,
                color: podioModo === modo ? "var(--gold)" : undefined,
                padding: "4px 10px",
              }}
            >
              {modo === "manual" ? "Manual" : "Automático"}
            </button>
          ))}
        </div>
      </div>

      {/* Competidores */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>
            Competidores ({state.competidores.length}/{MAX_COMPETIDORES})
          </div>
          <button className="btn btn-sm btn-primary"
            onClick={() => setShowAddComp(!showAddComp)}
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
          <div className="animate-fade" style={{ marginBottom: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input className="input" placeholder="Nombre del competidor" value={newComp.nombre}
              onChange={(e) => setNewComp((v) => ({ ...v, nombre: e.target.value }))}
              style={{ flex: "2 1 180px" }} />
            <input className="input" placeholder="Club / Equipo (opc.)" value={newComp.club}
              onChange={(e) => setNewComp((v) => ({ ...v, club: e.target.value }))}
              style={{ flex: "1 1 140px" }} />
            <button className="btn btn-primary"
              onClick={() => {
                if (newComp.nombre.trim()) {
                  enviarEvento("agregar_competidor", { nombre: newComp.nombre.trim(), club: newComp.club.trim() });
                  setNewComp({ nombre: "", club: "" });
                  setShowAddComp(false);
                }
              }}>
              Agregar
            </button>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {ranking.map((comp, i) => {
            const isActive = state.competidor_activo_id === comp.id;
            return (
              <div key={comp.id} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "8px 12px",
                background: isActive ? "rgba(240,184,0,0.1)" : (i === 0 ? "rgba(240,184,0,0.04)" : "var(--bg-elevated)"),
                borderRadius: "var(--radius-sm)",
                border: `1.5px solid ${isActive ? "var(--gold)" : (i === 0 ? "var(--gold-border)" : "var(--border)")}`,
              }}>
                <span style={{
                  fontFamily: "var(--font-display)", fontSize: "1.5rem", minWidth: 32, textAlign: "center",
                  color: i === 0 ? "var(--gold)" : i === 1 ? "#C0C0C0" : i === 2 ? "#CD7F32" : "var(--text-dim)",
                }}>{i + 1}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, color: isActive ? "var(--gold)" : "inherit" }}>
                    {comp.nombre}
                    {isActive && <span style={{ marginLeft: 8, fontSize: "0.7rem", background: "var(--gold)", color: "#000", padding: "2px 6px", borderRadius: 4 }}>EN TURNO</span>}
                  </div>
                  {comp.club && <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{comp.club}</div>}
                </div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: "1.8rem", color: i === 0 || isActive ? "var(--gold)" : "var(--text)" }}>
                  {comp.total.toFixed(2)}
                </div>
                {!isActive && (
                  <button className="btn btn-sm"
                    onClick={() => enviarEvento("activar_competidor", { competidor_id: comp.id })}
                    style={{ padding: "4px 8px", fontSize: "0.7rem", background: "var(--bg-card)", borderColor: "var(--gold)" }}>
                    ACTIVAR
                  </button>
                )}
                <button className="btn btn-sm btn-danger"
                  onClick={() => enviarEvento("eliminar_competidor", { competidor_id: comp.id })}
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

      {/* Acciones */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <button className="btn btn-primary"
          onClick={() => enviarEvento("finalizar")}>
          {state.finalizado ? "Podio Mostrado" : "Mostrar Podio"}
        </button>
        <button className="btn btn-danger"
          onClick={() => enviarEvento("reset_figuras")}>
          Resetear
        </button>
      </div>

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
    const formatted = normalizeScoreInput(nota);
    if (!formatted || !isValidScore(formatted)) {
      setError("Ingresa la puntuación con dos decimales, por ejemplo 8.75.");
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
          inputMode="decimal"
          placeholder="0.00"
          value={nota}
          disabled={isConfirmed}
          onChange={(e) => {
            const next = e.target.value.replace(",", ".");
            if (/^\d?(\.\d{0,2})?$/.test(next)) {
              setNota(next);
              setError("");
            }
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
  const MAP_JUEZ = { j1: 0, j2: 1, j3: 2, j4: 3, j5: 4, j6: 5, j7: 6 };
  const idxCriterio = MAP_JUEZ[juezId as keyof typeof MAP_JUEZ];
  const miCriterio = idxCriterio !== undefined ? state.criterios[idxCriterio] : undefined;

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
  function calcTotal(comp: Competidor) {
    const puntajes = state.puntuaciones[String(comp.id)] || {};
    let total = 0;
    Object.values(puntajes).forEach((val) => { total += val || 0; });
    return total;
  }

  const ranking = [...state.competidores]
    .map((c) => ({ ...c, total: calcTotal(c) }))
    .sort((a, b) => b.total - a.total);
  const nombreCategoria = state._nombre_categoria || state.nombre_categoria || "Figuras";
  const shouldShowPodio = state.finalizado || ((state.podio_modo || "manual") === "automatico" && figurasPuntuacionesCompletas(state));
  const activeComp = state.competidores.find((c) => c.id === state.competidor_activo_id);

  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{
        textAlign: "center", padding: "14px 20px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-card)",
      }}>
        <div className="logo" style={{ fontSize: "2rem" }}>DINA<em>MYT</em></div>
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
          <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", color: "var(--text-muted)" }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: "clamp(2rem,5vw,4rem)", color: "var(--gold)", letterSpacing: "0.08em" }}>
              Puntuaciones en curso
            </div>
            {activeComp && (
              <div style={{ marginTop: 18 }}>
                <div style={{ fontSize: "0.9rem", textTransform: "uppercase", letterSpacing: "0.16em", color: "var(--text-dim)", fontWeight: 800 }}>
                  En turno
                </div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: "clamp(2.5rem,6vw,5rem)", color: "var(--text)", lineHeight: 1.05 }}>
                  {activeComp.nombre}
                </div>
                {activeComp.club && <div style={{ marginTop: 6, color: "var(--text-muted)" }}>{activeComp.club}</div>}
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 960, margin: "0 auto" }}>
            {ranking.map((comp, i) => {
              const isActive = state.competidor_activo_id === comp.id;
              return (
                <div key={comp.id} className="animate-fade" style={{
                  display: "flex", alignItems: "center", gap: 16,
                  padding: "16px 24px",
                  background: isActive ? "rgba(240,184,0,0.12)" : (i === 0 ? "rgba(240,184,0,0.08)" : "var(--bg-card)"),
                  border: `1.5px solid ${isActive ? "var(--gold)" : (i === 0 ? "var(--gold-border)" : "var(--border)")}`,
                  borderRadius: "var(--radius)",
                  boxShadow: i === 0 || isActive ? "var(--shadow-gold)" : undefined,
                }}>
                  <span style={{
                    fontFamily: "var(--font-display)", fontSize: "clamp(3rem,6vw,5rem)",
                    color: i === 0 ? "var(--gold)" : i === 1 ? "#C0C0C0" : i === 2 ? "#CD7F32" : "var(--text-dim)",
                    minWidth: 80, textAlign: "center", lineHeight: 1,
                  }}>{i + 1}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{
                      fontFamily: "var(--font-display)",
                      fontSize: "clamp(2rem,4vw,3.5rem)",
                      letterSpacing: "0.04em", lineHeight: 1,
                      color: isActive ? "var(--gold)" : (i === 0 ? "var(--gold)" : "var(--text)"),
                    }}>
                      {comp.nombre}
                    </div>
                    {comp.club && <div style={{ fontSize: "0.9rem", color: "var(--text-muted)", marginTop: 2 }}>{comp.club}</div>}
                  </div>
                  <div style={{
                    fontFamily: "var(--font-display)",
                    fontSize: "clamp(3rem,5vw,5rem)",
                    color: i === 0 || isActive ? "var(--gold)" : "var(--text)",
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
        <span className="logo" style={{ fontSize: "1.1rem" }}>DINA<em>MYT</em></span>
        <span>Tatami {tatamiId}</span>
        <span>
          <span className={`status-dot ${connected ? "online" : "offline"}`} />
          {connected ? "En vivo" : "Desconectado"}
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
  const cronoClass = !state.activo ? "pause"
    : state.segundos <= 5 ? "urgente-5"
    : state.segundos <= 10 ? "urgente"
    : "activo";

  const PUNTOS = [
    { pts: 1, label: "CUERPO" },
    { pts: 2, label: "GIRO / PAT. CABEZA" },
    { pts: 3, label: "GIRO CABEZA" },
  ];

  function anotar(color: "hong" | "chung", pts: number, label: string) {
    onFlash(color === "hong" ? "🔴" : "🔵", `+${pts} JEUMSU`);
    enviarEvento("punto_juez", { juez: rol, color, pts, nombre: label });
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
              style={{ flex: 1, opacity: state.oroResuelto ? 0.5 : 1 }}
              onClick={() => anotar("hong", p.pts, p.label)}
              disabled={state.oroResuelto}
            >
              <span className="pts">+{p.pts}</span>
              <span className="label">{p.label}</span>
            </button>
          ))}
          <button
            className="btn btn-danger"
            style={{ marginTop: 4, padding: "10px 6px", fontSize: "0.82rem", opacity: state.oroResuelto ? 0.5 : 1 }}
            disabled={state.oroResuelto}
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
              style={{ flex: 1, opacity: state.oroResuelto ? 0.5 : 1 }}
              onClick={() => anotar("chung", p.pts, p.label)}
              disabled={state.oroResuelto}
            >
              <span className="pts">+{p.pts}</span>
              <span className="label">{p.label}</span>
            </button>
          ))}
          <button
            className="btn btn-danger"
            style={{ marginTop: 4, padding: "10px 6px", fontSize: "0.82rem", opacity: state.oroResuelto ? 0.5 : 1 }}
            disabled={state.oroResuelto}
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
  state, enviarEvento, tatamiId,
  onFlash, onFaltaFlash, onShowConfirm, broadcast
}: {
  state: CombateState;
  enviarEvento: (accion: string, datos?: Record<string, unknown>) => void;
  tatamiId: string;
  onFlash: (ico: string, txt: string) => void;
  onFaltaFlash: (data: FaltaFlashData) => void;
  onShowConfirm: (data: import("@/components/AlertSystem").ConfirmData) => void;
  broadcast: (data: Record<string, unknown>) => void;
}) {
  const totalHong = marcadorDisplay(state, "hong");
  const totalChung = marcadorDisplay(state, "chung");
  const esqHong = promedioEsquinas(state, "hong").toFixed(1);
  const esqChung = promedioEsquinas(state, "chung").toFixed(1);

  const cronoClass = !state.activo ? "pause"
    : state.segundos <= 5 ? "urgente-5"
    : state.segundos <= 10 ? "urgente"
    : "activo";

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
    const nombresVacios = state.nombreHong === "Hong" || state.nombreChung === "Chung"
      || !state.nombreHong.trim() || !state.nombreChung.trim();
    if (nombresVacios) {
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
              style={{
                padding: "5px 10px", fontWeight: 800,
                background: state.activo ? "rgba(255,68,68,0.15)" : "rgba(0,212,114,0.15)",
                borderColor: state.activo ? "rgba(255,68,68,0.4)" : "rgba(0,212,114,0.4)",
                color: state.activo ? "var(--red-alert)" : "var(--green)",
              }}>
              {state.activo ? "PAUSA" : "PLAY"}
            </button>
            <button className="btn btn-sm"
              onClick={() => enviarEvento("crono_reset", { segundosMax: state.segundosMax })}
              style={{ padding: "5px 8px" }}>RST</button>
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
            style={{
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
            style={{
              background: state.segundosMax === d ? "var(--chung-bg)" : undefined,
              borderColor: state.segundosMax === d ? "var(--chung-border)" : undefined,
            }}>{d}s</button>
        ))}
        <span style={{ color: "var(--border-light)", alignSelf: "center", fontSize: "1.2rem" }}>|</span>
        <span style={{ color: "var(--text-muted)", fontSize: "0.78rem", alignSelf: "center", fontWeight: 700 }}>Jueces:</span>
        {[2, 3, 4].map((n) => (
          <button key={n} className="btn btn-sm"
            onClick={() => enviarEvento("set_num_jueces", { numJueces: n })}
            style={{
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
              disabled={state.oroResuelto}
              style={{ opacity: state.oroResuelto ? 0.5 : 1 }}
            >
              <span className="pts">+{p.pts}</span>
              <span className="label">{p.nombre}</span>
            </button>
            <button
              className="combat-btn chung"
              onClick={() => handleEspecial("chung", p.pts, p.nombre)}
              disabled={state.oroResuelto}
              style={{ opacity: state.oroResuelto ? 0.5 : 1 }}
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
        <button className="combat-btn hong" onClick={() => handleKyonggo("hong")}>
          <span className="pts">−0.5</span><span className="label">KyongGo HONG</span>
        </button>
        <button className="combat-btn chung" onClick={() => handleKyonggo("chung")}>
          <span className="pts">−0.5</span><span className="label">KyongGo CHUNG</span>
        </button>
        <button className="combat-btn falta" onClick={() => handleGamjeum("hong")}>
          <span className="pts">−1</span><span className="label">GamJeum HONG</span>
        </button>
        <button className="combat-btn falta" onClick={() => handleGamjeum("chung")}>
          <span className="pts">−1</span><span className="label">GamJeum CHUNG</span>
        </button>
      </div>

      {/* Deshacer + Guardar */}
      <div className="grid-2" style={{ marginBottom: 8 }}>
        <button className="btn btn-sm btn-danger"
          onClick={() => enviarEvento("deshacer_arbitro", { color: "hong" })}>
          ↩ Deshacer Hong
        </button>
        <button className="btn btn-sm btn-danger"
          onClick={() => enviarEvento("deshacer_arbitro", { color: "chung" })}>
          ↩ Deshacer Chung
        </button>
      </div>

      <div className="grid-2" style={{ marginBottom: 10 }}>
        <button className="btn btn-primary" onClick={handleNuevoCombate}>
          Guardar + Nuevo
        </button>
        <button className="btn btn-danger" onClick={handleReset}>
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
  const { state, connected, hasServerState, pendingEvents, enviarEvento, broadcast, alerts: socketAlerts, clearAlert } = useCombate(tatamiId, rol, token);

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

  const anyState = state as unknown as AnyState;
  const categoria = anyState._categoria || "combate";
  const esFiguras = isFiguras(anyState);
  const nombreCategoria = anyState._nombre_categoria || (isFiguras(anyState) ? anyState.nombre_categoria : "") || "Figuras";

  const isArbitro = rol === "arbitro";
  const isPantalla = rol === "pantalla";

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
    return JSON.parse(user).rol === "admin" ? "/admin" : "/juez";
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

  if (!hasServerState) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100dvh" }}>
        <div className="logo animate-fade" style={{ fontSize: "3rem" }}>DINA<em>MYT</em></div>
      </div>
    );
  }

  // Pantalla pública — sin auth, renderizar inmediatamente
  if (isPantalla) {
    if (anyState._tatami_activo === false) {
      return (
        <div style={{ height: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <div className="logo" style={{ fontSize: "4rem", marginBottom: 16 }}>DINA<em>MYT</em></div>
          <div style={{ fontSize: "2.5rem", color: "var(--text-dim)", fontFamily: "var(--font-display)", letterSpacing: "0.15em", marginBottom: 8 }}>
            TATAMI {tatamiId}
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
          onClearGanador={alertSystem.clearGanador}
          onClearAlerta12={alertSystem.clearAlerta12}
          onClearDerrota={alertSystem.clearDerrota}
          onClearConfirm={alertSystem.clearConfirm}
          isPantalla
        />
        {esFiguras
          ? <FigurasPantalla state={anyState as FigurasState} tatamiId={tatamiId} />
          : <CombatePantalla
              state={state}
              tatamiId={tatamiId}
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
        onClearGanador={alertSystem.clearGanador}
        onClearAlerta12={alertSystem.clearAlerta12}
        onClearDerrota={alertSystem.clearDerrota}
        onClearConfirm={alertSystem.clearConfirm}
      />

      {/* Top bar */}
      <div style={{
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
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className={`status-dot ${connected ? "online" : "offline"}`} />
          <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>T{tatamiId}</span>
          {isArbitro && <CatSelector current={categoria} onSelect={handleChangeCategoria} figurasLabel={nombreCategoria} />}
          {!isArbitro && (
            <span style={{ fontSize: "0.72rem", color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
              {categoria} · {rol.toUpperCase()}
            </span>
          )}
        </div>

        {/* Right: rol label + tatami activo */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {isArbitro && (
            <button
              className={`btn btn-sm ${anyState._tatami_activo ? "btn-primary" : "btn-danger"}`}
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
              style={{ fontWeight: 800, padding: "4px 10px", fontSize: "0.7rem", height: 28 }}
            >
              {anyState._tatami_activo ? "🟢 ACTIVO" : "🔴 DESACTIVADO"}
            </button>
          )}
          <span style={{ fontSize: "0.72rem", color: "var(--text-dim)" }}>
            {isArbitro ? "Juez Central" : rol.toUpperCase()}
          </span>
        </div>
      </div>

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
            ? <FigurasArbitro state={anyState as FigurasState} enviarEvento={enviarEvento} tatamiId={tatamiId} />
            : <FigurasJuez state={anyState as FigurasState} enviarEvento={enviarEvento} juezId={rol} />
        ) : (
          isArbitro
            ? <CombateArbitro
                state={state}
                enviarEvento={enviarEvento}
                tatamiId={tatamiId}
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
        <div className="logo animate-fade" style={{ fontSize: "3rem" }}>DINA<em>MYT</em></div>
      </div>
    }>
      <TatamiContent />
    </Suspense>
  );
}
