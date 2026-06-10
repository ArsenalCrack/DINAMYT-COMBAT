"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import {
  getCampeonatoAPI,
  listUsersAPI,
  getTatamiAPI,
  asignarJuezAPI,
  desasignarJuezAPI,
  type UserData,
} from "@/lib/api";

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

  async function loadTatamiDetail(tId: number) {
    try {
      const t = await getTatamiAPI(tId);
      setSelectedTatami(t);
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
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "20px" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <button className="btn" onClick={() => router.push("/admin")}
            style={{ marginBottom: 8, fontSize: "0.8rem" }}>&larr; Volver</button>
          <h1 style={{ fontWeight: 700, fontSize: "1.4rem" }}>{camp.nombre}</h1>
          <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
            {camp.tatamis?.length || 0} tatamis &middot; {camp.activo ? "Activo" : "Inactivo"}
          </p>
        </div>
      </div>

      {msg && (
        <div style={{
          background: "var(--green-bg)", border: "1px solid rgba(0,196,106,.25)",
          borderRadius: "var(--radius-sm)", padding: "10px 16px", color: "var(--green)",
          marginBottom: 16, fontSize: "0.9rem"
        }} className="animate-fade">{msg}</div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Tatamis list */}
        <div>
          <div className="card-title">Tatamis</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {camp.tatamis?.map((t) => (
              <div
                key={t.id}
                className="card"
                style={{
                  cursor: "pointer",
                  borderColor: selectedTatami?.id === t.id ? "var(--gold)" : undefined,
                }}
                onClick={() => loadTatamiDetail(t.id)}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <span style={{ fontWeight: 700, fontSize: "1.1rem" }}>Tatami {t.numero}</span>
                    {t.pin && (
                      <span style={{
                        marginLeft: 8, padding: "2px 8px",
                        background: "var(--gold-bg)", border: "1px solid var(--gold-border)",
                        borderRadius: "var(--radius-sm)", fontSize: "0.75rem", fontFamily: "var(--font-mono)",
                        color: "var(--gold)",
                      }}>PIN: {t.pin}</span>
                    )}
                  </div>
                  <span style={{ color: "var(--text-dim)", fontSize: "0.8rem" }}>
                    {t.num_asignaciones} jueces
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Tatami detail */}
        <div>
          {selectedTatami ? (
            <div className="animate-fade">
              <div className="card-title">
                Tatami {selectedTatami.numero} &middot; Asignaciones
              </div>

              {/* Current assignments */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                {selectedTatami.asignaciones?.map((a) => (
                  <div key={a.id} className="card" style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center", padding: 12
                  }}>
                    <div>
                      <div>
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
                      className="btn btn-danger"
                      style={{ padding: "4px 10px", fontSize: "0.75rem" }}
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
                    <option value="j5">Juez Esquina 5</option>
                    <option value="j6">Juez Esquina 6</option>
                    <option value="j7">Juez Esquina 7</option>
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
              <div style={{ marginTop: 16, textAlign: "center" }}>
                <button className="btn btn-primary" style={{ width: "100%" }}
                  onClick={() => router.push(`/tatami/${selectedTatami.id}?rol=arbitro`)}>
                  Abrir como Juez Central
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
    </div>
  );
}
