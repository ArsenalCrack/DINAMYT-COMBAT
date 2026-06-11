"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { listCampeonatosPublicoAPI } from "@/lib/api";
import Logo from "@/components/Logo";

interface TatamiPublico {
  id: number;
  numero: number;
}

interface CampeonatoPublico {
  id: number;
  nombre: string;
  tatamis: TatamiPublico[];
}

export default function PantallaAccess() {
  const router = useRouter();
  const [campeonatos, setCampeonatos] = useState<CampeonatoPublico[]>([]);
  const [campId, setCampId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(async () => {
      try {
        const data = await listCampeonatosPublicoAPI();
        if (cancelled) return;
        setCampeonatos(data);
        // Si solo hay un campeonato activo, seleccionarlo de una vez
        if (data.length === 1) setCampId(data[0].id);
      } catch {
        if (!cancelled) setError("No se pudo conectar con el servidor.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

  const campSeleccionado = campeonatos.find((c) => c.id === campId) || null;

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", minHeight: "100vh", padding: 20
    }}>
      <div style={{
        width: "100%", maxWidth: 460, background: "var(--bg-card)",
        border: "1px solid var(--border)", borderRadius: "var(--radius-lg)",
        padding: "36px 28px", textAlign: "center"
      }} className="animate-slide">
        <Logo stacked fontSize="clamp(1.8rem, 6vw, 2.2rem)" style={{ marginBottom: 8 }} />
        <p style={{ color: "var(--text-muted)", marginBottom: 24, fontSize: "0.9rem" }}>
          Pantalla Publica &middot; Sin Login
        </p>

        {loading ? (
          <p className="animate-shimmer" style={{ color: "var(--text-muted)", padding: "20px 0" }}>
            Cargando campeonatos...
          </p>
        ) : error ? (
          <p style={{ color: "var(--red-alert)", padding: "12px 0", fontWeight: 700 }}>{error}</p>
        ) : campeonatos.length === 0 ? (
          <p style={{ color: "var(--text-dim)", padding: "16px 0" }}>
            No hay campeonatos activos en este momento.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16, textAlign: "left" }}>
            {/* Paso 1: Campeonato */}
            <div>
              <label style={{
                fontSize: "0.78rem", fontWeight: 800, textTransform: "uppercase",
                letterSpacing: "0.08em", color: "var(--text-muted)",
                display: "block", marginBottom: 6,
              }}>1. Campeonato</label>
              {campeonatos.length === 1 ? (
                <div style={{
                  padding: "12px 14px", borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--gold-border)", background: "var(--gold-bg)",
                  color: "var(--gold)", fontWeight: 700,
                }}>
                  {campeonatos[0].nombre}
                </div>
              ) : (
                <select
                  className="input"
                  value={campId ?? ""}
                  onChange={(e) => setCampId(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Selecciona el campeonato</option>
                  {campeonatos.map((c) => (
                    <option key={c.id} value={c.id}>{c.nombre}</option>
                  ))}
                </select>
              )}
            </div>

            {/* Paso 2: Tatami */}
            {campSeleccionado && (
              <div className="animate-fade">
                <label style={{
                  fontSize: "0.78rem", fontWeight: 800, textTransform: "uppercase",
                  letterSpacing: "0.08em", color: "var(--text-muted)",
                  display: "block", marginBottom: 6,
                }}>2. Tatami</label>
                {campSeleccionado.tatamis.length === 0 ? (
                  <p style={{ color: "var(--text-dim)", fontSize: "0.85rem" }}>
                    Este campeonato no tiene tatamis activos.
                  </p>
                ) : (
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))",
                    gap: 8,
                  }}>
                    {campSeleccionado.tatamis.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        className="btn"
                        onClick={() => router.push(`/tatami/${t.id}?rol=pantalla`)}
                        style={{
                          flexDirection: "column", gap: 2, minHeight: 64,
                          borderColor: "var(--chung-border)",
                        }}
                      >
                        <span style={{
                          fontFamily: "var(--font-display)", fontSize: "1.6rem",
                          color: "var(--chung-light)", lineHeight: 1,
                        }}>{t.numero}</span>
                        <span style={{ fontSize: "0.68rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                          Tatami
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
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
