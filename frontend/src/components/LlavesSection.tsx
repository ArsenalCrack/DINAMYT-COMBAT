"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createLlaveAPI,
  updateLlaveAPI,
  listLlavesAPI,
  listTatamisAPI,
  marcarGanadorLlaveAPI,
  deleteLlaveAPI,
  type LlaveData,
  type TipoLlave,
  type EstadoLlave,
} from "@/lib/api";
import { CATEGORIAS_FIGURAS, CATEGORIA_NOMBRE_MAX, normalizarCategoria } from "@/lib/categorias";
import BracketTree from "@/components/BracketTree";
import PodioLlave from "@/components/PodioLlave";
import SelectMenu from "@/components/SelectMenu";
import { useConfirmDialog } from "@/components/ConfirmDialog";

interface NuevoCompetidor {
  nombre: string;
  club: string;
}

type TipoMensaje = "ok" | "error";
type FiltroTipo = "todas" | "combate" | "figuras";
type FiltroEstado = "todas" | EstadoLlave;

const ESTADO_BADGE: Record<EstadoLlave, { clase: string; texto: string }> = {
  pendiente: { clase: "badge-gray", texto: "Pendiente" },
  activa: { clase: "badge-green", texto: "Activa" },
  terminada: { clase: "badge-gold", texto: "Terminada" },
};

const ORDEN_ESTADO: Record<EstadoLlave, number> = { activa: 0, pendiente: 1, terminada: 2 };

const OTRA = "__otra__";

