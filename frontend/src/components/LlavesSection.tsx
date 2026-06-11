"use client";

import { useCallback, useEffect, useState } from "react";
import {
  createLlaveAPI,
  listLlavesAPI,
  listTatamisAPI,
  marcarGanadorLlaveAPI,
  deleteLlaveAPI,
  type LlaveData,
  type LlavePartido,
} from "@/lib/api";

function nombreRonda(idx: number, total: number) {
  const restantes = total - idx;
  if (restantes === 1) return "Final";
  if (restantes === 2) return "Semifinal";
  if (restantes === 3) return "Cuartos";
  if (restantes === 4) return "Octavos";
  return `Ronda ${idx + 1}`;
}

function LadoPartido({
  comp, esGanador, esBye, onClick, disabled,
}: {
  comp: { nombre: string; club?: string } | null;
  esGanador: boolean;
  esBye: boolean;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || !comp}
      title={comp && !disabled ? "Marcar como ganador" : undefined}
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 6, width: "100%", padding: "7px 10px",
        background: esGanador ? "var(--gold-bg)" : "transparent",
        border: "none",
        borderLeft: `3px solid ${esGanador ? "var(--gold)" : "transparent"}`,
        color: comp ? (esGanador ? "var(--gold)" : "var(--text)") : "var(--text-dim)",
        fontFamily: "var(--font-body)", fontSize: "0.85rem",
        fontWeight: esGanador ? 800 : 600,
        cursor: comp && !disabled ? "pointer" : "default",
        textAlign: "left",
      }}
    >
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {comp ? comp.nombre : (esBye ? "BYE (pase directo)" : "Por definir")}
      </span>
      {esGanador && <span aria-hidden="true">✓</span>}
    </button>
  );
}

