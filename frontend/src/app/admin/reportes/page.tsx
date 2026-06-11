"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import api, { listCampeonatosAPI, listTatamisAPI } from "@/lib/api";

interface Combate {
  id: number;
  tipo?: "combate" | "figuras" | string;
  nombre_categoria?: string;
  nombre_hong: string;
  nombre_chung: string;
  marcador_hong: number;
  marcador_chung: number;
  ganador: "hong" | "chung" | "empate";
  ronda_final: string;
  rondas_resumen?: string;
  figuras_completas?: boolean | null;
  num_jueces: number;
  duracion_segundos: number;
  tatami_id?: number;
  tatami_numero: number;
  campeonato_id?: number;
  campeonato_nombre: string;
  created_at: string;
  jueces?: JuezReporte[];
  jueces_resumen?: string;
  ranking?: RankingFigura[];
}

interface RankingFigura {
  id?: number;
  puesto?: number;
  nombre: string;
  club?: string;
  total: number;
}

interface JuezReporte {
  rol_tatami: string;
  asignacion: string;
  nombre: string;
  email: string;
  origen: string;
}

interface ReportData {
  combates: Combate[];
  total: number;
  page: number;
  pages: number;
  per_page: number;
}

interface CampeonatoOption {
  id: number;
  nombre: string;
}

interface TatamiOption {
  id: number;
  numero: number;
}

const RONDAS: Record<string, string> = {
  r1: "Round 1", r2: "Round 2", oro: "Punto de Oro", figuras: "Figuras",
};

function getExportFilename(disposition: string | null, fallback: string) {
  if (!disposition) return fallback;

  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1].replace(/"/g, ""));
  }

  const filenameMatch = disposition.match(/filename="?([^";]+)"?/i);
  return filenameMatch?.[1]?.trim() || fallback;
}

async function getExportError(res: Response) {
  const fallback = `No se pudo generar el reporte (${res.status}).`;
  const text = await res.text();
  if (!text) return fallback;

  try {
    const parsed = JSON.parse(text) as { error?: string; message?: string };
    return parsed.error || parsed.message || fallback;
  } catch {
    return text.slice(0, 180) || fallback;
  }
}

