"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CATEGORIAS_FIGURAS, CATEGORIA_NOMBRE_MAX, normalizarCategoria } from "@/lib/categorias";
import {
  estadoInicialTablero,
  cargarTablero,
  publicarTablero,
  cargarHistorial,
  guardarHistorial,
  rankingTablero,
  ganadorCombate,
  totalCompetidor,
  DURACIONES,
  type TableroState,
  type HistorialItem,
} from "@/lib/tablero";

const OTRA = "__otra__";

function mmss(seg: number) {
  const m = Math.floor(seg / 60);
  const s = seg % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function parseNota(raw: string): number | null {
  const v = raw.trim().replace(",", ".");
  if (v === "") return null;
  const n = parseFloat(v);
  if (Number.isNaN(n)) return null;
  return Math.round(Math.min(9.99, Math.max(0, n)) * 100) / 100;
}

export default function TableroControl() {
  const [state, setState] = useState<TableroState>(() => estadoInicialTablero());
  const [historial, setHistorial] = useState<HistorialItem[]>([]);
  const [compNombre, setCompNombre] = useState("");
  const [compClub, setCompClub] = useState("");
  const [proyectada, setProyectada] = useState(false);
  const stateRef = useRef(state);
  const ventanaRef = useRef<Window | null>(null);

  useEffect(() => {
    // Carga inicial desde localStorage (no se puede en el initializer por SSR).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(cargarTablero());
    setHistorial(cargarHistorial());
  }, []);

  useEffect(() => { stateRef.current = state; }, [state]);

  const aplicar = useCallback((next: TableroState) => {
    setState(publicarTablero(next));
  }, []);

  const update = useCallback((patch: (s: TableroState) => TableroState) => {
    aplicar(patch(stateRef.current));
  }, [aplicar]);

  // Cronómetro local (solo en la ventana de control; la proyección solo muestra)
  useEffect(() => {
    if (!state.combate.activo) return;
    const id = setInterval(() => {
      const prev = stateRef.current;
      const seg = prev.combate.segundos;
      aplicar({
        ...prev,
        combate: { ...prev.combate, segundos: Math.max(0, seg - 1), activo: seg > 1 },
      });
    }, 1000);
    return () => clearInterval(id);
  }, [state.combate.activo, aplicar]);

  function proyectar() {
    const w = window.open("/tablero/pantalla", "dinamyt_pantalla", "width=1280,height=720");
    ventanaRef.current = w;
    setProyectada(Boolean(w));
    // La ventana lee localStorage al montar; re-publicamos por si acaso.
    setTimeout(() => publicarTablero(stateRef.current), 500);
  }

  const fig = state.figuras;
  const ranking = rankingTablero(fig);
  const selCategoria = (CATEGORIAS_FIGURAS as readonly string[]).includes(fig.categoria) ? fig.categoria : OTRA;

  function setFig(patch: Partial<TableroState["figuras"]>) {
    update((s) => ({ ...s, figuras: { ...s.figuras, ...patch } }));
  }
  function setComb(patch: Partial<TableroState["combate"]>) {
    update((s) => ({ ...s, combate: { ...s.combate, ...patch } }));
  }

  function ajustarNotas(notas: (number | null)[], n: number) {
    const out = notas.slice(0, n);
    while (out.length < n) out.push(null);
    return out;
  }

  function agregarCompetidor() {
    const nombre = compNombre.trim();
    if (!nombre) return;
    update((s) => {
      const id = s.figuras.competidores.reduce((m, c) => Math.max(m, c.id), 0) + 1;
      return {
        ...s,
        figuras: {
          ...s.figuras,
          finalizado: false,
          competidores: [
            ...s.figuras.competidores,
            { id, nombre, club: compClub.trim(), notas: Array(s.figuras.numJueces).fill(null) },
          ],
        },
      };
    });
    setCompNombre("");
    setCompClub("");
  }

  function quitarCompetidor(id: number) {
    update((s) => ({
      ...s,
      figuras: { ...s.figuras, competidores: s.figuras.competidores.filter((c) => c.id !== id) },
    }));
  }

  function setNota(compId: number, j: number, valor: number | null) {
    update((s) => ({
      ...s,
      figuras: {
        ...s.figuras,
        competidores: s.figuras.competidores.map((c) =>
          c.id === compId ? { ...c, notas: c.notas.map((v, i) => (i === j ? valor : v)) } : c
        ),
      },
    }));
  }

  function guardarFiguras() {
    if (ranking.length === 0) return;
    const item: HistorialItem = {
      tipo: "figuras",
      // eslint-disable-next-line react-hooks/purity -- handler de clic, no render
      ts: Date.now(),
      categoria: fig.categoria,
      descripcion: fig.descripcion,
      ranking: ranking.map((r) => ({
        puesto: r.puesto, nombre: r.nombre, club: r.club, total: r.total, empate: r.empate,
      })),
    };
    const next = [item, ...historial];
    setHistorial(next);
    guardarHistorial(next);
    // Nueva categoría (conserva número de jueces)
    setFig({ categoria: fig.categoria, descripcion: "", competidores: [], finalizado: false });
  }

  function guardarCombate() {
    const c = state.combate;
    if (c.puntosHong === null && c.puntosChung === null) return;
    const item: HistorialItem = {
      tipo: "combate",
      ts: Date.now(),
      nombreHong: c.nombreHong || "Hong",
      nombreChung: c.nombreChung || "Chung",
      puntosHong: c.puntosHong ?? 0,
      puntosChung: c.puntosChung ?? 0,
      ganador: ganadorCombate(c),
    };
    const next = [item, ...historial];
    setHistorial(next);
    guardarHistorial(next);
    setComb({
      nombreHong: "", nombreChung: "", segundos: c.duracionSeg, activo: false,
      puntosHong: null, puntosChung: null, finalizado: false,
    });
  }

  function borrarHistorial(ts: number) {
    const next = historial.filter((h) => h.ts !== ts);
    setHistorial(next);
    guardarHistorial(next);
  }

  return (
    <div className="tablero-page">
      {/* Cabecera */}
      <div className="tablero-head">
        <div style={{ minWidth: 0 }}>
          <Link href="/" className="btn btn-sm btn-ghost" style={{ marginBottom: 8, display: "inline-flex" }}>← Inicio</Link>
          <h1 style={{ fontSize: "1.4rem", fontWeight: 800, display: "flex", alignItems: "center", gap: 8 }}>
            Tablero local <span className="badge badge-gray">offline</span>
          </h1>
          <p className="text-muted" style={{ fontSize: "0.84rem" }}>
            Ingresa las puntuaciones a mano y proyéctalas al TV por HDMI. Funciona sin
            internet; los resultados quedan en el historial local de este equipo.
          </p>
        </div>
        <button className="btn btn-primary" onClick={proyectar}>
          🖥️ {proyectada ? "Reabrir proyección" : "Proyectar pantalla"}
        </button>
      </div>

      {/* Campeonato + tatami (rótulos para la pantalla pública) */}
      <div className="card" style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: 12 }}>
        <input className="input" placeholder="Campeonato (rótulo, opc.)" value={state.campeonato}
          maxLength={80} onChange={(e) => update((s) => ({ ...s, campeonato: e.target.value }))}
          style={{ flex: "2 1 220px" }} />
        <input className="input" placeholder="Tatami / sede (rótulo, opc.)" value={state.tatami}
          maxLength={40} onChange={(e) => update((s) => ({ ...s, tatami: e.target.value }))}
          style={{ flex: "1 1 140px" }} />
      </div>

      {/* Selector de modo */}
      <div className="seg" role="tablist" aria-label="Modo">
        {(["figuras", "combate"] as const).map((m) => (
          <button key={m} type="button" role="tab"
            className={`seg-btn ${state.modo === m ? "seg-on" : ""}`}
            aria-selected={state.modo === m}
            onClick={() => update((s) => ({ ...s, modo: m }))}
            style={{ flex: 1 }}>
            {m === "figuras" ? "🥋 Figuras" : "⚔️ Combate"}
          </button>
        ))}
      </div>

      {state.modo === "figuras" ? (
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Categoría + descripción + jueces */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select className="input" value={selCategoria} style={{ flex: "2 1 220px" }}
              onChange={(e) => setFig({ categoria: e.target.value === OTRA ? "" : e.target.value })}>
              {CATEGORIAS_FIGURAS.map((c) => <option key={c} value={c}>{c}</option>)}
              <option value={OTRA}>Otra categoría…</option>
            </select>
            <select className="input" value={fig.numJueces} style={{ flex: "1 1 120px" }}
              onChange={(e) => {
                const n = Number(e.target.value);
                update((s) => ({
                  ...s,
                  figuras: {
                    ...s.figuras, numJueces: n,
                    competidores: s.figuras.competidores.map((c) => ({ ...c, notas: ajustarNotas(c.notas, n) })),
                  },
                }));
              }}>
              {[2, 3, 4].map((n) => <option key={n} value={n}>{n} jueces</option>)}
            </select>
          </div>
          {selCategoria === OTRA && (
            <input className="input" placeholder="Escribe la categoría (solo letras)" value={fig.categoria}
              maxLength={CATEGORIA_NOMBRE_MAX} style={{ textTransform: "uppercase" }}
              onChange={(e) => setFig({ categoria: normalizarCategoria(e.target.value) })} />
          )}
          <input className="input" placeholder="Descripción pública (opc.) — ej: Intermedios 15-17 años"
            value={fig.descripcion} maxLength={120}
            onChange={(e) => setFig({ descripcion: e.target.value })} />

          {/* Alta de competidores */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input className="input" placeholder="Nombre del competidor" value={compNombre}
              onChange={(e) => setCompNombre(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); agregarCompetidor(); } }}
              style={{ flex: "2 1 180px" }} />
            <input className="input" placeholder="Club (opc.)" value={compClub}
              onChange={(e) => setCompClub(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); agregarCompetidor(); } }}
              style={{ flex: "1 1 120px" }} />
            <button className="btn btn-primary" onClick={agregarCompetidor} disabled={!compNombre.trim()}>
              + Agregar
            </button>
          </div>

          {/* Tabla de notas */}
          {ranking.length === 0 ? (
            <p className="text-dim" style={{ fontSize: "0.85rem", textAlign: "center", padding: 12 }}>
              Agrega competidores y escribe la nota de cada juez. El podio se calcula solo.
            </p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="table" style={{ minWidth: 480 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>Competidor</th>
                    {Array.from({ length: fig.numJueces }, (_, j) => <th key={j}>J{j + 1}</th>)}
                    <th>Total</th>
                    <th>Puesto</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {fig.competidores.map((c) => {
                    const r = ranking.find((x) => x.id === c.id);
                    return (
                      <tr key={c.id}>
                        <td style={{ fontWeight: 700 }}>
                          {c.nombre}
                          {c.club && <span className="text-muted" style={{ marginLeft: 6, fontSize: "0.78rem", fontWeight: 500 }}>{c.club}</span>}
                        </td>
                        {Array.from({ length: fig.numJueces }, (_, j) => (
                          <td key={j} style={{ textAlign: "center" }}>
                            <input
                              className="input"
                              inputMode="decimal"
                              value={c.notas[j] === null || c.notas[j] === undefined ? "" : String(c.notas[j])}
                              placeholder="0.00"
                              onChange={(e) => setNota(c.id, j, parseNota(e.target.value))}
                              style={{ width: 64, textAlign: "center", padding: "6px 4px" }}
                            />
                          </td>
                        ))}
                        <td style={{ textAlign: "center", fontFamily: "var(--font-mono)", fontWeight: 800, color: "var(--gold)" }}>
                          {totalCompetidor(c, fig.numJueces).toFixed(2)}
                        </td>
                        <td style={{ textAlign: "center", fontWeight: 800 }}>
                          {fig.finalizado ? (r?.puesto === 1 ? "🥇" : r?.puesto === 2 ? "🥈" : r?.puesto === 3 ? "🥉" : `${r?.puesto}°`) : "—"}
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <button className="btn btn-sm btn-danger" onClick={() => quitarCompetidor(c.id)}
                            style={{ padding: "2px 8px", minHeight: 28, fontSize: "0.72rem" }}>✕</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className={`btn ${fig.finalizado ? "" : "btn-primary"}`}
              onClick={() => setFig({ finalizado: !fig.finalizado })}
              disabled={ranking.length === 0}>
              {fig.finalizado ? "✎ Seguir editando" : "🏆 Mostrar podio"}
            </button>
            <button className="btn" onClick={guardarFiguras} disabled={ranking.length === 0}>
              💾 Guardar y nueva categoría
            </button>
          </div>
        </div>
      ) : (
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Nombres + duración */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input className="input" placeholder="Competidor Rojo (Hong)" value={state.combate.nombreHong}
              onChange={(e) => setComb({ nombreHong: e.target.value })} style={{ flex: "1 1 180px" }} />
            <input className="input" placeholder="Competidor Azul (Chung)" value={state.combate.nombreChung}
              onChange={(e) => setComb({ nombreChung: e.target.value })} style={{ flex: "1 1 180px" }} />
            <select className="input" value={state.combate.duracionSeg} style={{ flex: "0 1 120px" }}
              onChange={(e) => {
                const d = Number(e.target.value);
                setComb({ duracionSeg: d, segundos: state.combate.activo ? state.combate.segundos : d });
              }}>
              {DURACIONES.map((d) => <option key={d} value={d}>{d}s</option>)}
            </select>
          </div>

          {/* Cronómetro */}
          <div style={{ textAlign: "center" }}>
            <div style={{
              fontFamily: "var(--font-display)", fontSize: "3.4rem", lineHeight: 1,
              color: state.combate.activo ? "var(--green)" : "var(--text)",
            }}>{mmss(state.combate.segundos)}</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginTop: 8 }}>
              {!state.combate.activo
                ? <button className="btn btn-primary" onClick={() => setComb({ activo: true, finalizado: false })}
                    disabled={state.combate.segundos === 0}>▶ Iniciar</button>
                : <button className="btn" onClick={() => setComb({ activo: false })}>⏸ Pausar</button>}
              <button className="btn" onClick={() => setComb({ activo: false, segundos: state.combate.duracionSeg })}>↺ Reiniciar</button>
            </div>
          </div>

          {/* Puntos totales */}
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "0.7rem", fontWeight: 800, color: "var(--hong-light)", textTransform: "uppercase" }}>
                {state.combate.nombreHong || "Hong"}
              </div>
              <input className="input" inputMode="numeric" placeholder="—"
                value={state.combate.puntosHong ?? ""}
                onChange={(e) => setComb({ puntosHong: e.target.value === "" ? null : Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                style={{ width: 110, textAlign: "center", fontSize: "1.4rem", fontWeight: 800 }} />
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "0.7rem", fontWeight: 800, color: "var(--chung-light)", textTransform: "uppercase" }}>
                {state.combate.nombreChung || "Chung"}
              </div>
              <input className="input" inputMode="numeric" placeholder="—"
                value={state.combate.puntosChung ?? ""}
                onChange={(e) => setComb({ puntosChung: e.target.value === "" ? null : Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                style={{ width: 110, textAlign: "center", fontSize: "1.4rem", fontWeight: 800 }} />
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className={`btn ${state.combate.finalizado ? "" : "btn-primary"}`}
              onClick={() => setComb({ finalizado: !state.combate.finalizado, activo: false })}
              disabled={state.combate.puntosHong === null && state.combate.puntosChung === null}>
              {state.combate.finalizado ? "✎ Seguir editando" : "🏆 Mostrar ganador"}
            </button>
            <button className="btn" onClick={guardarCombate}
              disabled={state.combate.puntosHong === null && state.combate.puntosChung === null}>
              💾 Guardar y nuevo
            </button>
          </div>
        </div>
      )}

      {/* Historial local */}
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div className="card-title" style={{ marginBottom: 0 }}>
          Historial local ({historial.length})
        </div>
        {historial.length === 0 ? (
          <p className="text-dim" style={{ fontSize: "0.82rem" }}>
            Lo que guardes aparece aquí. Queda en este equipo para que la mesa lo
            registre en el sistema cuando vuelva el internet.
          </p>
        ) : (
          historial.map((h) => (
            <div key={h.ts} style={{
              display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10,
              padding: "8px 12px", background: "var(--bg-elevated)",
              border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
            }}>
              <div style={{ minWidth: 0 }}>
                {h.tipo === "figuras" ? (
                  <>
                    <div style={{ fontWeight: 800, fontSize: "0.85rem" }}>
                      🥋 {h.categoria}
                      {h.descripcion && <span className="text-muted" style={{ fontWeight: 500, marginLeft: 6, fontSize: "0.78rem" }}>{h.descripcion}</span>}
                    </div>
                    <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: 2 }}>
                      {h.ranking.slice(0, 3).map((r) => `${r.puesto}° ${r.nombre} (${r.total.toFixed(2)})`).join(" · ")}
                    </div>
                  </>
                ) : (
                  <div style={{ fontWeight: 800, fontSize: "0.85rem" }}>
                    ⚔️ {h.nombreHong} {h.puntosHong} — {h.puntosChung} {h.nombreChung}
                    <span className="badge badge-gold" style={{ marginLeft: 8 }}>
                      {h.ganador === "empate" ? "Empate" : `Gana ${h.ganador === "hong" ? h.nombreHong : h.nombreChung}`}
                    </span>
                  </div>
                )}
                <div style={{ fontSize: "0.7rem", color: "var(--text-dim)", marginTop: 2 }}>
                  {new Date(h.ts).toLocaleString("es-CO", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
              <button className="btn btn-sm btn-danger" onClick={() => borrarHistorial(h.ts)}
                style={{ padding: "2px 8px", minHeight: 28, fontSize: "0.72rem" }}>✕</button>
            </div>
          ))
        )}
      </div>

      <style>{`
        .tablero-page { max-width: 900px; margin: 0 auto; padding: 20px; display: flex; flex-direction: column; gap: 14px; }
        .tablero-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
        .seg { display: inline-flex; width: 100%; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 3px; gap: 2px; }
        .seg-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 8px 12px; min-height: 38px; border: none; cursor: pointer; background: transparent; color: var(--text-muted); font: inherit; font-weight: 700; border-radius: calc(var(--radius-sm) - 2px); transition: all 0.15s; }
        .seg-btn.seg-on { background: var(--gold); color: var(--text-on-gold, #1a1a1a); }
        @media (max-width: 560px) { .tablero-page { padding: 14px; } .tablero-head button { width: 100%; } }
      `}</style>
    </div>
  );
}
