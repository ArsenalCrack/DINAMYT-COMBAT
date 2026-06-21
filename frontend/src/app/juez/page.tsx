"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { misTatamisAPI, type UserData } from "@/lib/api";
import Logo from "@/components/Logo";

interface MiTatami {
  id: number;
  numero: number;
  campeonato_id: number;
  campeonato_nombre?: string;
  mi_rol: string;
}

const ROLES: Record<string, string> = {
  arbitro: "Juez Central",
  j1: "Juez Esquina 1",
  j2: "Juez Esquina 2",
  j3: "Juez Esquina 3",
  j4: "Juez Esquina 4",
};

export default function JuezPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserData | null>(null);
  const [tatamis, setTatamis] = useState<MiTatami[]>([]);
  const [cargando, setCargando] = useState(true);
  const [sinConexion, setSinConexion] = useState(false);

  const CACHE_KEY = "dinamyt_mis_tatamis";

  const loadTatamis = useCallback(async () => {
    try {
      const data = await misTatamisAPI();
      setTatamis(data);
      setSinConexion(false);
      // Guardar la última lista conocida: sin conexión el juez debe poder
      // volver a su tatami (si no, queda bloqueado fuera del software).
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch { /* */ }
    } catch {
      // Sin servidor: usar la última lista cacheada para no bloquear al juez.
      try {
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
          setTatamis(JSON.parse(cached));
          setSinConexion(true);
        }
      } catch { /* */ }
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem("dinamyt_user");
    if (!saved) { router.replace("/login"); return; }
    const u = JSON.parse(saved);
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setUser(u);
      void loadTatamis();
    });
    return () => { cancelled = true; };
  }, [loadTatamis, router]);

  if (!user) return null;

  return (
    <div style={{ maxWidth: 540, margin: "0 auto", padding: "20px" }}>
      {/* Header */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        marginBottom: 24, paddingBottom: 16, borderBottom: "1px solid var(--border)"
      }}>
        <div>
          <Logo fontSize="1.8rem" />
          <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginTop: 2 }}>
            Bienvenido, {user.nombre}
          </p>
        </div>
      </div>

      {/* My tatamis */}
      {sinConexion && (
        <div style={{
          marginBottom: 12, padding: "8px 12px", borderRadius: "var(--radius-sm)",
          border: "1px solid var(--red-alert)", background: "rgba(232,0,42,0.08)",
          color: "var(--red-alert)", fontSize: "0.82rem", fontWeight: 700, textAlign: "center",
        }}>
          📴 Sin conexión — mostrando tus tatamis guardados. Toca el tuyo para
          volver a tu pantalla de registro local.
        </div>
      )}
      <div className="card-title">Mis Tatamis Asignados</div>
      {tatamis.length > 0 ? (
        <>
          <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: 12 }}>
            Toca tu tatami para entrar con el rol que te asignó el administrador.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
            {tatamis.map((t) => (
              <div
                key={t.id}
                className="card"
                style={{ cursor: "pointer" }}
                onClick={() => router.push(`/tatami/${t.id}?rol=${t.mi_rol}`)}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0 }}>
                    <span style={{ fontWeight: 700, fontSize: "1.1rem" }}>
                      Tatami {t.numero}
                    </span>
                    {t.campeonato_nombre && (
                      <div style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
                        {t.campeonato_nombre}
                      </div>
                    )}
                    <span style={{
                      display: "inline-block", marginTop: 6,
                      padding: "4px 10px", borderRadius: "var(--radius-sm)", fontSize: "0.75rem",
                      fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em",
                      background: t.mi_rol === "arbitro" ? "var(--gold-bg)" : "var(--chung-bg)",
                      color: t.mi_rol === "arbitro" ? "var(--gold)" : "var(--chung-light)",
                      border: `1px solid ${t.mi_rol === "arbitro" ? "var(--gold-border)" : "var(--chung-border)"}`,
                    }}>{ROLES[t.mi_rol] || t.mi_rol}</span>
                  </div>
                  <button
                    className="btn btn-primary"
                    style={{ flexShrink: 0 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      router.push(`/tatami/${t.id}?rol=${t.mi_rol}`);
                    }}
                  >
                    Entrar →
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="card" style={{ textAlign: "center", padding: 32, color: "var(--text-dim)", marginBottom: 24 }}>
          {cargando ? (
            "Cargando tus asignaciones..."
          ) : (
            <>
              <p style={{ marginBottom: 8, fontWeight: 700, color: "var(--text-muted)" }}>
                Aún no tienes un tatami asignado.
              </p>
              <p style={{ fontSize: "0.85rem", margin: 0 }}>
                Pide al administrador del campeonato que te asigne a un tatami
                con tu rol de juez. Cuando lo haga, aparecerá aquí — recarga la
                página o vuelve a entrar.
              </p>
            </>
          )}
        </div>
      )}

      <div style={{ textAlign: "center", marginTop: 16 }}>
        <p style={{ color: "var(--text-dim)", fontSize: "0.8rem" }}>
          DINAMYT v4.0 &middot; Global Hapkido Association
        </p>
      </div>
    </div>
  );
}
