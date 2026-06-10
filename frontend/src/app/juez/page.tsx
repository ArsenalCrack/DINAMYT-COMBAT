"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { misTatamisAPI, verificarPinAPI, type UserData } from "@/lib/api";

interface MiTatami {
  id: number;
  numero: number;
  campeonato_id: number;
  campeonato_nombre?: string;
  mi_rol: string;
}

export default function JuezPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserData | null>(null);
  const [tatamis, setTatamis] = useState<MiTatami[]>([]);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem("dinamyt_user");
    if (!saved) { router.replace("/login"); return; }
    const u = JSON.parse(saved);
    setUser(u);
    loadTatamis();
  }, [router]);

  async function loadTatamis() {
    try {
      const data = await misTatamisAPI();
      setTatamis(data);
    } catch { /* */ }
  }

  async function handlePinAccess(e: React.FormEvent) {
    e.preventDefault();
    setPinError("");
    try {
      const data = await verificarPinAPI(pin);
      router.push(`/tatami/${data.tatami.id}?rol=j1`);
    } catch {
      setPinError("PIN invalido o tatami inactivo");
    }
  }

  function handleLogout() {
    localStorage.removeItem("dinamyt_token");
    localStorage.removeItem("dinamyt_user");
    router.replace("/login");
  }

  if (!user) return null;

  const ROLES: Record<string, string> = {
    arbitro: "Juez Central",
    j1: "Juez Esquina 1",
    j2: "Juez Esquina 2",
    j3: "Juez Esquina 3",
    j4: "Juez Esquina 4",
  };

  return (
    <div style={{ maxWidth: 540, margin: "0 auto", padding: "20px" }}>
      {/* Header */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        marginBottom: 24, paddingBottom: 16, borderBottom: "1px solid var(--border)"
      }}>
        <div>
          <div className="logo" style={{ fontSize: "1.8rem", textAlign: "left" }}>DINA<em>MYT</em></div>
          <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginTop: 2 }}>
            Bienvenido, {user.nombre}
          </p>
        </div>
        <button className="btn" onClick={handleLogout} style={{ fontSize: "0.8rem" }}>Salir</button>
      </div>

      {/* My tatamis */}
      <div className="card-title">Mis Tatamis Asignados</div>
      {tatamis.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
          {tatamis.map((t) => (
            <div
              key={t.id}
              className="card"
              style={{ cursor: "pointer" }}
              onClick={() => router.push(`/tatami/${t.id}?rol=${t.mi_rol}`)}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <span style={{ fontWeight: 700, fontSize: "1.1rem" }}>
                    Tatami {t.numero}
                  </span>
                  {t.campeonato_nombre && (
                    <span style={{ color: "var(--text-muted)", marginLeft: 8, fontSize: "0.85rem" }}>
                      {t.campeonato_nombre}
                    </span>
                  )}
                </div>
                <span style={{
                  padding: "4px 10px", borderRadius: "var(--radius-sm)", fontSize: "0.75rem",
                  fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em",
                  background: t.mi_rol === "arbitro" ? "var(--gold-bg)" : "var(--chung-bg)",
                  color: t.mi_rol === "arbitro" ? "var(--gold)" : "var(--chung-light)",
                  border: `1px solid ${t.mi_rol === "arbitro" ? "var(--gold-border)" : "var(--chung-border)"}`,
                }}>{ROLES[t.mi_rol] || t.mi_rol}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card" style={{ textAlign: "center", padding: 32, color: "var(--text-dim)", marginBottom: 24 }}>
          No tienes tatamis asignados. Usa un PIN para acceder.
        </div>
      )}

      {/* PIN Access */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-title">Acceso por PIN</div>
        <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: 12 }}>
          Ingresa el PIN de 4 digitos del tatami para acceder directamente.
        </p>
        <form onSubmit={handlePinAccess} style={{ display: "flex", gap: 8 }}>
          <input
            className="input"
            placeholder="PIN (4 digitos)"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
            maxLength={4}
            style={{ fontFamily: "var(--font-mono)", fontSize: "1.2rem", textAlign: "center", letterSpacing: "0.3em" }}
          />
          <button type="submit" className="btn btn-primary" disabled={pin.length < 4}>
            Ir
          </button>
        </form>
        {pinError && (
          <p style={{ color: "var(--red-alert)", fontSize: "0.85rem", marginTop: 8 }} className="animate-fade">
            {pinError}
          </p>
        )}
      </div>

      {/* Quick role selection if coming via PIN */}
      <div style={{ textAlign: "center", marginTop: 16 }}>
        <p style={{ color: "var(--text-dim)", fontSize: "0.8rem" }}>
          DINAMYT v4.0 &middot; Global Hapkido Alliance
        </p>
      </div>
    </div>
  );
}
