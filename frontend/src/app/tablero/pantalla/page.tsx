"use client";

import { useEffect, useState } from "react";
import Logo from "@/components/Logo";
import {
  cargarTablero,
  suscribirTablero,
  rankingTablero,
  ganadorCombate,
  type TableroState,
} from "@/lib/tablero";

function mmss(seg: number) {
  const m = Math.floor(seg / 60);
  const s = seg % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function TableroPantalla() {
  const [state, setState] = useState<TableroState | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(cargarTablero());
    return suscribirTablero(setState);
  }, []);

  if (!state) return null;

  return (
    <div style={{
      height: "100dvh", display: "flex", flexDirection: "column",
      overflow: "hidden", background: "var(--bg)",
    }}>
      {/* Cabecera común */}
      <div style={{
        textAlign: "center", padding: "16px 24px",
        borderBottom: "1px solid var(--border)", background: "var(--bg-card)",
      }}>
        <Logo fontSize="clamp(1.4rem, 3.5vw, 2rem)" />
        {state.campeonato && (
          <div style={{
            fontSize: "clamp(0.8rem, 1.6vw, 1rem)", color: "var(--text-muted)",
            fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", marginTop: 4,
          }}>{state.campeonato}</div>
        )}
        {state.tatami && (
          <div style={{
            fontFamily: "var(--font-display)", fontSize: "clamp(1.6rem, 4vw, 3rem)",
            color: "var(--gold)", letterSpacing: "0.15em", lineHeight: 1, marginTop: 6,
          }}>{state.tatami}</div>
        )}
      </div>

      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {state.modo === "figuras"
          ? <PantallaFiguras state={state} />
          : <PantallaCombate state={state} />}
      </div>
    </div>
  );
}

