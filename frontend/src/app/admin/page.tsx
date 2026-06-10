"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  listCampeonatosAPI,
  createCampeonatoAPI,
  listUsersAPI,
  registerUserAPI,
  deleteUserAPI,
  type UserData,
} from "@/lib/api";

interface Campeonato {
  id: number;
  nombre: string;
  descripcion: string;
  fecha_inicio: string;
  fecha_fin: string;
  activo: boolean;
  num_tatamis: number;
  created_at: string;
}

export default function AdminPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserData | null>(null);
  const [campeonatos, setCampeonatos] = useState<Campeonato[]>([]);
  const [users, setUsers] = useState<UserData[]>([]);
  const [tab, setTab] = useState<"campeonatos" | "jueces">("campeonatos");
  const [showNewCamp, setShowNewCamp] = useState(false);
  const [showNewUser, setShowNewUser] = useState(false);
  const [newCamp, setNewCamp] = useState({ nombre: "", descripcion: "", num_tatamis: 6 });
  const [newUser, setNewUser] = useState({ email: "", password: "", nombre: "", rol: "juez" });
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem("dinamyt_user");
    if (!saved) { router.replace("/login"); return; }
    const u = JSON.parse(saved);
    if (u.rol !== "admin") { router.replace("/juez"); return; }
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setUser(u);
      void loadData();
    });
    return () => { cancelled = true; };
  }, [router]);

  async function loadData() {
    try {
      const [c, u] = await Promise.all([listCampeonatosAPI(), listUsersAPI()]);
      setCampeonatos(c);
      setUsers(u);
    } catch { /* */ }
  }

  async function handleCreateCamp(e: React.FormEvent) {
    e.preventDefault();
    try {
      await createCampeonatoAPI(newCamp);
      setMsg("Campeonato creado exitosamente");
      setShowNewCamp(false);
      setNewCamp({ nombre: "", descripcion: "", num_tatamis: 6 });
      loadData();
      setTimeout(() => setMsg(""), 3000);
    } catch { setMsg("Error al crear campeonato"); }
  }

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    try {
      await registerUserAPI(newUser);
      setMsg("Usuario creado exitosamente");
      setShowNewUser(false);
      setNewUser({ email: "", password: "", nombre: "", rol: "juez" });
      loadData();
      setTimeout(() => setMsg(""), 3000);
    } catch { setMsg("Error al crear usuario"); }
  }

  async function handleDeleteUser(target: UserData) {
    if (target.id === user?.id) {
      setMsg("No puedes quitar tu propio usuario");
      setTimeout(() => setMsg(""), 3000);
      return;
    }
    const ok = window.confirm(`¿Quitar a ${target.nombre} de la aplicación? Se eliminarán sus asignaciones activas.`);
    if (!ok) return;
    try {
      await deleteUserAPI(target.id);
      setMsg("Usuario quitado correctamente");
      loadData();
      setTimeout(() => setMsg(""), 3000);
    } catch {
      setMsg("Error al quitar usuario");
    }
  }

  function handleLogout() {
    localStorage.removeItem("dinamyt_token");
    localStorage.removeItem("dinamyt_user");
    router.replace("/login");
  }

  if (!user) return null;

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "20px" }}>
      {/* Header */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        marginBottom: 24, paddingBottom: 16, borderBottom: "1px solid var(--border)"
      }}>
        <div>
          <div className="logo" style={{ fontSize: "1.8rem", textAlign: "left" }}>DINA<em>MYT</em></div>
          <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginTop: 2 }}>
            Panel de Administracion &middot; {user.nombre}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            className="btn btn-sm"
            onClick={() => router.push("/admin/reportes")}
            style={{
              background: "rgba(0, 212, 114, 0.10)",
              borderColor: "rgba(0, 212, 114, 0.30)",
              color: "var(--green)",
            }}
          >
            Reportes
          </button>
          <button className="btn" onClick={handleLogout}>Cerrar Sesion</button>
        </div>
      </div>

      {/* Success message */}
      {msg && (
        <div style={{
          background: "var(--green-bg)", border: "1px solid rgba(0,196,106,.25)",
          borderRadius: "var(--radius-sm)", padding: "10px 16px", color: "var(--green)",
          marginBottom: 16, fontSize: "0.9rem"
        }} className="animate-fade">{msg}</div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {(["campeonatos", "jueces"] as const).map((t) => (
          <button
            key={t}
            className="btn"
            onClick={() => setTab(t)}
            style={{
              background: tab === t ? "var(--gold-bg)" : undefined,
              borderColor: tab === t ? "var(--gold-border)" : undefined,
              color: tab === t ? "var(--gold)" : undefined,
              textTransform: "capitalize",
            }}
          >
            {t === "campeonatos" ? "Campeonatos" : "Jueces / Usuarios"}
          </button>
        ))}
      </div>

      {/* ══════════════ CAMPEONATOS TAB ══════════════ */}
      {tab === "campeonatos" && (
        <div className="animate-fade">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h2 style={{ fontFamily: "var(--font-body)", fontWeight: 700, fontSize: "1.1rem", color: "var(--gold)" }}>
              Campeonatos ({campeonatos.length})
            </h2>
            <button className="btn btn-primary" onClick={() => setShowNewCamp(!showNewCamp)}>
              + Nuevo Campeonato
            </button>
          </div>

          {showNewCamp && (
            <div className="card animate-slide" style={{ marginBottom: 16 }}>
              <div className="card-title">Crear Campeonato</div>
              <form onSubmit={handleCreateCamp} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <input className="input" placeholder="Nombre del campeonato" value={newCamp.nombre}
                  onChange={(e) => setNewCamp({ ...newCamp, nombre: e.target.value })} required />
                <input className="input" placeholder="Descripcion (opcional)" value={newCamp.descripcion}
                  onChange={(e) => setNewCamp({ ...newCamp, descripcion: e.target.value })} />
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <label style={{ color: "var(--text-muted)", fontSize: "0.85rem", whiteSpace: "nowrap" }}>Tatamis:</label>
                  <input className="input" type="number" min={1} max={20} value={newCamp.num_tatamis}
                    onChange={(e) => setNewCamp({ ...newCamp, num_tatamis: parseInt(e.target.value) || 6 })}
                    style={{ width: 80 }} />
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="submit" className="btn btn-primary">Crear</button>
                  <button type="button" className="btn" onClick={() => setShowNewCamp(false)}>Cancelar</button>
                </div>
              </form>
            </div>
          )}

          {campeonatos.length === 0 ? (
            <div className="card" style={{ textAlign: "center", padding: 40, color: "var(--text-dim)" }}>
              No hay campeonatos creados. Crea uno para empezar.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {campeonatos.map((c) => (
                <div key={c.id} className="card" style={{ cursor: "pointer" }}
                  onClick={() => router.push(`/admin/campeonato/${c.id}`)}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <h3 style={{ fontWeight: 700, fontSize: "1.05rem", marginBottom: 4 }}>{c.nombre}</h3>
                      <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
                        {c.num_tatamis} tatamis &middot; {c.activo ? "Activo" : "Inactivo"}
                        {c.descripcion && ` · ${c.descripcion}`}
                      </p>
                    </div>
                    <span style={{ color: "var(--gold)", fontSize: "0.85rem" }}>Ver detalles →</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══════════════ JUECES TAB ══════════════ */}
      {tab === "jueces" && (
        <div className="animate-fade">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h2 style={{ fontFamily: "var(--font-body)", fontWeight: 700, fontSize: "1.1rem", color: "var(--gold)" }}>
              Usuarios ({users.length})
            </h2>
            <button className="btn btn-primary" onClick={() => setShowNewUser(!showNewUser)}>
              + Crear Usuario
            </button>
          </div>

          {showNewUser && (
            <div className="card animate-slide" style={{ marginBottom: 16 }}>
              <div className="card-title">Crear Usuario</div>
              <form onSubmit={handleCreateUser} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <input className="input" placeholder="Nombre completo" value={newUser.nombre}
                  onChange={(e) => setNewUser({ ...newUser, nombre: e.target.value })} required />
                <input className="input" type="email" placeholder="Correo electronico" value={newUser.email}
                  onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} required />
                <input className="input" type="password" placeholder="Contrasena" value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} required />
                <select className="input" value={newUser.rol}
                  onChange={(e) => setNewUser({ ...newUser, rol: e.target.value })}>
                  <option value="juez">Juez</option>
                  <option value="admin">Administrador</option>
                </select>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="submit" className="btn btn-primary">Crear</button>
                  <button type="button" className="btn" onClick={() => setShowNewUser(false)}>Cancelar</button>
                </div>
              </form>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {users.map((u) => (
              <div key={u.id} className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div>
                    <span style={{ fontWeight: 700 }}>{u.nombre}</span>
                    <span style={{ color: "var(--text-muted)", marginLeft: 8, fontSize: "0.85rem" }}>{u.email}</span>
                  </div>
                  <div style={{ color: "var(--text-dim)", fontSize: "0.76rem", marginTop: 4 }}>
                    Agregado {u.created_at ? new Date(u.created_at).toLocaleDateString("es-CO") : "—"}
                    {u.creado_por ? ` por ${u.creado_por.nombre}` : ""}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{
                    padding: "4px 10px", borderRadius: "var(--radius-sm)", fontSize: "0.75rem",
                    fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em",
                    background: u.rol === "admin" ? "var(--gold-bg)" : "var(--chung-bg)",
                    color: u.rol === "admin" ? "var(--gold)" : "var(--chung-light)",
                    border: `1px solid ${u.rol === "admin" ? "var(--gold-border)" : "var(--chung-border)"}`,
                  }}>{u.rol}</span>
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => handleDeleteUser(u)}
                    disabled={u.id === user.id}
                    style={{ padding: "4px 10px", fontSize: "0.75rem" }}
                  >
                    Quitar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