export default function LlavesSection({ campeonatoId }: { campeonatoId: number }) {
  const [llaves, setLlaves] = useState<LlaveData[]>([]);
  const [tatamis, setTatamis] = useState<{ id: number; numero: number }[]>([]);
  const [filtroTatami, setFiltroTatami] = useState("");
  const [filtroTipo, setFiltroTipo] = useState<FiltroTipo>("todas");
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>("todas");
  const [abierta, setAbierta] = useState<number | null>(null);

  // ── Formulario (crear / editar) ──
  const [creando, setCreando] = useState(false);
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [tipoForm, setTipoForm] = useState<TipoLlave>("combate");
  const [nombre, setNombre] = useState("");
  const [categoriaSel, setCategoriaSel] = useState<string>(CATEGORIAS_FIGURAS[0]);
  const [descripcion, setDescripcion] = useState("");
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

  const MAX_COMPETIDORES = tipoForm === "figuras" ? 50 : 64;
  const MIN_COMPETIDORES = tipoForm === "figuras" ? 2 : 3;

  // ── Alta de competidores (nombre y club por aparte) ──
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
      mensaje: `¿Quitar a "${comp.nombre}"${comp.club ? ` (${comp.club})` : ""} de la lista?`,
      tipo: "advertencia",
      confirmLabel: "Quitar",
      onConfirm: () => setCompetidores((prev) => prev.filter((_, i) => i !== idx)),
    });
  }

  // ── Abrir formulario ──
  function resetForm() {
    setNombre("");
    setCategoriaSel(CATEGORIAS_FIGURAS[0]);
    setDescripcion("");
    setTatamiId("");
    setCompNombre("");
    setCompClub("");
    setCompetidores([]);
  }

  function abrirCrear() {
    resetForm();
    setEditandoId(null);
    setTipoForm("combate");
    setCreando(true);
  }

  function abrirEditar(llave: LlaveData) {
    setEditandoId(llave.id);
    setTipoForm(llave.tipo);
    setNombre(llave.nombre);
    setDescripcion(llave.descripcion || "");
    setTatamiId(llave.tatami_id ? String(llave.tatami_id) : "");
    if (llave.tipo === "figuras") {
      setCategoriaSel(
        (CATEGORIAS_FIGURAS as readonly string[]).includes(llave.nombre) ? llave.nombre : OTRA
      );
    }
    setCompetidores(
      (llave.estructura.competidores || []).map((c) => ({ nombre: c.nombre, club: c.club || "" }))
    );
    setCompNombre("");
    setCompClub("");
    setCreando(true);
    setAbierta(null);
  }

  function cerrarForm() {
    setCreando(false);
    setEditandoId(null);
    resetForm();
  }

  // El nombre efectivo de figuras viene del desplegable (o del texto si "Otra")
  const nombreFiguras = categoriaSel === OTRA ? normalizarCategoria(nombre) : categoriaSel;
  const nombreEfectivo = tipoForm === "figuras" ? nombreFiguras : nombre.trim();

  async function handleGuardar(e: React.FormEvent) {
    e.preventDefault();
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      flash("Sin internet: reintenta cuando vuelva la conexión.");
      return;
    }
    if (!nombreEfectivo) {
      flash(tipoForm === "figuras" ? "Selecciona o escribe la categoría." : "Escribe el nombre de la llave.");
      return;
    }
    if (competidores.length < MIN_COMPETIDORES) {
      flash(
        tipoForm === "figuras"
          ? `Un grupo de figuras necesita mínimo ${MIN_COMPETIDORES} competidores.`
          : "Una llave de eliminación necesita mínimo 3 competidores. Con solo 2, haz un combate normal desde el tatami."
      );
      return;
    }
    setGuardando(true);
    try {
      if (editandoId) {
        const res = await updateLlaveAPI(editandoId, {
          nombre: nombreEfectivo,
          descripcion: tipoForm === "figuras" ? descripcion.trim() : undefined,
          tatami_id: tatamiId ? Number(tatamiId) : null,
          competidores,
        });
        cerrarForm();
        await cargar();
        setAbierta(res.llave.id);
        flash("Llave actualizada.", "ok");
      } else {
        const res = await createLlaveAPI({
          campeonato_id: campeonatoId,
          tipo: tipoForm,
          tatami_id: tatamiId ? Number(tatamiId) : null,
          nombre: nombreEfectivo,
          descripcion: tipoForm === "figuras" ? descripcion.trim() : undefined,
          competidores,
        });
        cerrarForm();
        await cargar();
        setAbierta(res.llave.id);
        flash(tipoForm === "figuras" ? "Grupo de figuras creado." : "Llave creada con sorteo aleatorio.", "ok");
      }
    } catch (err) {
      const m = (err as { response?: { data?: { error?: string } } }).response?.data?.error;
      flash(m || "Error al guardar.");
    } finally {
      setGuardando(false);
    }
  }

  async function handleGanador(llave: LlaveData, ronda: number | "bronce", partido: number, lado: 1 | 2) {
    const p = ronda === "bronce" ? llave.estructura.bronce : llave.estructura.rondas[ronda]?.[partido];
    if (!p) return;
    // Si ya era el ganador, des-marcar (corrección); si no, marcar.
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
      mensaje: `¿Eliminar "${llave.nombre}"? Se perderá su contenido y resultados.`,
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

  // ── Filtrado + orden ──
  const conteo = useMemo(() => ({
    todas: llaves.length,
    combate: llaves.filter((l) => l.tipo === "combate").length,
    figuras: llaves.filter((l) => l.tipo === "figuras").length,
  }), [llaves]);

  const llavesVisibles = useMemo(() => {
    return llaves
      .filter((l) => filtroTipo === "todas" || l.tipo === filtroTipo)
      .filter((l) => filtroEstado === "todas" || l.estado === filtroEstado)
      .filter((l) => {
        if (!filtroTatami) return true;
        if (filtroTatami === "__pool__") return !l.tatami_id;
        return String(l.tatami_id) === filtroTatami;
      })
      .sort((a, b) => ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado]);
  }, [llaves, filtroTipo, filtroEstado, filtroTatami]);

  return (
    <div>
      {/* ── Cabecera: filtros de tipo + nueva ── */}
      <div className="llaves-toolbar">
        <div className="seg" role="tablist" aria-label="Filtrar por tipo">
          {(["todas", "combate", "figuras"] as FiltroTipo[]).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              className={`seg-btn ${filtroTipo === t ? "seg-on" : ""}`}
              onClick={() => setFiltroTipo(t)}
              aria-selected={filtroTipo === t}
            >
              {t === "todas" ? "Todas" : t === "combate" ? "Combate" : "Figuras"}
              <span className="seg-count">{conteo[t]}</span>
            </button>
          ))}
        </div>
        <div className="llaves-toolbar-right">
          <select
            className="input input-compact"
            value={filtroEstado}
            onChange={(e) => setFiltroEstado(e.target.value as FiltroEstado)}
            aria-label="Filtrar por estado"
          >
            <option value="todas">Todos los estados</option>
            <option value="pendiente">Pendientes</option>
            <option value="activa">Activas</option>
            <option value="terminada">Terminadas</option>
          </select>
          <select
            className="input input-compact"
            value={filtroTatami}
            onChange={(e) => setFiltroTatami(e.target.value)}
            aria-label="Filtrar por tatami"
          >
            <option value="">Todos los tatamis</option>
            <option value="__pool__">Sin asignar (pool)</option>
            {tatamis.map((t) => (
              <option key={t.id} value={String(t.id)}>Tatami {t.numero}</option>
            ))}
          </select>
          {!creando && (
            <button className="btn btn-primary btn-sm" onClick={abrirCrear}>+ Nueva</button>
          )}
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

      {/* ── Formulario crear / editar ── */}
      {creando && (
        <form onSubmit={handleGuardar} className="card animate-slide"
          style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 14 }}>
          <div className="card-title">
            {editandoId ? "Editar" : "Nueva"} {tipoForm === "figuras" ? "grupo de figuras" : "llave de eliminación"}
          </div>

          {/* Tipo (bloqueado al editar: no se cambia el tipo de una llave) */}
          <div className="seg" role="tablist" aria-label="Tipo de llave">
            {(["combate", "figuras"] as TipoLlave[]).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                className={`seg-btn ${tipoForm === t ? "seg-on" : ""}`}
                onClick={() => !editandoId && setTipoForm(t)}
                disabled={Boolean(editandoId) && tipoForm !== t}
                aria-selected={tipoForm === t}
                style={{ flex: 1 }}
              >
                {t === "combate" ? "⚔️ Combate" : "🥋 Figuras"}
              </button>
            ))}
          </div>

          {/* Nombre / categoría + tatami */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {tipoForm === "figuras" ? (
              <SelectMenu
                ariaLabel="Categoría de figuras"
                value={categoriaSel}
                onChange={setCategoriaSel}
                options={[
                  ...CATEGORIAS_FIGURAS.map((c) => ({ value: c, label: c })),
                  { value: OTRA, label: "Otra categoría…" },
                ]}
                style={{ flex: "2 1 220px" }}
              />
            ) : (
              <input
                className="input"
                placeholder="Nombre de la llave (ej: COMBATE JUVENIL -60KG)"
                value={nombre}
                maxLength={120}
                onChange={(e) => setNombre(e.target.value)}
                style={{ flex: "2 1 220px" }}
                required
              />
            )}
            <select
              className="input"
              value={tatamiId}
              onChange={(e) => setTatamiId(e.target.value)}
              style={{ flex: "1 1 160px" }}
            >
              <option value="">Sin asignar (pool)</option>
              {tatamis.map((t) => (
                <option key={t.id} value={String(t.id)}>Tatami {t.numero}</option>
              ))}
            </select>
          </div>

          {/* Figuras: nombre libre si "Otra" + descripción pública */}
          {tipoForm === "figuras" && (
            <>
              {categoriaSel === OTRA && (
                <input
                  className="input"
                  placeholder="Escribe la categoría (solo letras)"
                  value={nombre}
                  maxLength={CATEGORIA_NOMBRE_MAX}
                  onChange={(e) => setNombre(normalizarCategoria(e.target.value))}
                  style={{ textTransform: "uppercase" }}
                />
              )}
              <input
                className="input"
                placeholder="Descripción pública (opc.) — ej: Intermedios 15-17 años"
                value={descripcion}
                maxLength={120}
                onChange={(e) => setDescripcion(e.target.value)}
              />
            </>
          )}

          {/* Competidores */}
          <div className="card" style={{ background: "var(--bg-elevated)", padding: 12 }}>
            <div style={{
              fontSize: "0.72rem", fontWeight: 800, textTransform: "uppercase",
              letterSpacing: "0.1em", color: "var(--text-muted)", marginBottom: 8,
            }}>
              Competidores ({competidores.length}) · mínimo {MIN_COMPETIDORES}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: competidores.length ? 10 : 0 }}>
              <input className="input" placeholder="Nombre del competidor" value={compNombre}
                onChange={(e) => setCompNombre(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); agregarCompetidor(); } }}
                style={{ flex: "2 1 180px" }} />
              <input className="input" placeholder="Club / Equipo (opc.)" value={compClub}
                onChange={(e) => setCompClub(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); agregarCompetidor(); } }}
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
            {tipoForm === "figuras"
              ? "El grupo se encola y el Juez Central lo activa desde el tatami: carga todos los competidores de golpe y arma el podio al puntuar. Sin tatami queda en el pool para asignarlo después."
              : "El sistema sortea las posiciones y asigna los byes automáticamente. Editar competidores vuelve a sortear el cuadro. Sin tatami la llave queda en el pool."}
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="submit" className="btn btn-primary" disabled={guardando || competidores.length < MIN_COMPETIDORES}>
              {guardando
                ? "Guardando..."
                : editandoId
                  ? "Guardar cambios"
                  : tipoForm === "figuras"
                    ? `Crear grupo (${competidores.length})`
                    : `Crear y Sortear (${competidores.length})`}
            </button>
            <button type="button" className="btn" onClick={cerrarForm}>Cancelar</button>
          </div>
        </form>
      )}

      {/* ── Lista ── */}
      {llavesVisibles.length === 0 && !creando ? (
        <div className="card" style={{ textAlign: "center", padding: 24, color: "var(--text-dim)" }}>
          {llaves.length === 0
            ? "No hay llaves ni grupos creados. Crea uno con la lista de competidores; las de combate generan el cuadro con sorteo y los grupos de figuras se puntúan desde el tatami."
            : "No hay llaves que coincidan con los filtros."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {llavesVisibles.map((llave) => (
            <LlaveCard
              key={llave.id}
              llave={llave}
              expandida={abierta === llave.id}
              onToggle={() => setAbierta(abierta === llave.id ? null : llave.id)}
              onGanador={(r, p, lado) => handleGanador(llave, r, p, lado)}
              onEditar={() => abrirEditar(llave)}
              onEliminar={() => handleEliminar(llave)}
            />
          ))}
        </div>
      )}

      <style>{`
        .llaves-toolbar {
          display: flex; justify-content: space-between; align-items: center;
          gap: 10px; flex-wrap: wrap; margin-bottom: 12px;
        }
        .llaves-toolbar-right {
          display: flex; gap: 8px; flex-wrap: wrap; align-items: center;
        }
        .seg {
          display: inline-flex; background: var(--bg-elevated);
          border: 1px solid var(--border); border-radius: var(--radius-sm);
          padding: 3px; gap: 2px;
        }
        .seg-btn {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 6px 12px; min-height: 34px; border: none; cursor: pointer;
          background: transparent; color: var(--text-muted);
          font: inherit; font-size: 0.82rem; font-weight: 700;
          border-radius: calc(var(--radius-sm) - 2px); transition: all 0.15s;
        }
        .seg-btn:hover:not(.seg-on) { color: var(--text); }
        .seg-btn.seg-on { background: var(--gold); color: var(--text-on-gold, #1a1a1a); }
        .seg-btn:disabled { opacity: 0.45; cursor: not-allowed; }
        .seg-count {
          font-size: 0.7rem; font-weight: 800; padding: 1px 6px;
          border-radius: 999px; background: rgba(0,0,0,0.18);
        }
        .seg-btn.seg-on .seg-count { background: rgba(0,0,0,0.22); }
        .input-compact {
          width: auto; min-width: 140px; padding: 6px 30px 6px 12px; min-height: 34px;
        }
        @media (max-width: 560px) {
          .llaves-toolbar, .llaves-toolbar-right { width: 100%; }
          .seg { width: 100%; }
          .seg-btn { flex: 1; justify-content: center; }
          .input-compact { flex: 1 1 140px; min-width: 0; }
        }
      `}</style>
    </div>
  );
}