function PantallaFiguras({ state }: { state: TableroState }) {
  const fig = state.figuras;
  const ranking = rankingTablero(fig);
  const medalla = (p: number) => (p === 1 ? "🥇" : p === 2 ? "🥈" : p === 3 ? "🥉" : `${p}°`);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "16px 24px", overflow: "hidden" }}>
      <div style={{ textAlign: "center", marginBottom: 12 }}>
        <div style={{
          fontFamily: "var(--font-display)", fontSize: "clamp(1.8rem, 4.5vw, 3.2rem)",
          color: "var(--gold)", letterSpacing: "0.1em", lineHeight: 1,
        }}>{fig.categoria || "FIGURAS"}</div>
        {fig.descripcion && (
          <div style={{ fontSize: "clamp(1rem, 2vw, 1.4rem)", color: "var(--text-muted)", fontWeight: 600, marginTop: 6 }}>
            {fig.descripcion}
          </div>
        )}
      </div>

      {ranking.length === 0 ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <p style={{ fontSize: "clamp(1.4rem, 3vw, 2.2rem)", color: "var(--text-dim)" }}>
            Esperando participantes…
          </p>
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "clamp(6px,1.4vh,12px)", maxWidth: 1100, width: "100%", margin: "0 auto" }}>
          {ranking.map((r) => {
            const podio = fig.finalizado && r.puesto <= 3;
            return (
              <div key={r.id} style={{
                display: "flex", alignItems: "center", gap: 16,
                padding: "clamp(8px,1.6vh,16px) clamp(14px,2vw,24px)",
                borderRadius: "var(--radius)",
                background: podio ? "var(--gold-bg)" : "var(--bg-card)",
                border: `2px solid ${podio ? "var(--gold-border)" : "var(--border)"}`,
              }}>
                <span style={{
                  fontFamily: "var(--font-display)", fontSize: "clamp(1.6rem, 3.5vw, 2.8rem)",
                  minWidth: "clamp(48px, 6vw, 80px)", textAlign: "center",
                  color: fig.finalizado ? "var(--gold)" : "var(--text-dim)",
                }}>
                  {fig.finalizado ? medalla(r.puesto) : "—"}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: "clamp(1.2rem, 2.8vw, 2.2rem)", fontWeight: 800, overflowWrap: "anywhere" }}>
                    {r.nombre}
                  </span>
                  {r.club && (
                    <span style={{ color: "var(--text-muted)", fontSize: "clamp(0.8rem,1.6vw,1.1rem)", marginLeft: 12 }}>
                      {r.club}
                    </span>
                  )}
                  {r.empate && fig.finalizado && (
                    <span className="badge badge-gray" style={{ marginLeft: 12 }}>Empate</span>
                  )}
                </span>
                <span style={{
                  fontFamily: "var(--font-display)", fontSize: "clamp(1.6rem, 4vw, 3rem)",
                  color: "var(--gold)", minWidth: "clamp(80px, 10vw, 150px)", textAlign: "right",
                }}>
                  {r.total.toFixed(2)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {fig.finalizado && (
        <div style={{
          textAlign: "center", marginTop: 12, fontFamily: "var(--font-display)",
          fontSize: "clamp(1.2rem, 2.5vw, 1.8rem)", color: "var(--gold)", letterSpacing: "0.2em",
        }}>
          🏆 PODIO FINAL
        </div>
      )}
    </div>
  );
}

function PantallaCombate({ state }: { state: TableroState }) {
  const c = state.combate;
  const ganador = ganadorCombate(c);
  const colorGanador = ganador === "hong" ? "var(--hong-vivid)" : "var(--chung-vivid)";
  const nombreGanador = ganador === "hong" ? c.nombreHong : c.nombreChung;

  if (c.finalizado && ganador !== "empate") {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 24 }}>
        <div style={{ fontSize: "clamp(4rem, 12vh, 9rem)", lineHeight: 1 }}>🏆</div>
        <div style={{
          fontFamily: "var(--font-display)", fontSize: "clamp(2rem,5vw,4rem)",
          letterSpacing: "0.3em", color: "var(--gold)", margin: "8px 0",
        }}>SUNG</div>
        <div style={{
          fontFamily: "var(--font-display)", fontSize: "clamp(3rem,12vw,8rem)",
          lineHeight: 0.95, color: colorGanador, overflowWrap: "anywhere",
        }}>{(nombreGanador || "").toUpperCase()}</div>
        <div style={{ marginTop: 16, fontSize: "clamp(1.4rem,3vw,2.4rem)", color: "var(--text-muted)" }}>
          {c.puntosHong ?? 0} — {c.puntosChung ?? 0}
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: 24 }}>
      {/* Cronómetro */}
      <div style={{ textAlign: "center", marginBottom: "2vh" }}>
        <div style={{
          fontFamily: "var(--font-display)",
          fontSize: "clamp(3rem, 14vh, 9rem)", lineHeight: 1,
          color: c.activo ? "var(--green)" : "var(--text)",
        }}>{mmss(c.segundos)}</div>
      </div>

      {/* Marcador Hong vs Chung */}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: "2vw" }}>
        <Lado nombre={c.nombreHong || "HONG"} puntos={c.puntosHong} color="hong" />
        <div style={{ fontFamily: "var(--font-display)", fontSize: "clamp(1.4rem,4vw,3rem)", color: "var(--text-dim)" }}>VS</div>
        <Lado nombre={c.nombreChung || "CHUNG"} puntos={c.puntosChung} color="chung" />
      </div>

      {c.finalizado && ganador === "empate" && (
        <div style={{ textAlign: "center", fontFamily: "var(--font-display)", fontSize: "clamp(1.4rem,3vw,2.2rem)", color: "var(--gold)", marginTop: "2vh" }}>
          EMPATE
        </div>
      )}
    </div>
  );
}

function Lado({ nombre, puntos, color }: { nombre: string; puntos: number | null; color: "hong" | "chung" }) {
  const vivid = color === "hong" ? "var(--hong-vivid)" : "var(--chung-vivid)";
  const light = color === "hong" ? "var(--hong-light)" : "var(--chung-light)";
  return (
    <div style={{ textAlign: "center", minWidth: 0 }}>
      <div style={{
        fontSize: "clamp(1rem, 2.4vw, 1.8rem)", fontWeight: 800, color: light,
        textTransform: "uppercase", letterSpacing: "0.06em", overflowWrap: "anywhere",
      }}>{nombre}</div>
      <div style={{
        fontFamily: "var(--font-display)", fontSize: "clamp(4rem, 18vh, 13rem)",
        lineHeight: 1, color: vivid,
      }}>{puntos ?? "—"}</div>
    </div>
  );
}