export default function LlavesSection({ campeonatoId }: { campeonatoId: number }) {
  const [llaves, setLlaves] = useState<LlaveData[]>([]);
  const [tatamis, setTatamis] = useState<{ id: number; numero: number }[]>([]);
  const [abierta, setAbierta] = useState<number | null>(null);
  const [creando, setCreando] = useState(false);
  const [nombre, setNombre] = useState("");
  const [tatamiId, setTatamiId] = useState("");
  const [listaTexto, setListaTexto] = useState("");
  const [msg, setMsg] = useState("");
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const [data, t] = await Promise.all([
        listLlavesAPI(campeonatoId),
        listTatamisAPI(campeonatoId),
      ]);
      setLlaves(data);
      setTatamis(
        (t as { id: number; numero: number }[]).map((x) => ({ id: x.id, numero: x.numero }))
      );
    } catch { /* */ }
  }, [campeonatoId]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) void cargar(); });
    return () => { cancelled = true; };
  }, [cargar]);

  function flash(texto: string) {
    setMsg(texto);
    setTimeout(() => setMsg(""), 3500);
  }

  async function handleCrear(e: React.FormEvent) {
    e.preventDefault();
    const competidores = listaTexto
      .split("\n")
      .map((linea) => linea.trim())
      .filter(Boolean)
      .map((linea) => {
        const [nom, club] = linea.split(",").map((s) => s.trim());
        return { nombre: nom, club: club || "" };
      });
    if (!nombre.trim() || competidores.length < 2) {
      flash("Escribe el nombre de la llave y al menos 2 competidores.");
      return;
    }
    if (!tatamiId) {
      flash("Selecciona el tatami donde se disputará esta llave.");
      return;
    }
    setGuardando(true);
    try {
      const res = await createLlaveAPI({
        campeonato_id: campeonatoId,
        tatami_id: Number(tatamiId),
        nombre: nombre.trim(),
        competidores,
      });
      setCreando(false);
      setNombre("");
      setTatamiId("");
      setListaTexto("");
      await cargar();
      setAbierta(res.llave.id);
      flash("Llave creada con sorteo aleatorio.");
    } catch (err) {
      const m = (err as { response?: { data?: { error?: string } } }).response?.data?.error;
      flash(m || "Error al crear la llave.");
    } finally {
      setGuardando(false);
    }
  }

  async function handleGanador(llave: LlaveData, ronda: number, partido: number, lado: 1 | 2) {
    const p = llave.estructura.rondas[ronda][partido];
    // Si ya era el ganador, des-marcar (corrección); si no, marcar
    const nuevo = p.ganador === lado ? null : lado;
    try {
      const res = await marcarGanadorLlaveAPI(llave.id, { ronda, partido, ganador: nuevo });
      setLlaves((prev) => prev.map((l) => (l.id === llave.id ? res.llave : l)));
    } catch (err) {
      const m = (err as { response?: { data?: { error?: string } } }).response?.data?.error;
      flash(m || "No se pudo registrar el resultado.");
    }
  }

  async function handleEliminar(llave: LlaveData) {
    const ok = window.confirm(`¿Eliminar la llave "${llave.nombre}"? Se perderá el cuadro completo.`);
    if (!ok) return;
    try {
      await deleteLlaveAPI(llave.id);
      await cargar();
      flash("Llave eliminada.");
    } catch {
      flash("No se pudo eliminar la llave.");
    }
  }

  return (
    <div style={{ marginTop: 28 }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        flexWrap: "wrap", gap: 10, marginBottom: 12,
      }}>
        <div className="card-title" style={{ marginBottom: 0 }}>
          Llaves de Eliminación ({llaves.length})
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setCreando(!creando)}>
          + Nueva Llave
        </button>
      </div>

      {msg && (
        <div className="animate-fade" style={{
          background: "var(--gold-bg)", border: "1px solid var(--gold-border)",
          borderRadius: "var(--radius-sm)", padding: "8px 14px",
          color: "var(--gold)", marginBottom: 12, fontSize: "0.85rem", fontWeight: 700,
        }}>{msg}</div>
      )}

      {creando && (
        <form onSubmit={handleCrear} className="card animate-slide"
          style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
          <input
            className="input"
            placeholder="Nombre de la llave (ej: Combate Juvenil -60kg)"
            value={nombre}
            maxLength={120}
            onChange={(e) => setNombre(e.target.value)}
            required
          />
          <select
            className="input"
            value={tatamiId}
            onChange={(e) => setTatamiId(e.target.value)}
            required
          >
            <option value="">Tatami donde se disputará...</option>
            {tatamis.map((t) => (
              <option key={t.id} value={String(t.id)}>Tatami {t.numero}</option>
            ))}
          </select>
          <textarea
            className="input"
            placeholder={"Un competidor por línea. Club opcional con coma:\nJuan Pérez, Club Tigre\nMaría López"}
            value={listaTexto}
            onChange={(e) => setListaTexto(e.target.value)}
            rows={6}
            style={{ resize: "vertical", minHeight: 120, fontFamily: "var(--font-body)" }}
            required
          />
          <p style={{ color: "var(--text-dim)", fontSize: "0.78rem" }}>
            El sistema sortea las posiciones aleatoriamente y asigna los byes
            (pases directos) automáticamente cuando el número de competidores
            no es potencia de 2.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" className="btn btn-primary" disabled={guardando}>
              {guardando ? "Sorteando..." : "Crear y Sortear"}
            </button>
            <button type="button" className="btn" onClick={() => setCreando(false)}>Cancelar</button>
          </div>
        </form>
      )}

      {llaves.length === 0 && !creando ? (
        <div className="card" style={{ textAlign: "center", padding: 24, color: "var(--text-dim)" }}>
          No hay llaves creadas. Crea una con la lista de competidores y el
          sistema generará el cuadro con sorteo y byes.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {llaves.map((llave) => {
            const expandida = abierta === llave.id;
            const totalRondas = llave.estructura.rondas.length;
            const campeon = llave.estructura.campeon;
            return (
              <div key={llave.id} className="card" style={{ padding: 0, overflow: "hidden" }}>
                <button
                  type="button"
                  onClick={() => setAbierta(expandida ? null : llave.id)}
                  style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    gap: 10, width: "100%", padding: "14px 16px",
                    background: "transparent", border: "none", color: "var(--text)",
                    cursor: "pointer", font: "inherit", textAlign: "left",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: "1rem" }}>
                      {llave.nombre}
                      {llave.tatami_numero && (
                        <span className="badge badge-chung" style={{ marginLeft: 8, verticalAlign: "middle" }}>
                          Tatami {llave.tatami_numero}
                        </span>
                      )}
                    </div>
                    <div style={{ color: "var(--text-muted)", fontSize: "0.78rem", marginTop: 2 }}>
                      {llave.estructura.competidores.length} competidores · {totalRondas} ronda(s)
                      {campeon && (
                        <span style={{ color: "var(--gold)", fontWeight: 800 }}>
                          {" "}· 🏆 {campeon.nombre}
                        </span>
                      )}
                    </div>
                  </div>
                  <span style={{ color: "var(--text-dim)", flexShrink: 0 }}>
                    {expandida ? "▲" : "▼"}
                  </span>
                </button>

                {expandida && (
                  <div className="animate-fade" style={{ padding: "0 16px 16px" }}>
                    {/* Cuadro: columnas por ronda con scroll horizontal */}
                    <div style={{ overflowX: "auto", paddingBottom: 8 }}>
                      <div style={{ display: "flex", gap: 18, minWidth: totalRondas * 220 }}>
                        {llave.estructura.rondas.map((ronda, rIdx) => (
                          <div key={rIdx} style={{
                            display: "flex", flexDirection: "column",
                            justifyContent: "space-around", gap: 12, flex: "1 0 200px",
                          }}>
                            <div style={{
                              textAlign: "center", fontSize: "0.7rem", fontWeight: 800,
                              textTransform: "uppercase", letterSpacing: "0.12em",
                              color: "var(--gold)",
                            }}>
                              {nombreRonda(rIdx, totalRondas)}
                            </div>
                            {ronda.map((partido: LlavePartido, pIdx: number) => {
                              const esByeR0 = rIdx === 0 && partido.comp1 !== null && partido.comp2 === null;
                              return (
                                <div key={pIdx} style={{
                                  background: "var(--bg-elevated)",
                                  border: "1px solid var(--border)",
                                  borderRadius: "var(--radius-sm)",
                                  overflow: "hidden",
                                }}>
                                  <LadoPartido
                                    comp={partido.comp1}
                                    esGanador={partido.ganador === 1}
                                    esBye={false}
                                    disabled={esByeR0}
                                    onClick={() => handleGanador(llave, rIdx, pIdx, 1)}
                                  />
                                  <div style={{ height: 1, background: "var(--border)" }} />
                                  <LadoPartido
                                    comp={partido.comp2}
                                    esGanador={partido.ganador === 2}
                                    esBye={esByeR0}
                                    disabled={esByeR0}
                                    onClick={() => handleGanador(llave, rIdx, pIdx, 2)}
                                  />
                                </div>
                              );
                            })}
                          </div>
                        ))}
                        {/* Campeón */}
                        <div style={{
                          display: "flex", flexDirection: "column",
                          justifyContent: "center", flex: "0 0 180px",
                        }}>
                          <div style={{
                            textAlign: "center", fontSize: "0.7rem", fontWeight: 800,
                            textTransform: "uppercase", letterSpacing: "0.12em",
                            color: "var(--gold)", marginBottom: 8,
                          }}>Campeón</div>
                          <div style={{
                            padding: "14px 12px", textAlign: "center",
                            background: campeon ? "var(--gold-bg)" : "var(--bg-elevated)",
                            border: `1.5px solid ${campeon ? "var(--gold)" : "var(--border)"}`,
                            borderRadius: "var(--radius-sm)",
                            color: campeon ? "var(--gold)" : "var(--text-dim)",
                            fontWeight: 800,
                          }}>
                            {campeon ? `🏆 ${campeon.nombre}` : "Por definir"}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                      <p style={{ color: "var(--text-dim)", fontSize: "0.74rem", margin: 0 }}>
                        Toca un competidor para marcarlo como ganador. Tócalo de
                        nuevo para corregir el resultado.
                      </p>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => handleEliminar(llave)}
                      >
                        Eliminar llave
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
