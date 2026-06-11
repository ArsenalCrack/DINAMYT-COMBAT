"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import {
  getCampeonatoAPI,
  listUsersAPI,
  getTatamiAPI,
  asignarJuezAPI,
  desasignarJuezAPI,
  updateCampeonatoAPI,
  deleteCampeonatoAPI,
  regenerarPinAPI,
  type UserData,
} from "@/lib/api";
import LlavesSection from "@/components/LlavesSection";

interface Tatami {
  id: number;
  numero: number;
  activo: boolean;
  pin?: string;
  num_asignaciones: number;
  asignaciones?: Asignacion[];
}

interface Asignacion {
  id: number;
  usuario_id: number;
  tatami_id: number;
  rol_tatami: string;
  nombre_display: string;
  asignado_at?: string;
  asignado_por?: { id: number; nombre: string; email: string } | null;
  usuario?: UserData;
}

interface Campeonato {
  id: number;
  nombre: string;
  descripcion: string;
  activo: boolean;
  tatamis: Tatami[];
}

export default function CampeonatoDetailPage() {
  const router = useRouter();
  const params = useParams();
  const campId = Number(params.id);

  const [camp, setCamp] = useState<Campeonato | null>(null);
  const [users, setUsers] = useState<UserData[]>([]);
  const [selectedTatami, setSelectedTatami] = useState<Tatami | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [assignData, setAssignData] = useState({ usuario_id: 0, rol_tatami: "j1" });
  const [judgeSearch, setJudgeSearch] = useState("");
  const [msg, setMsg] = useState("");
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState({ nombre: "", descripcion: "" });

  const loadData = useCallback(async () => {
    try {
      const [c, u] = await Promise.all([getCampeonatoAPI(campId), listUsersAPI()]);
      setCamp(c);
      setUsers(u.filter((x: UserData) => x.rol === "juez"));
    } catch { router.replace("/admin"); }
  }, [campId, router]);

  useEffect(() => {
    const saved = localStorage.getItem("dinamyt_user");
    if (!saved || JSON.parse(saved).rol !== "admin") {
      router.replace("/login"); return;
    }
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void loadData();
    });
    return () => { cancelled = true; };
  }, [loadData, router]);

  const detailRef = useRef<HTMLDivElement | null>(null);

  async function loadTatamiDetail(tId: number) {
    try {
      const t = await getTatamiAPI(tId);
      setSelectedTatami(t);
      // En móvil (una sola columna) llevar el detalle a la vista
      if (typeof window !== "undefined" && window.innerWidth <= 820) {
        setTimeout(() => {
          detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 60);
      }
    } catch { /* */ }
  }

  async function handleAssign(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedTatami || !assignData.usuario_id) return;
    try {
      await asignarJuezAPI(selectedTatami.id, assignData);
      setMsg("Juez asignado correctamente");
      setAssigning(false);
      setAssignData({ usuario_id: 0, rol_tatami: "j1" });
      setJudgeSearch("");
      await Promise.all([loadData(), loadTatamiDetail(selectedTatami.id)]);
      setTimeout(() => setMsg(""), 3000);
    } catch (err) {
      const errorMsg = (err as { response?: { data?: { error?: string } } })
        .response?.data?.error;
      setMsg(errorMsg || "Error al asignar juez");
    }
  }

  async function handleUnassign(tatamiId: number, userId: number) {
    try {
      await desasignarJuezAPI(tatamiId, userId);
      await Promise.all([loadData(), loadTatamiDetail(tatamiId)]);
    } catch { /* */ }
  }

  function flash(texto: string) {
    setMsg(texto);
    setTimeout(() => setMsg(""), 3500);
  }

  async function handleToggleActivo() {
    if (!camp) return;
    try {
      await updateCampeonatoAPI(camp.id, { activo: !camp.activo });
      await loadData();
      flash(camp.activo
        ? "Campeonato desactivado: el público ya no lo verá."
        : "Campeonato activado: visible para el público.");
    } catch { flash("Error al cambiar el estado del campeonato"); }
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!camp || !editData.nombre.trim()) return;
    try {
      await updateCampeonatoAPI(camp.id, {
        nombre: editData.nombre.trim(),
        descripcion: editData.descripcion.trim(),
      });
      setEditing(false);
      await loadData();
      flash("Campeonato actualizado");
    } catch { flash("Error al actualizar el campeonato"); }
  }

  async function handleDeleteCampeonato() {
    if (!camp) return;
    const ok = window.confirm(
      `¿Eliminar el campeonato "${camp.nombre}"? Se eliminarán sus tatamis, asignaciones y llaves. Los combates guardados en reportes NO se podrán filtrar por este campeonato.`
    );
    if (!ok) return;
    try {
      await deleteCampeonatoAPI(camp.id);
      router.replace("/admin");
    } catch { flash("Error al eliminar el campeonato"); }
  }

  async function handleRegenerarPin(tatamiId: number) {
    const ok = window.confirm(
      "¿Generar un PIN nuevo para este tatami? El PIN anterior dejará de funcionar."
    );
    if (!ok) return;
    try {
      const res = await regenerarPinAPI(tatamiId);
      await Promise.all([loadData(), loadTatamiDetail(tatamiId)]);
      flash(`Nuevo PIN: ${res.pin}`);
    } catch { flash("Error al regenerar el PIN"); }
  }

  const searchTerm = judgeSearch.trim().toLowerCase();
  const availableJudges = users.filter((u) => {
    if (!u.activo || u.rol !== "juez") return false;
    if ((u.asignaciones?.length || 0) > 0) return false;
    if (!searchTerm) return true;
    return `${u.nombre} ${u.email}`.toLowerCase().includes(searchTerm);
  });
  const selectedJudge = users.find((u) => u.id === assignData.usuario_id);

  if (!camp) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}>
      <div className="logo animate-fade">Cargando...</div>
    </div>
  );

  return (
    <div className="campeonato-admin-page" style={{ maxWidth: 960, margin: "0 auto", padding: "20px" }}>
      {/* Header */}
      <div className="campeonato-admin-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 24 }}>
        <div style={{ minWidth: 0 }}>
          <button className="btn btn-sm" onClick={() => router.push("/admin")}
            style={{ marginBottom: 8, fontSize: "0.8rem" }}>&larr; Volver</button>
          <h1 style={{ fontWeight: 700, fontSize: "1.4rem", overflowWrap: "anywhere" }}>{camp.nombre}</h1>
          <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
            {camp.tatamis?.length || 0} tatamis &middot;{" "}
            <span style={{ color: camp.activo ? "var(--green)" : "var(--orange)", fontWeight: 700 }}>
              {camp.activo ? "Activo (visible al público)" : "Inactivo (oculto al público)"}
            </span>
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            className="btn btn-sm"
            onClick={() => router.push(`/admin/campeonato/${camp.id}/reportes`)}
            style={{
              background: "rgba(0, 212, 114, 0.10)",
              borderColor: "rgba(0, 212, 114, 0.30)",
              color: "var(--green)",
            }}
          >
            Reportes
          </button>
          <button
            className="btn btn-sm"
            onClick={() => {
              setEditData({ nombre: camp.nombre, descripcion: camp.descripcion || "" });
              setEditing(!editing);
            }}
          >
            Editar
          </button>
          <button
            className={`btn btn-sm ${camp.activo ? "btn-danger" : "btn-primary"}`}
            onClick={handleToggleActivo}
          >
            {camp.activo ? "Desactivar" : "Activar"}
          </button>
          <button className="btn btn-sm btn-danger" onClick={handleDeleteCampeonato}>
            Eliminar
          </button>
        </div>
      </div>

      {editing && (
        <form onSubmit={handleSaveEdit} className="card animate-slide"
          style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
          <div className="card-title">Editar Campeonato</div>
          <input className="input" placeholder="Nombre del campeonato" value={editData.nombre}
            onChange={(e) => setEditData({ ...editData, nombre: e.target.value })} required />
          <input className="input" placeholder="Descripción (opcional)" value={editData.descripcion}
            onChange={(e) => setEditData({ ...editData, descripcion: e.target.value })} />
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" className="btn btn-primary">Guardar</button>
            <button type="button" className="btn" onClick={() => setEditing(false)}>Cancelar</button>
          </div>
        </form>
      )}

      {msg && (
        <div style={{
          background: "var(--green-bg)", border: "1px solid rgba(0,196,106,.25)",
          borderRadius: "var(--radius-sm)", padding: "10px 16px", color: "var(--green)",
          marginBottom: 16, fontSize: "0.9rem"
        }} className="animate-fade">{msg}</div>
      )}

      <div className="campeonato-admin-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Tatamis list */}
        <div>
          <div className="card-title">Tatamis</div>
          <div className="tatami-list">
            {camp.tatamis?.map((t) => (
              <button
                key={t.id}
                type="button"
                className="card tatami-card"
                style={{
                  cursor: "pointer",
                  textAlign: "left",
                  font: "inherit",
                  color: "inherit",
                  width: "100%",
                  borderColor: selectedTatami?.id === t.id ? "var(--gold)" : undefined,
                  background: selectedTatami?.id === t.id ? "rgba(240,184,0,0.06)" : undefined,
                }}
                onClick={() => loadTatamiDetail(t.id)}
                aria-pressed={selectedTatami?.id === t.id}
              >
                <div className="tatami-card-row">
                  <span style={{ fontWeight: 700, fontSize: "1.05rem" }}>Tatami {t.numero}</span>
                  <span style={{ color: "var(--text-dim)", fontSize: "0.78rem", whiteSpace: "nowrap" }}>
                    {t.num_asignaciones} jueces
                  </span>
                </div>
                {t.pin && (
                  <span style={{
                    display: "inline-block", marginTop: 6, padding: "2px 8px",
                    background: "var(--gold-bg)", border: "1px solid var(--gold-border)",
                    borderRadius: "var(--radius-sm)", fontSize: "0.75rem", fontFamily: "var(--font-mono)",
                    color: "var(--gold)",
                  }}>PIN: {t.pin}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Tatami detail */}
        <div ref={detailRef} style={{ scrollMarginTop: 12 }}>
          {selectedTatami ? (
            <div className="animate-fade">
              <div className="card-title">
                Tatami {selectedTatami.numero} &middot; Asignaciones
              </div>

              {/* Current assignments */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                {selectedTatami.asignaciones?.map((a) => (
                  <div key={a.id} className="card asignacion-row" style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: 12, gap: 10, flexWrap: "wrap",
                  }}>
                    <div style={{ minWidth: 0, flex: "1 1 200px" }}>
                      <div style={{ overflowWrap: "anywhere" }}>
                        <span style={{ fontWeight: 700 }}>{a.nombre_display || a.usuario?.nombre}</span>
                        {a.usuario?.email && (
                          <span style={{ color: "var(--text-muted)", marginLeft: 8, fontSize: "0.78rem" }}>
                            {a.usuario.email}
                          </span>
                        )}
                      </div>
                      <span style={{
                        marginTop: 4, display: "inline-block", padding: "2px 8px", borderRadius: "var(--radius-sm)",
                        fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase",
                        background: "var(--chung-bg)", color: "var(--chung-light)",
                        border: "1px solid var(--chung-border)",
                      }}>{a.rol_tatami}</span>
                      <div style={{ color: "var(--text-dim)", fontSize: "0.72rem", marginTop: 4 }}>
                        Asignado {a.asignado_at ? new Date(a.asignado_at).toLocaleDateString("es-CO") : "—"}
                        {a.asignado_por ? ` por ${a.asignado_por.nombre}` : ""}
                      </div>
                    </div>
                    <button
                      className="btn btn-danger btn-sm"
                      style={{ padding: "6px 12px", fontSize: "0.75rem", flexShrink: 0 }}
                      onClick={() => handleUnassign(selectedTatami.id, a.usuario_id)}
                    >Quitar</button>
                  </div>
                ))}
                {(!selectedTatami.asignaciones || selectedTatami.asignaciones.length === 0) && (
                  <p style={{ color: "var(--text-dim)", fontSize: "0.85rem", textAlign: "center", padding: 20 }}>
                    Sin jueces asignados
                  </p>
                )}
              </div>

              {/* Assign form */}
              {assigning ? (
                <form onSubmit={handleAssign} className="card animate-slide" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <input
                    className="input"
                    placeholder="Buscar juez por nombre o correo"
                    value={judgeSearch}
                    onChange={(e) => {
                      setJudgeSearch(e.target.value);
                      setAssignData({ ...assignData, usuario_id: 0 });
                    }}
                  />
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 180, overflowY: "auto" }}>
                    {selectedJudge && (
                      <div style={{
                        padding: "8px 10px", border: "1px solid var(--green-border)",
                        borderRadius: "var(--radius-sm)", color: "var(--green)", fontSize: "0.82rem",
                        fontWeight: 700,
                      }}>
                        Seleccionado: {selectedJudge.nombre} ({selectedJudge.email})
                      </div>
                    )}
                    {availableJudges.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        className="btn"
                        onClick={() => {
                          setAssignData({ ...assignData, usuario_id: u.id });
                          setJudgeSearch(`${u.nombre} ${u.email}`);
                        }}
                        style={{ justifyContent: "flex-start", textAlign: "left", padding: "8px 10px" }}
                      >
                        <span style={{ fontWeight: 700 }}>{u.nombre}</span>
                        <span style={{ color: "var(--text-muted)", marginLeft: 8, fontSize: "0.8rem" }}>{u.email}</span>
                      </button>
                    ))}
                    {availableJudges.length === 0 && !selectedJudge && (
                      <div style={{ color: "var(--text-dim)", fontSize: "0.82rem", padding: "8px 4px" }}>
                        No hay jueces disponibles con esa búsqueda.
                      </div>
                    )}
                  </div>
                  <select className="input" value={assignData.rol_tatami}
                    onChange={(e) => setAssignData({ ...assignData, rol_tatami: e.target.value })}>
                    <option value="arbitro">Juez Central</option>
                    <option value="j1">Juez Esquina 1</option>
                    <option value="j2">Juez Esquina 2</option>
                    <option value="j3">Juez Esquina 3</option>
                    <option value="j4">Juez Esquina 4</option>
                  </select>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button type="submit" className="btn btn-primary" disabled={!assignData.usuario_id}>Asignar</button>
                    <button type="button" className="btn" onClick={() => {
                      setAssigning(false);
                      setAssignData({ usuario_id: 0, rol_tatami: "j1" });
                      setJudgeSearch("");
                    }}>Cancelar</button>
                  </div>
                </form>
              ) : (
                <button className="btn btn-primary" style={{ width: "100%" }}
                  onClick={() => {
                    setAssignData({ usuario_id: 0, rol_tatami: "j1" });
                    setJudgeSearch("");
                    setAssigning(true);
                  }}>
                  + Asignar Juez
                </button>
              )}

              {/* Open tatami link */}
              <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                <button className="btn btn-primary" style={{ width: "100%" }}
                  onClick={() => router.push(`/tatami/${selectedTatami.id}?rol=arbitro`)}>
                  Abrir como Juez Central
                </button>
                <button className="btn btn-sm" style={{ width: "100%" }}
                  onClick={() => handleRegenerarPin(selectedTatami.id)}>
                  Regenerar PIN del tatami
                </button>
              </div>
            </div>
          ) : (
            <div className="card" style={{ textAlign: "center", padding: 40, color: "var(--text-dim)" }}>
              Selecciona un tatami para ver sus asignaciones
            </div>
          )}
        </div>
      </div>

      {/* Llaves de eliminación del campeonato */}
      <LlavesSection campeonatoId={campId} />

      <style>{`
        .campeonato-admin-grid {
          align-items: start;
        }
        .tatami-list {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
          gap: 8px;
        }
        .tatami-card {
          padding: 12px 14px;
          min-height: var(--touch-min);
        }
        .tatami-card:hover {
          border-color: var(--gold-border);
          background: var(--bg-elevated);
        }
        .tatami-card-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
        }
        @media (max-width: 820px) {
          .campeonato-admin-page {
            padding: 14px !important;
          }
          .campeonato-admin-header {
            align-items: flex-start !important;
            gap: 12px;
            flex-wrap: wrap;
          }
          .campeonato-admin-grid {
            grid-template-columns: 1fr !important;
          }
          .tatami-list {
            grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
          }
        }
        @media (max-width: 520px) {
          .campeonato-admin-grid .card {
            padding: 12px !important;
          }
          .campeonato-admin-grid .btn {
            white-space: normal;
          }
          .tatami-list {
            grid-template-columns: 1fr 1fr;
          }
          .asignacion-row > div:first-child {
            flex-basis: 100%;
          }
          .asignacion-row .btn {
            margin-left: auto;
          }
        }
        @media (max-width: 360px) {
          .tatami-list {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}
