"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  listCampeonatosAPI,
  createCampeonatoAPI,
  updateCampeonatoAPI,
  listUsersAPI,
  registerUserAPI,
  updateUserAPI,
  type UserData,
} from "@/lib/api";
import LogoutButton from "@/components/LogoutButton";
import { useConfirmDialog } from "@/components/ConfirmDialog";
import Logo from "@/components/Logo";

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
  const [msg, setMsg] = useState<{ texto: string; tipo: "ok" | "error" } | null>(null);
  const [userSearch, setUserSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [creandoCamp, setCreandoCamp] = useState(false);
  const [editingUser, setEditingUser] = useState<UserData | null>(null);
  const [editUserData, setEditUserData] = useState({ nombre: "", email: "", password: "", rol: "juez" });
  const { pedirConfirmacion, dialogo } = useConfirmDialog();

  useEffect(() => {
    const saved = localStorage.getItem("dinamyt_user");
    if (!saved) { router.replace("/login"); return; }
    const u = JSON.parse(saved);
    if (u.rol !== "admin") { router.replace("/juez"); return; }
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setUser(u);
      void loadData(showInactive);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, showInactive]);

  async function loadData(includeInactive = false) {
    try {
      const [c, u] = await Promise.all([
        listCampeonatosAPI(),
        listUsersAPI(includeInactive),
      ]);
      setCampeonatos(c);
      setUsers(u);
    } catch { /* */ }
  }

  function flash(texto: string, tipo: "ok" | "error" = "ok") {
    setMsg({ texto, tipo });
    setTimeout(() => setMsg(null), 3500);
  }

  async function handleToggleCampActivo(c: Campeonato) {
    try {
      await updateCampeonatoAPI(c.id, { activo: !c.activo });
      await loadData(showInactive);
      flash(c.activo
        ? `"${c.nombre}" desactivado: el público ya no lo verá.`
        : `"${c.nombre}" activado: visible para el público.`, "ok");
    } catch { flash("Error al cambiar el estado del campeonato", "error"); }
  }

  async function handleSaveUserEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingUser) return;
    const payload: { nombre?: string; email?: string; password?: string; rol?: string } = {};
    if (editUserData.nombre.trim()) payload.nombre = editUserData.nombre.trim();
    if (editUserData.email.trim()) payload.email = editUserData.email.trim();
    if (editUserData.password) payload.password = editUserData.password;
    if (editUserData.rol && editUserData.rol !== editingUser.rol) payload.rol = editUserData.rol;
    try {
      await updateUserAPI(editingUser.id, payload);
      setEditingUser(null);
      await loadData(showInactive);
      flash("Usuario actualizado correctamente", "ok");
    } catch (err) {
      const m = (err as { response?: { data?: { error?: string } } }).response?.data?.error;
      flash(m || "Error al actualizar el usuario", "error");
    }
  }

  function handleToggleUserActivo(target: UserData) {
    if (target.id === user?.id) {
      flash("No puedes desactivar tu propio usuario", "error");
      return;
    }
    const ejecutar = async () => {
      try {
        await updateUserAPI(target.id, { activo: !target.activo });
        await loadData(showInactive);
        flash(target.activo ? "Usuario desactivado" : "Usuario reactivado", "ok");
      } catch { flash("Error al cambiar el estado del usuario", "error"); }
    };
    if (target.activo) {
      pedirConfirmacion({
        titulo: "Desactivar usuario",
        mensaje: `¿Desactivar a ${target.nombre}? No podrá iniciar sesión y se quitarán sus asignaciones de tatami.`,
        tipo: "peligro",
        confirmLabel: "Desactivar",
        onConfirm: ejecutar,
      });
    } else {
      void ejecutar();
    }
  }

  async function handleCreateCamp(e: React.FormEvent) {
    e.preventDefault();
    if (creandoCamp) return;
    setCreandoCamp(true);
    try {
      await createCampeonatoAPI(newCamp);
      setShowNewCamp(false);
      setNewCamp({ nombre: "", descripcion: "", num_tatamis: 6 });
      loadData(showInactive);
      flash("Campeonato creado exitosamente", "ok");
    } catch {
      flash("Error al crear el campeonato. Si el servidor estaba dormido puede tardar ~1 min en despertar: revisa la lista antes de reintentar.", "error");
      loadData(showInactive);
    } finally {
      setCreandoCamp(false);
    }
  }

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    try {
      await registerUserAPI(newUser);
      setShowNewUser(false);
      setNewUser({ email: "", password: "", nombre: "", rol: "juez" });
      loadData(showInactive);
      flash("Usuario creado exitosamente", "ok");
    } catch (err) {
      const m = (err as { response?: { data?: { error?: string } } }).response?.data?.error;
      flash(m || "Error al crear el usuario", "error");
    }
  }

  if (!user) return null;

  return (
    <div className="admin-page" style={{ maxWidth: 960, margin: "0 auto", padding: "20px" }}>
      {/* Header */}
      <div className="admin-header" style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        marginBottom: 24, paddingBottom: 16, borderBottom: "1px solid var(--border)"
      }}>
        <div>
          <Logo fontSize="1.8rem" />
          <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginTop: 2 }}>
            Panel de Administracion &middot; {user.nombre}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <LogoutButton />
        </div>
      </div>

      {/* Mensajes: verde = satisfactorio, rojo = no se pudo realizar */}
      {msg && (
        <div role={msg.tipo === "error" ? "alert" : "status"} style={{
          background: msg.tipo === "error" ? "rgba(255,68,68,0.10)" : "var(--green-bg)",
          border: `1px solid ${msg.tipo === "error" ? "rgba(255,68,68,0.35)" : "rgba(0,196,106,.25)"}`,
          borderRadius: "var(--radius-sm)", padding: "10px 16px",
          color: msg.tipo === "error" ? "var(--red-alert)" : "var(--green)",
          marginBottom: 16, fontSize: "0.9rem", fontWeight: 700,
        }} className="animate-fade">{msg.texto}</div>
      )}
      {dialogo}

      {/* Tabs */}
      <div className="admin-tabs" style={{ display: "flex", gap: 8, marginBottom: 20 }}>
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
          <div className="admin-section-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
            <h2 style={{ fontFamily: "var(--font-body)", fontWeight: 700, fontSize: "1.1rem", color: "var(--gold)" }}>
              Campeonatos ({campeonatos.length})
            </h2>
            <button className="btn btn-primary btn-sm" onClick={() => setShowNewCamp(!showNewCamp)}>
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
                  <button type="submit" className="btn btn-primary" disabled={creandoCamp}>
                    {creandoCamp ? "Creando…" : "Crear"}
                  </button>
                  <button type="button" className="btn" onClick={() => setShowNewCamp(false)} disabled={creandoCamp}>Cancelar</button>
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
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <h3 style={{ fontWeight: 700, fontSize: "1.05rem", marginBottom: 4 }}>
                        {c.nombre}
                        <span className={`badge ${c.activo ? "badge-green" : "badge-gray"}`} style={{ marginLeft: 8, verticalAlign: "middle" }}>
                          {c.activo ? "Activo" : "Inactivo"}
                        </span>
                      </h3>
                      <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
                        {c.num_tatamis} tatamis
                        {c.descripcion && ` · ${c.descripcion}`}
                        {!c.activo && " · oculto para el público"}
                      </p>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                      <button
                        className={`btn btn-sm ${c.activo ? "btn-danger" : "btn-primary"}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleCampActivo(c);
                        }}
                      >
                        {c.activo ? "Desactivar" : "Activar"}
                      </button>
                      <span style={{ color: "var(--gold)", fontSize: "0.85rem" }}>Ver detalles →</span>
                    </div>
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
          <div className="admin-section-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
            <h2 style={{ fontFamily: "var(--font-body)", fontWeight: 700, fontSize: "1.1rem", color: "var(--gold)" }}>
              Usuarios ({users.length})
            </h2>
            <button className="btn btn-primary btn-sm" onClick={() => setShowNewUser(!showNewUser)}>
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

          {/* Buscador y filtro de inactivos */}
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
            <input
              className="input"
              placeholder="Buscar por nombre o correo..."
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              style={{ flex: "1 1 220px", maxWidth: 380 }}
            />
            <label style={{
              display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
              fontSize: "0.82rem", color: "var(--text-muted)", fontWeight: 700,
              userSelect: "none", whiteSpace: "nowrap",
            }}>
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
                style={{ accentColor: "var(--gold)", width: 16, height: 16 }}
              />
              Mostrar inactivos
            </label>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {users
              .filter((u) => {
                const q = userSearch.trim().toLowerCase();
                if (!q) return true;
                return `${u.nombre} ${u.email}`.toLowerCase().includes(q);
              })
              .map((u) => (
              <div key={u.id}>
                <div className="admin-user-row card" style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  opacity: u.activo ? 1 : 0.55,
                }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ overflowWrap: "anywhere" }}>
                      <span style={{ fontWeight: 700 }}>{u.nombre}</span>
                      <span style={{ color: "var(--text-muted)", marginLeft: 8, fontSize: "0.85rem" }}>{u.email}</span>
                      {!u.activo && (
                        <span className="badge badge-gray" style={{ marginLeft: 8 }}>Inactivo</span>
                      )}
                    </div>
                    <div style={{ color: "var(--text-dim)", fontSize: "0.76rem", marginTop: 4 }}>
                      Agregado {u.created_at ? new Date(u.created_at).toLocaleDateString("es-CO") : "—"}
                      {u.creado_por ? ` por ${u.creado_por.nombre}` : ""}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <span style={{
                      padding: "4px 10px", borderRadius: "var(--radius-sm)", fontSize: "0.75rem",
                      fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em",
                      background: u.rol === "admin" ? "var(--gold-bg)" : "var(--chung-bg)",
                      color: u.rol === "admin" ? "var(--gold)" : "var(--chung-light)",
                      border: `1px solid ${u.rol === "admin" ? "var(--gold-border)" : "var(--chung-border)"}`,
                    }}>{u.rol}</span>
                    <button
                      className="btn btn-sm"
                      onClick={() => {
                        if (editingUser?.id === u.id) {
                          setEditingUser(null);
                        } else {
                          setEditingUser(u);
                          setEditUserData({ nombre: u.nombre, email: u.email, password: "", rol: u.rol });
                        }
                      }}
                      style={{ padding: "4px 10px", fontSize: "0.75rem" }}
                    >
                      {editingUser?.id === u.id ? "Cerrar" : "Editar"}
                    </button>
                    <button
                      className={`btn btn-sm ${u.activo ? "btn-danger" : "btn-primary"}`}
                      onClick={() => handleToggleUserActivo(u)}
                      disabled={u.id === user.id}
                      style={{ padding: "4px 10px", fontSize: "0.75rem" }}
                    >
                      {u.activo ? "Desactivar" : "Reactivar"}
                    </button>
                  </div>
                </div>

                {/* Edición: correo, nombre y restablecer contraseña (solo admin) */}
                {editingUser?.id === u.id && (
                  <form onSubmit={handleSaveUserEdit} className="card animate-slide" style={{
                    display: "flex", flexDirection: "column", gap: 10,
                    marginTop: 6, borderColor: "var(--gold-border)",
                  }}>
                    <div className="card-title">Editar a {u.nombre}</div>
                    <input className="input" placeholder="Nombre completo" value={editUserData.nombre}
                      onChange={(e) => setEditUserData({ ...editUserData, nombre: e.target.value })} />
                    <input className="input" type="email" placeholder="Correo electrónico" value={editUserData.email}
                      onChange={(e) => setEditUserData({ ...editUserData, email: e.target.value })} />
                    <input className="input" type="password" autoComplete="new-password"
                      placeholder="Nueva contraseña (dejar vacío para no cambiarla)"
                      value={editUserData.password}
                      onChange={(e) => setEditUserData({ ...editUserData, password: e.target.value })} />
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <label style={{ color: "var(--text-muted)", fontSize: "0.85rem", whiteSpace: "nowrap" }}>Rol:</label>
                      <select className="input" value={editUserData.rol}
                        disabled={u.id === user.id}
                        onChange={(e) => setEditUserData({ ...editUserData, rol: e.target.value })}>
                        <option value="juez">Juez</option>
                        <option value="admin">Administrador</option>
                      </select>
                    </div>
                    <p style={{ color: "var(--text-dim)", fontSize: "0.76rem", margin: 0 }}>
                      Si el juez olvidó su contraseña, escríbele una nueva aquí y
                      comunícasela: este restablecimiento solo lo puede hacer un administrador.
                      {u.id === user.id
                        ? " No puedes cambiar tu propio rol."
                        : " Al volver administrador a un juez se liberan sus asignaciones de tatami."}
                    </p>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button type="submit" className="btn btn-primary btn-sm">Guardar cambios</button>
                      <button type="button" className="btn btn-sm" onClick={() => setEditingUser(null)}>Cancelar</button>
                    </div>
                  </form>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      <style>{`
        .admin-section-header .btn {
          flex: 0 0 auto;
        }
        @media (max-width: 420px) {
          .admin-section-header {
            flex-direction: column;
            align-items: stretch !important;
          }
          .admin-section-header .btn {
            width: 100%;
          }
        }
        @media (max-width: 640px) {
          .admin-page {
            padding: 14px !important;
          }
          .admin-header {
            align-items: flex-start !important;
            gap: 12px;
            flex-wrap: wrap;
          }
          .admin-tabs {
            overflow-x: auto;
            padding-bottom: 2px;
          }
          .admin-tabs .btn {
            flex: 0 0 auto;
          }
          .admin-user-row {
            align-items: flex-start !important;
            gap: 12px;
            flex-wrap: wrap;
          }
          .admin-user-row > div:last-child {
            width: 100%;
            justify-content: space-between;
          }
        }
      `}</style>
    </div>
  );
}
