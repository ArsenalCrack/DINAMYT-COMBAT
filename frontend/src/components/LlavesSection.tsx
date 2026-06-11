"use client";

import { useCallback, useEffect, useState } from "react";
import {
  createLlaveAPI,
  listLlavesAPI,
  listTatamisAPI,
  marcarGanadorLlaveAPI,
  deleteLlaveAPI,
  type LlaveData,
} from "@/lib/api";
import BracketTree from "@/components/BracketTree";
import { useConfirmDialog } from "@/components/ConfirmDialog";

interface NuevoCompetidor {
  nombre: string;
  club: string;
}

type TipoMensaje = "ok" | "error";

export default function LlavesSection({ campeonatoId }: { campeonatoId: number }) {
  const [llaves, setLlaves] = useState<LlaveData[]>([]);
  const [tatamis, setTatamis] = useState<{ id: number; numero: number }[]>([]);
  const [filtroTatami, setFiltroTatami] = useState("");
  const [abierta, setAbierta] = useState<number | null>(null);
  const [creando, setCreando] = useState(false);
  const [nombre, setNombre] = useState("");
  const [tatamiId, setTatamiId] = useState("");
  const [compNombre, setCompNombre] = useState("");
  const [compClub, setCompClub] = useState("");
  const [competidores, setCompetidores] = useState<NuevoCompetidor[]>([]);
  const [msg, setMsg] = useState<{ texto: string; tipo: TipoMensaje } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const { pedirConfirmacion, dialogo } = useConfirmDialog();

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

  function flash(texto: string, tipo: TipoMensaje = "error") {
    setMsg({ texto, tipo });
    setTimeout(() => setMsg(null), 3500);
  }

  // ── Alta de competidores (igual que en figuras: nombre y club por aparte) ──
  const MAX_COMPETIDORES = 64;

  function agregarCompetidor() {
    const nom = compNombre.trim();
    if (!nom) return;
    if (competidores.length >= MAX_COMPETIDORES) {
      flash(`Máximo ${MAX_COMPETIDORES} competidores.`);
      return;
    }
    if (competidores.some((c) => c.nombre.toLowerCase() === nom.toLowerCase())) {
      flash(`"${nom}" ya está en la lista.`);
      return;
    }
    setCompetidores((prev) => [...prev, { nombre: nom, club: compClub.trim() }]);
    setCompNombre("");
    setCompClub("");
  }

  function quitarCompetidor(idx: number) {
    const comp = competidores[idx];
    if (!comp) return;
    pedirConfirmacion({
      titulo: "Quitar competidor",
      mensaje: `¿Estás seguro de quitar a "${comp.nombre}"${comp.club ? ` (${comp.club})` : ""} de la lista de la llave?`,
      tipo: "advertencia",
      confirmLabel: "Quitar",
      onConfirm: () => setCompetidores((prev) => prev.filter((_, i) => i !== idx)),
    });
  }

  async function handleCrear(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) {
      flash("Escribe el nombre de la llave.");
      return;
    }
    if (!tatamiId) {
      flash("Selecciona el tatami donde se disputará esta llave.");
      return;
    }
    if (competidores.length < 2) {
      flash("Agrega al menos 2 competidores.");
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
      setCompetidores([]);
      await cargar();
      setAbierta(res.llave.id);
      flash("Llave creada con sorteo aleatorio.", "ok");
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

  function handleEliminar(llave: LlaveData) {
    pedirConfirmacion({
      titulo: "Eliminar llave",
      mensaje: `¿Eliminar la llave "${llave.nombre}"? Se perderá el cuadro completo con sus resultados.`,
      tipo: "peligro",
      confirmLabel: "Eliminar",
      onConfirm: async () => {
        try {
          await deleteLlaveAPI(llave.id);
          setLlaves((prev) => prev.filter((l) => l.id !== llave.id));
          if (abierta === llave.id) setAbierta(null);
          flash("Llave eliminada.", "ok");
        } catch {
          flash("No se pudo eliminar la llave.");
        }
      },
    });
  }

  const llavesVisibles = filtroTatami
    ? llaves.filter((l) => String(l.tatami_id) === filtroTatami)
    : llaves;

  return (
    <div>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        flexWrap: "wrap", gap: 10, marginBottom: 12,
      }}>
        <div className="card-title" style={{ marginBottom: 0 }}>
          Llaves de Eliminación ({llavesVisibles.length})
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select
            className="input"
            value={filtroTatami}
            onChange={(e) => setFiltroTatami(e.target.value)}
            style={{ width: "auto", minWidth: 150, padding: "6px 32px 6px 12px", minHeight: 36 }}
          >
            <option value="">Todos los tatamis</option>
            {tatamis.map((t) => (
              <option key={t.id} value={String(t.id)}>Tatami {t.numero}</option>
            ))}
          </select>
          <button className="btn btn-primary btn-sm" onClick={() => setCreando(!creando)}>
            + Nueva Llave
          </button>
        </div>
      </div>

      {msg && (
        <div className="animate-fade" role={msg.tipo === "error" ? "alert" : "status"} style={{
          background: msg.tipo === "error" ? "rgba(255,68,68,0.10)" : "var(--green-bg)",
          border: `1px solid ${msg.tipo === "error" ? "rgba(255,68,68,0.35)" : "var(--green-border)"}`,
          borderRadius: "var(--radius-sm)", padding: "8px 14px",
          color: msg.tipo === "error" ? "var(--red-alert)" : "var(--green)",
          marginBottom: 12, fontSize: "0.85rem", fontWeight: 700,
        }}>{msg.texto}</div>
      )}
      {dialogo}

      {creando && (
        <form onSubmit={handleCrear} className="card animate-slide"
          style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
          <div className="card-title">Nueva llave de eliminación</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              className="input"
              placeholder="Nombre de la llave (ej: Combate Juvenil -60kg)"
              value={nombre}
              maxLength={120}
              onChange={(e) => setNombre(e.target.value)}
              style={{ flex: "2 1 220px" }}
              required
            />
            <select
              className="input"
              value={tatamiId}
              onChange={(e) => setTatamiId(e.target.value)}
              style={{ flex: "1 1 160px" }}
              required
            >
              <option value="">Tatami donde se disputará...</option>
              {tatamis.map((t) => (
                <option key={t.id} value={String(t.id)}>Tatami {t.numero}</option>
              ))}
            </select>
          </div>

          {/* Competidores: nombre y club por aparte, como en figuras */}
          <div className="card" style={{ background: "var(--bg-elevated)", padding: 12 }}>
            <div style={{
              fontSize: "0.72rem", fontWeight: 800, textTransform: "uppercase",
              letterSpacing: "0.1em", color: "var(--text-muted)", marginBottom: 8,
            }}>
              Competidores ({competidores.length}/{MAX_COMPETIDORES})
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: competidores.length ? 10 : 0 }}>
              <input className="input" placeholder="Nombre del competidor" value={compNombre}
                onChange={(e) => setCompNombre(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    agregarCompetidor();
                  }
                }}
                style={{ flex: "2 1 180px" }} />
              <input className="input" placeholder="Club / Equipo (opc.)" value={compClub}
                onChange={(e) => setCompClub(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    agregarCompetidor();
                  }
                }}
                style={{ flex: "1 1 140px" }} />
              <button type="button" className="btn btn-primary"
                onClick={agregarCompetidor}
                disabled={!compNombre.trim() || competidores.length >= MAX_COMPETIDORES}>
                + Agregar
              </button>
            </div>
            {competidores.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 220, overflowY: "auto" }}>
                {competidores.map((c, i) => (
                  <div key={`${c.nombre}-${i}`} style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "6px 10px", background: "var(--bg-card)",
                    border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
                  }}>
                    <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: "0.75rem", minWidth: 22 }}>
                      {i + 1}.
                    </span>
                    <span style={{ flex: 1, fontWeight: 700, overflowWrap: "anywhere" }}>
                      {c.nombre}
                      {c.club && <span style={{ color: "var(--text-muted)", fontWeight: 500, marginLeft: 8, fontSize: "0.8rem" }}>{c.club}</span>}
                    </span>
                    <button type="button" className="btn btn-sm btn-danger"
                      onClick={() => quitarCompetidor(i)}
                      style={{ padding: "2px 8px", minHeight: 28, fontSize: "0.72rem" }}>
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <p style={{ color: "var(--text-dim)", fontSize: "0.78rem", margin: 0 }}>
            El sistema sortea las posiciones aleatoriamente y asigna los byes
            (pases directos) automáticamente cuando el número de competidores
            no es potencia de 2.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="submit" className="btn btn-primary" disabled={guardando || competidores.length < 2}>
              {guardando ? "Sorteando..." : `Crear y Sortear (${competidores.length})`}
            </button>
            <button type="button" className="btn" onClick={() => setCreando(false)}>Cancelar</button>
          </div>
        </form>
      )}

      {llavesVisibles.length === 0 && !creando ? (
        <div className="card" style={{ textAlign: "center", padding: 24, color: "var(--text-dim)" }}>
          {llaves.length === 0
            ? "No hay llaves creadas. Crea una con la lista de competidores y el sistema generará el cuadro con sorteo y byes."
            : "No hay llaves en este tatami."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {llavesVisibles.map((llave) => {
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
                    <div style={{ fontWeight: 800, fontSize: "1rem", overflowWrap: "anywhere" }}>
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
                    <BracketTree
                      estructura={llave.estructura}
                      variant="admin"
                      onGanador={(r, p, lado) => handleGanador(llave, r, p, lado)}
                    />
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                      <p style={{ color: "var(--text-dim)", fontSize: "0.74rem", margin: 0 }}>
                        Toca un competidor para marcarlo como ganador. Tócalo de
                        nuevo para corregir el resultado. Los combates también
                        avanzan solos desde el tatami (Juez Central).
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
