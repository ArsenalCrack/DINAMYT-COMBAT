"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function PantallaAccess() {
  const router = useRouter();
  const [tatamiId, setTatamiId] = useState("");

  function handleGo(e: React.FormEvent) {
    e.preventDefault();
    if (tatamiId) {
      router.push(`/tatami/${tatamiId}?rol=pantalla`);
    }
  }

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", minHeight: "100vh", padding: 20
    }}>
      <div style={{
        width: "100%", maxWidth: 400, background: "var(--bg-card)",
        border: "1px solid var(--border)", borderRadius: "var(--radius-lg)",
        padding: "40px 32px", textAlign: "center"
      }} className="animate-slide">
        <div className="logo" style={{ fontSize: "2.5rem", marginBottom: 4 }}>DINA<em>MYT</em></div>
        <p style={{ color: "var(--text-muted)", marginBottom: 24, fontSize: "0.9rem" }}>
          Pantalla Publica &middot; Sin Login
        </p>

        <form onSubmit={handleGo} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ textAlign: "left" }}>
            <label style={{
              fontSize: "0.8rem", fontWeight: 700, textTransform: "uppercase",
              letterSpacing: "0.08em", color: "var(--text-muted)"
            }}>ID del Tatami</label>
            <input
              className="input"
              type="number"
              min={1}
              placeholder="Ej: 1"
              value={tatamiId}
              onChange={(e) => setTatamiId(e.target.value)}
              required
              style={{ marginTop: 6, textAlign: "center", fontFamily: "var(--font-mono)", fontSize: "1.5rem" }}
            />
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: "100%", padding: 14 }}>
            Ver Pantalla
          </button>
        </form>

        <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
          <button onClick={() => router.push("/login")}
            style={{
              background: "none", border: "none", color: "var(--gold)",
              cursor: "pointer", fontSize: "0.85rem", fontFamily: "var(--font-body)"
            }}>
            Iniciar sesion como juez
          </button>
        </div>
      </div>
    </div>
  );
}