// ── Tarjeta de una llave (combate o figuras) ──
function LlaveCard({
  llave, expandida, onToggle, onGanador, onEditar, onEliminar,
}: {
  llave: LlaveData;
  expandida: boolean;
  onToggle: () => void;
  onGanador: (ronda: number | "bronce", partido: number, lado: 1 | 2) => void;
  onEditar: () => void;
  onEliminar: () => void;
}) {
  const esFiguras = llave.tipo === "figuras";
  const estado = ESTADO_BADGE[llave.estado];
  const totalRondas = llave.estructura.rondas?.length || 0;
  const campeon = llave.estructura.campeon;
  const numComp = llave.estructura.competidores?.length || 0;
  const editable = llave.estado === "pendiente";

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          gap: 10, width: "100%", padding: "14px 16px",
          background: "transparent", border: "none", color: "var(--text)",
          cursor: "pointer", font: "inherit", textAlign: "left",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 800, fontSize: "1rem", overflowWrap: "anywhere" }}>
              {llave.nombre}
            </span>
            <span className={`badge ${esFiguras ? "badge-chung" : "badge-hong"}`}>
              {esFiguras ? "Figuras" : "Combate"}
            </span>
            <span className={`badge ${estado.clase}`}>{estado.texto}</span>
            <span className="badge badge-gray">
              {llave.tatami_numero ? `Tatami ${llave.tatami_numero}` : "Sin tatami"}
            </span>
          </div>
          {llave.descripcion && (
            <div style={{ color: "var(--text-muted)", fontSize: "0.8rem", marginTop: 4, overflowWrap: "anywhere" }}>
              {llave.descripcion}
            </div>
          )}
          <div style={{ color: "var(--text-muted)", fontSize: "0.78rem", marginTop: 2 }}>
            {numComp} competidores
            {!esFiguras && <> · {totalRondas} ronda(s)</>}
            {campeon && (
              <span style={{ color: "var(--gold)", fontWeight: 800 }}> · 🏆 {campeon.nombre}</span>
            )}
          </div>
        </div>
        <span style={{ color: "var(--text-dim)", flexShrink: 0 }}>{expandida ? "▲" : "▼"}</span>
      </button>

      {expandida && (
        <div className="animate-fade" style={{ padding: "0 16px 16px" }}>
          {esFiguras ? (
            <ListaCompetidores competidores={llave.estructura.competidores || []} />
          ) : (
            <>
              {campeon && (
                <div style={{ marginBottom: 12 }}>
                  <PodioLlave estructura={llave.estructura} titulo="🏆 Podio" />
                </div>
              )}
              <BracketTree
                estructura={llave.estructura}
                variant="admin"
                onGanador={(r, p, lado) => onGanador(r, p, lado)}
              />
            </>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <p style={{ color: "var(--text-dim)", fontSize: "0.74rem", margin: 0, flex: "1 1 200px" }}>
              {esFiguras
                ? editable
                  ? "Edita los competidores, la categoría o el tatami mientras esté pendiente."
                  : "Grupo activo o terminado: no se edita para no afectar el podio."
                : "Toca un competidor para marcarlo ganador; tócalo de nuevo para corregir. También avanza solo desde el tatami."}
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {editable && (
                <button className="btn btn-sm" onClick={onEditar}>Editar</button>
              )}
              <button className="btn btn-danger btn-sm" onClick={onEliminar}>Eliminar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ListaCompetidores({ competidores }: { competidores: { nombre: string; club?: string }[] }) {
  if (competidores.length === 0) {
    return <p style={{ color: "var(--text-dim)", fontSize: "0.82rem" }}>Sin competidores.</p>;
  }
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
      gap: 6, marginTop: 4,
    }}>
      {competidores.map((c, i) => (
        <div key={`${c.nombre}-${i}`} style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "6px 10px", background: "var(--bg-elevated)",
          border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
        }}>
          <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: "0.72rem", minWidth: 20 }}>
            {i + 1}.
          </span>
          <span style={{ fontWeight: 700, overflowWrap: "anywhere", fontSize: "0.85rem" }}>
            {c.nombre}
            {c.club && <span style={{ color: "var(--text-muted)", fontWeight: 500, marginLeft: 6, fontSize: "0.78rem" }}>{c.club}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}