export default function ReportesPage() {
  const router = useRouter();
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<"pdf" | "excel" | null>(null);
  const [exportError, setExportError] = useState("");
  const [campeonatos, setCampeonatos] = useState<CampeonatoOption[]>([]);
  const [tatamis, setTatamis] = useState<TatamiOption[]>([]);
  const [splitZip, setSplitZip] = useState(false);
  const [filters, setFilters] = useState({
    campeonato_id: "",
    tatami_id: "",
    tipo: "",
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

  // Cargar lista de campeonatos para el selector
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(async () => {
      try {
        const c = await listCampeonatosAPI();
        if (!cancelled) {
          setCampeonatos(
            (c as CampeonatoOption[]).map((x) => ({ id: x.id, nombre: x.nombre }))
          );
        }
      } catch { /* */ }
    });
    return () => { cancelled = true; };
  }, []);

  // Cargar tatamis del campeonato seleccionado
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(async () => {
      if (cancelled) return;
      if (!filters.campeonato_id) {
        setTatamis([]);
        return;
      }
      try {
        const t = await listTatamisAPI(Number(filters.campeonato_id));
        if (!cancelled) {
          setTatamis(
            (t as TatamiOption[]).map((x) => ({ id: x.id, numero: x.numero }))
          );
        }
      } catch {
        if (!cancelled) setTatamis([]);
      }
    });
    return () => { cancelled = true; };
  }, [filters.campeonato_id]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { per_page: "30" };
      if (filters.campeonato_id) params.campeonato_id = filters.campeonato_id;
      if (filters.tatami_id) params.tatami_id = filters.tatami_id;
      if (filters.tipo) params.tipo = filters.tipo;
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

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void fetchData();
    });
    return () => { cancelled = true; };
  }, [fetchData]);

  async function handleExport(type: "pdf" | "excel") {
    setExporting(type);
    setExportError("");
    try {
      const params: Record<string, string> = {};
      if (filters.campeonato_id) params.campeonato_id = filters.campeonato_id;
      if (filters.tatami_id) params.tatami_id = filters.tatami_id;
      if (filters.tipo) params.tipo = filters.tipo;
      if (filters.desde) params.desde = filters.desde;
      if (filters.hasta) params.hasta = filters.hasta;

      const token = localStorage.getItem("dinamyt_token");
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

      let url: string;
      if (splitZip) {
        params.formato = type;
        const queryStr = new URLSearchParams(params).toString();
        url = `${apiUrl}/api/reportes/combates/export/zip?${queryStr}`;
      } else {
        const queryStr = new URLSearchParams(params).toString();
        url = `${apiUrl}/api/reportes/combates/export/${type}?${queryStr}`;
      }

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        throw new Error(await getExportError(res));
      }

      const contentType = res.headers.get("content-type") || "";
      const expectedZip = splitZip && (
        contentType.includes("application/zip")
        || contentType.includes("application/octet-stream")
      );
      const expectedPdf = !splitZip && type === "pdf" && contentType.includes("application/pdf");
      const expectedExcel = !splitZip && type === "excel" && (
        contentType.includes("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        || contentType.includes("application/octet-stream")
      );
      if (!expectedZip && !expectedPdf && !expectedExcel) {
        throw new Error("El servidor no devolvió un archivo de reporte válido.");
      }

      const blob = await res.blob();
      if (blob.size === 0) {
        throw new Error("El reporte se generó vacío. Intenta de nuevo.");
      }

      const fallbackName = splitZip
        ? "dinamyt_reportes.zip"
        : `dinamyt_resultados.${type === "pdf" ? "pdf" : "xlsx"}`;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = getExportFilename(res.headers.get("content-disposition"), fallbackName);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "No se pudo generar el reporte.");
    }
    finally { setExporting(null); }
  }

  function ganadorNombre(c: Combate) {
    if (c.tipo === "figuras") return c.ranking?.[0]?.nombre || c.nombre_hong || "—";
    if (c.ganador === "hong") return c.nombre_hong;
    if (c.ganador === "chung") return c.nombre_chung;
    return "Empate";
  }

  function ganadorColor(c: Combate) {
    if (c.tipo === "figuras") return "badge-gold";
    if (c.ganador === "hong") return "badge-hong";
    if (c.ganador === "chung") return "badge-chung";
    return "badge-gray";
  }

  function tipoLabel(c: Combate) {
    return c.tipo === "figuras" ? "Figuras" : "Combate";
  }

  const splitHint = filters.campeonato_id
    ? "Genera un ZIP con un archivo por cada tatami del campeonato seleccionado."
    : "Genera un ZIP con un archivo por cada campeonato.";

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
            Reportes de Resultados
          </h1>
          <p className="text-muted" style={{ fontSize: "0.88rem" }}>
            {data ? `${data.total} registros guardados` : "Cargando..."}
          </p>
        </div>

        {/* Export buttons */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
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
              {exporting === "excel" ? "Generando..." : splitZip ? "Excel (ZIP)" : "Exportar Excel"}
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
              {exporting === "pdf" ? "Generando..." : splitZip ? "PDF (ZIP)" : "Exportar PDF"}
            </button>
          </div>
          <label style={{
            display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
            fontSize: "0.78rem", color: splitZip ? "var(--gold)" : "var(--text-muted)",
            fontWeight: 700, userSelect: "none",
          }}>
            <input
              type="checkbox"
              checked={splitZip}
              onChange={(e) => setSplitZip(e.target.checked)}
              style={{ accentColor: "var(--gold)", width: 16, height: 16 }}
            />
            Dividir en archivos (ZIP)
          </label>
          {splitZip && (
            <span style={{ fontSize: "0.72rem", color: "var(--text-dim)", maxWidth: 280, textAlign: "right" }}>
              {splitHint}
            </span>
          )}
        </div>
      </div>

      {exportError && (
        <div className="reportes-error" role="alert">
          {exportError}
        </div>
      )}

      {/* Filters */}
      <div className="reportes-filters">
        <div className="card" style={{ padding: "16px 20px" }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 200px" }}>
              <label className="login-label" style={{ fontSize: "0.72rem" }}>Campeonato</label>
              <select
                className="input"
                value={filters.campeonato_id}
                onChange={(e) => setFilters(f => ({
                  ...f, campeonato_id: e.target.value, tatami_id: "", page: 1,
                }))}
                style={{ padding: "8px 12px", minHeight: 36 }}
              >
                <option value="">Todos los campeonatos</option>
                {campeonatos.map((c) => (
                  <option key={c.id} value={String(c.id)}>{c.nombre}</option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 150px" }}>
              <label className="login-label" style={{ fontSize: "0.72rem" }}>Tatami</label>
              <select
                className="input"
                value={filters.tatami_id}
                disabled={!filters.campeonato_id}
                onChange={(e) => setFilters(f => ({ ...f, tatami_id: e.target.value, page: 1 }))}
                style={{ padding: "8px 12px", minHeight: 36 }}
              >
                <option value="">
                  {filters.campeonato_id ? "Todos los tatamis" : "Elige campeonato"}
                </option>
                {tatamis.map((t) => (
                  <option key={t.id} value={String(t.id)}>Tatami {t.numero}</option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 140px" }}>
              <label className="login-label" style={{ fontSize: "0.72rem" }}>Tipo</label>
              <select
                className="input"
                value={filters.tipo}
                onChange={(e) => setFilters(f => ({ ...f, tipo: e.target.value, page: 1 }))}
                style={{ padding: "8px 12px", minHeight: 36 }}
              >
                <option value="">Todos</option>
                <option value="combate">Combates</option>
                <option value="figuras">Figuras</option>
              </select>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 150px" }}>
              <label className="login-label" style={{ fontSize: "0.72rem" }}>Desde</label>
              <input
                className="input" type="date"
                value={filters.desde}
                onChange={(e) => setFilters(f => ({ ...f, desde: e.target.value, page: 1 }))}
                style={{ padding: "8px 12px", minHeight: 36, colorScheme: "dark" }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 150px" }}>
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
              onClick={() => setFilters({ campeonato_id: "", tatami_id: "", tipo: "", desde: "", hasta: "", page: 1 })}
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
            <p>No hay registros con los filtros actuales.</p>
            <p style={{ fontSize: "0.85rem", marginTop: 6 }}>
              Los resultados se guardan cuando el arbitro presiona &quot;Guardar + Nuevo&quot;
            </p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table" style={{ minWidth: 980 }}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Tipo</th>
                  <th>Campeonato</th>
                  <th>Tatami</th>
                  <th>Categoría</th>
                  <th>Marcador</th>
                  <th>Ganador</th>
                  <th>Jueces</th>
                  <th>Rondas</th>
                  <th>Fecha</th>
                </tr>
              </thead>
              <tbody>
                {data.combates.map((c) => (
                  <tr key={c.id}>
                    <td className="text-muted font-mono" style={{ fontSize: "0.8rem" }}>{c.id}</td>
                    <td>
                      <span className={`badge ${c.tipo === "figuras" ? "badge-gold" : "badge-gray"}`}>
                        {tipoLabel(c)}
                      </span>
                    </td>
                    <td>{c.campeonato_nombre || "—"}</td>
                    <td className="text-center">
                      {c.tatami_numero ? `T${c.tatami_numero}` : "—"}
                    </td>
                    <td style={{ fontWeight: 700 }}>
                      {c.nombre_categoria || tipoLabel(c)}
                    </td>
                    <td className="text-center font-mono" style={{ fontSize: "1.05rem" }}>
                      {c.tipo === "figuras" ? (
                        <span style={{ color: "var(--gold)" }}>
                          {c.marcador_hong.toFixed(2)}
                          <span style={{ color: "var(--text-muted)", fontSize: "0.72rem", marginLeft: 6 }}>
                            {c.ranking?.length || 0} comp.
                          </span>
                        </span>
                      ) : (
                        <>
                          <span style={{ color: c.ganador === "hong" ? "var(--hong-light)" : "var(--text-muted)" }}>
                            {c.marcador_hong.toFixed(1)}
                          </span>
                          {" — "}
                          <span style={{ color: c.ganador === "chung" ? "var(--chung-light)" : "var(--text-muted)" }}>
                            {c.marcador_chung.toFixed(1)}
                          </span>
                        </>
                      )}
                    </td>
                    <td>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
                        <span className={`badge ${ganadorColor(c)}`}>
                          {ganadorNombre(c)}
                        </span>
                        {c.tipo !== "figuras" && c.ganador !== "empate" && (
                          <span style={{
                            fontSize: "0.7rem", fontWeight: 800,
                            textTransform: "uppercase", letterSpacing: "0.08em",
                            color: c.ganador === "hong" ? "var(--hong-light)" : "var(--chung-light)",
                          }}>
                            {c.ganador === "hong" ? "Rojo" : "Azul"}
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={{ minWidth: 240 }}>
                      {c.jueces && c.jueces.length > 0 ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          {c.jueces.map((j) => (
                            <span key={`${c.id}-${j.rol_tatami}`} style={{ fontSize: "0.76rem", color: "var(--text-muted)" }}>
                              <strong style={{ color: "var(--text)" }}>{j.asignacion}:</strong> {j.nombre} · {j.email}
                              {j.origen === "pin" ? " · PIN" : ""}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="text-muted" style={{ fontSize: "0.8rem", minWidth: 150 }}>
                      {c.tipo === "figuras" ? (
                        <span className={`badge ${c.figuras_completas ? "badge-green" : "badge-gray"}`}>
                          {c.figuras_completas ? "Completo" : "Incompleto"}
                        </span>
                      ) : (
                        c.rondas_resumen && c.rondas_resumen !== "-"
                          ? c.rondas_resumen
                          : (RONDAS[c.ronda_final] || c.ronda_final || "—")
                      )}
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
        .reportes-error {
          padding: 12px 14px;
          border: 1px solid rgba(255, 68, 68, 0.35);
          background: rgba(255, 68, 68, 0.10);
          color: #ff9a9a;
          border-radius: var(--radius);
          font-size: 0.88rem;
          font-weight: 700;
        }
        .login-label {
          font-size: 0.72rem;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.10em;
          color: var(--text-muted);
        }
        @media (max-width: 600px) {
          .reportes-page { padding: 14px; }
          .reportes-header { flex-direction: column; }
          .reportes-header > div:last-child { align-items: flex-start; }
          .reportes-header > div:last-child span { text-align: left !important; }
        }
      `}</style>
    </div>
  );
}
