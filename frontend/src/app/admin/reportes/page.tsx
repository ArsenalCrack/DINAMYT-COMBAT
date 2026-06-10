"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import api from "@/lib/api";

interface Combate {
  id: number;
  nombre_hong: string;
  nombre_chung: string;
  marcador_hong: number;
  marcador_chung: number;
  ganador: "hong" | "chung" | "empate";
  ronda_final: string;
  num_jueces: number;
  duracion_segundos: number;
  tatami_numero: number;
  campeonato_nombre: string;
  created_at: string;
}

interface ReportData {
  combates: Combate[];
  total: number;
  page: number;
  pages: number;
  per_page: number;
}

const RONDAS: Record<string, string> = {
  r1: "Round 1", r2: "Round 2", oro: "Punto de Oro",
};

export default function ReportesPage() {
  const router = useRouter();
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<"pdf" | "excel" | null>(null);
  const [filters, setFilters] = useState({
    campeonato_id: "",
    tatami_id: "",
    desde: "",
    hasta: "",
    page: 1,
  });

  useEffect(() => {
    const user = localStorage.getItem("dinamyt_user");
    if (!user || JSON.parse(user).rol !== "admin") {
      router.replace("/login"); return;
    }
  }, [router]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { per_page: "30" };
      if (filters.campeonato_id) params.campeonato_id = filters.campeonato_id;
      if (filters.tatami_id) params.tatami_id = filters.tatami_id;
      if (filters.desde) params.desde = filters.desde;
      if (filters.hasta) params.hasta = filters.hasta;
      params.page = String(filters.page);

      const res = await api.get("/reportes/combates", { params });
      setData(res.data);
    } catch {
      //
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function handleExport(type: "pdf" | "excel") {
    setExporting(type);
    try {
      const params: Record<string, string> = {};
      if (filters.campeonato_id) params.campeonato_id = filters.campeonato_id;
      if (filters.tatami_id) params.tatami_id = filters.tatami_id;
      if (filters.desde) params.desde = filters.desde;
      if (filters.hasta) params.hasta = filters.hasta;

      const token = localStorage.getItem("dinamyt_token");
      const queryStr = new URLSearchParams(params).toString();
      const url = `${process.env.NEXT_PUBLIC_API_URL}/api/reportes/combates/export/${type}?${queryStr}`;

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `dinamyt_combates.${type === "pdf" ? "pdf" : "xlsx"}`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch { /* */ }
    finally { setExporting(null); }
  }

  function ganadorNombre(c: Combate) {
    if (c.ganador === "hong") return c.nombre_hong;
    if (c.ganador === "chung") return c.nombre_chung;
    return "Empate";
  }

  function ganadorColor(g: string) {
    if (g === "hong") return "badge-hong";
    if (g === "chung") return "badge-chung";
    return "badge-gray";
  }

  return (
    <div className="reportes-page">
      {/* Header */}
      <div className="reportes-header">
        <div>
          <button className="btn btn-sm btn-ghost" onClick={() => router.push("/admin")}
            style={{ marginBottom: 8 }}>
            ← Volver al Admin
          </button>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 800 }}>
            Reportes de Combates
          </h1>
          <p className="text-muted" style={{ fontSize: "0.88rem" }}>
            {data ? `${data.total} combates registrados` : "Cargando..."}
          </p>
        </div>

        {/* Export buttons */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            className="btn btn-sm"
            onClick={() => handleExport("excel")}
            disabled={exporting !== null || loading}
            style={{
              background: "rgba(0, 168, 107, 0.12)",
              borderColor: "rgba(0, 168, 107, 0.35)",
              color: "#00D472",
            }}
          >
            {exporting === "excel" ? "Generando..." : "Exportar Excel"}
          </button>
          <button
            className="btn btn-sm"
            onClick={() => handleExport("pdf")}
            disabled={exporting !== null || loading}
            style={{
              background: "rgba(255, 68, 68, 0.10)",
              borderColor: "rgba(255, 68, 68, 0.30)",
              color: "#FF6666",
            }}
          >
            {exporting === "pdf" ? "Generando..." : "Exportar PDF"}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="reportes-filters">
        <div className="card" style={{ padding: "16px 20px" }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 160px" }}>
              <label className="login-label" style={{ fontSize: "0.72rem" }}>Tatami ID</label>
              <input
                className="input" type="number" min={1} placeholder="Todos"
                value={filters.tatami_id}
                onChange={(e) => setFilters(f => ({ ...f, tatami_id: e.target.value, page: 1 }))}
                style={{ padding: "8px 12px", minHeight: 36 }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 160px" }}>
              <label className="login-label" style={{ fontSize: "0.72rem" }}>Desde</label>
              <input
                className="input" type="date"
                value={filters.desde}
                onChange={(e) => setFilters(f => ({ ...f, desde: e.target.value, page: 1 }))}
                style={{ padding: "8px 12px", minHeight: 36, colorScheme: "dark" }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 160px" }}>
              <label className="login-label" style={{ fontSize: "0.72rem" }}>Hasta</label>
              <input
                className="input" type="date"
                value={filters.hasta}
                onChange={(e) => setFilters(f => ({ ...f, hasta: e.target.value, page: 1 }))}
                style={{ padding: "8px 12px", minHeight: 36, colorScheme: "dark" }}
              />
            </div>
            <button
              className="btn btn-sm"
              onClick={() => setFilters({ campeonato_id: "", tatami_id: "", desde: "", hasta: "", page: 1 })}
              style={{ alignSelf: "flex-end" }}
            >
              Limpiar
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }} className="animate-shimmer">
            Cargando combates...
          </div>
        ) : !data || data.combates.length === 0 ? (
          <div style={{ padding: 48, textAlign: "center", color: "var(--text-dim)" }}>
            <p style={{ fontSize: "2rem", marginBottom: 8 }}>📋</p>
            <p>No hay combates registrados con los filtros actuales.</p>
            <p style={{ fontSize: "0.85rem", marginTop: 6 }}>
              Los combates se guardan cuando el arbitro presiona &quot;Guardar + Nuevo&quot;
            </p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table" style={{ minWidth: 700 }}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Campeonato</th>
                  <th>Tatami</th>
                  <th style={{ color: "var(--hong-light)" }}>Hong (Rojo)</th>
                  <th style={{ color: "var(--chung-light)" }}>Chung (Azul)</th>
                  <th>Marcador</th>
                  <th>Ganador</th>
                  <th>Ronda</th>
                  <th>Fecha</th>
                </tr>
              </thead>
              <tbody>
                {data.combates.map((c) => (
                  <tr key={c.id}>
                    <td className="text-muted font-mono" style={{ fontSize: "0.8rem" }}>{c.id}</td>
                    <td>{c.campeonato_nombre || "—"}</td>
                    <td className="text-center">
                      {c.tatami_numero ? `T${c.tatami_numero}` : "—"}
                    </td>
                    <td>
                      <span style={{ color: "var(--hong-light)", fontWeight: 700 }}>
                        {c.nombre_hong}
                      </span>
                    </td>
                    <td>
                      <span style={{ color: "var(--chung-light)", fontWeight: 700 }}>
                        {c.nombre_chung}
                      </span>
                    </td>
                    <td className="text-center font-mono" style={{ fontSize: "1.05rem" }}>
                      <span style={{ color: c.ganador === "hong" ? "var(--hong-light)" : "var(--text-muted)" }}>
                        {c.marcador_hong.toFixed(1)}
                      </span>
                      {" — "}
                      <span style={{ color: c.ganador === "chung" ? "var(--chung-light)" : "var(--text-muted)" }}>
                        {c.marcador_chung.toFixed(1)}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${ganadorColor(c.ganador)}`}>
                        {ganadorNombre(c)}
                      </span>
                    </td>
                    <td className="text-muted" style={{ fontSize: "0.82rem" }}>
                      {RONDAS[c.ronda_final] || c.ronda_final || "—"}
                    </td>
                    <td className="text-muted font-mono" style={{ fontSize: "0.78rem" }}>
                      {c.created_at
                        ? new Date(c.created_at).toLocaleString("es-CO", {
                            day: "2-digit", month: "2-digit",
                            hour: "2-digit", minute: "2-digit",
                          })
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {data && data.pages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", gap: 8, flexWrap: "wrap" }}>
          {Array.from({ length: data.pages }, (_, i) => i + 1).map((p) => (
            <button
              key={p}
              className="btn btn-sm"
              onClick={() => setFilters(f => ({ ...f, page: p }))}
              style={{
                background: p === filters.page ? "var(--gold-bg)" : undefined,
                borderColor: p === filters.page ? "var(--gold-border)" : undefined,
                color: p === filters.page ? "var(--gold)" : undefined,
              }}
            >{p}</button>
          ))}
        </div>
      )}

      <style>{`
        .reportes-page {
          max-width: 1200px;
          margin: 0 auto;
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .reportes-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          flex-wrap: wrap;
          gap: 12px;
        }
        .reportes-filters {}
        .login-label {
          font-size: 0.72rem;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.10em;
          color: var(--text-muted);
        }
        @media (max-width: 600px) {
          .reportes-header { flex-direction: column; }
        }
      `}</style>
    </div>
  );
}
