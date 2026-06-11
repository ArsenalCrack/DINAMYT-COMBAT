"use client";

import { useCallback, useEffect, useState } from "react";
import { listLlavesTatamiAPI, type LlaveTatamiInfo } from "@/lib/api";
import type { ConfirmData } from "@/components/AlertSystem";

interface CombateLlaveActivo {
  llave_id: number;
  nombre: string;
  ronda: number;
  partido: number;
  ronda_nombre: string;
  comp1: { id: number; nombre: string };
  comp2: { id: number; nombre: string };
}

/**
 * Panel del Juez Central: combates de eliminación del tatami.
 * - Muestra el siguiente combate sugerido de cada llave asignada al tatami.
 * - "Activar" carga los nombres en el marcador (crono pausado) y al guardar
 *   el ganador avanza automáticamente en la llave.
 * - "Soltar" libera el marcador para un combate suelto.
 */
export default function LlavePanel({
  tatamiDbId, combateLlave, enviarEvento, onShowConfirm,
}: {
  tatamiDbId: string;
  combateLlave?: CombateLlaveActivo | null;
  enviarEvento: (accion: string, datos?: Record<string, unknown>) => void;
  onShowConfirm: (data: ConfirmData) => void;
}) {
  const [llaves, setLlaves] = useState<LlaveTatamiInfo[]>([]);
  const [cargado, setCargado] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const data = await listLlavesTatamiAPI(tatamiDbId);
      setLlaves(data);
    } catch { /* sin permisos o sin red: el panel simplemente no se muestra */ }
    finally { setCargado(true); }
  }, [tatamiDbId]);

  // Recargar cuando cambia el combate de llave activo (p. ej. tras guardar,
  // el servidor lo libera y hay que refrescar el "siguiente" sugerido).
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) void cargar(); });
    return () => { cancelled = true; };
  }, [cargar, combateLlave?.llave_id, combateLlave?.partido]);

  const hayPendientes = llaves.some((l) => l.pendientes > 0 || l.campeon);
  if (!cargado || (!combateLlave && !hayPendientes)) return null;

  return (
    <div className="card" style={{ marginBottom: 8, padding: "10px 14px", borderColor: "var(--gold-border)" }}>
      <div className="card-title" style={{ marginBottom: 8 }}>
        Combates de Eliminación
      </div>

      {combateLlave ? (
        /* ── Combate de llave EN CURSO en este tatami ── */
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          gap: 10, flexWrap: "wrap",
          padding: "8px 12px", background: "var(--gold-bg)",
          border: "1px solid var(--gold-border)", borderRadius: "var(--radius-sm)",
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, color: "var(--gold)", fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              {combateLlave.nombre} · {combateLlave.ronda_nombre}
            </div>
            <div style={{ fontSize: "0.85rem", marginTop: 2 }}>
              <span style={{ color: "var(--hong-light)", fontWeight: 700 }}>{combateLlave.comp1.nombre}</span>
              <span style={{ color: "var(--text-dim)" }}> (Rojo) vs </span>
              <span style={{ color: "var(--chung-light)", fontWeight: 700 }}>{combateLlave.comp2.nombre}</span>
              <span style={{ color: "var(--text-dim)" }}> (Azul)</span>
            </div>
            <div style={{ fontSize: "0.72rem", color: "var(--text-dim)", marginTop: 2 }}>
              Al presionar &quot;Guardar + Nuevo&quot; el ganador avanza en la llave automáticamente.
            </div>
          </div>
          <button
            className="btn btn-sm btn-danger"
            onClick={() => onShowConfirm({
              titulo: "SOLTAR COMBATE",
              mensaje: "¿Liberar este combate de eliminación? El marcador quedará suelto y el combate seguirá pendiente en la llave.",
              tipo: "advertencia",
              confirmLabel: "SOLTAR",
              cancelLabel: "Cancelar",
              onConfirm: () => enviarEvento("soltar_combate_llave"),
            })}
          >
            Soltar
          </button>
        </div>
      ) : (
        /* ── Llaves con combates pendientes: sugerir el siguiente ── */
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {llaves.map((llave) => (
            <div key={llave.id} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              gap: 10, flexWrap: "wrap",
              padding: "8px 12px", background: "var(--bg-elevated)",
              border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: "0.85rem" }}>
                  {llave.nombre}
                  <span style={{ color: "var(--text-dim)", fontWeight: 600, marginLeft: 8, fontSize: "0.75rem" }}>
                    {llave.pendientes} combate(s) pendiente(s)
                  </span>
                </div>
                {llave.campeon ? (
                  <div style={{ fontSize: "0.8rem", color: "var(--gold)", fontWeight: 800, marginTop: 2 }}>
                    🏆 Campeón: {llave.campeon.nombre}
                  </div>
                ) : llave.siguiente ? (
                  <div style={{ fontSize: "0.8rem", marginTop: 2 }}>
                    <span style={{ color: "var(--text-dim)" }}>Sigue ({llave.siguiente.ronda_nombre}): </span>
                    <span style={{ color: "var(--hong-light)", fontWeight: 700 }}>{llave.siguiente.comp1.nombre}</span>
                    <span style={{ color: "var(--text-dim)" }}> vs </span>
                    <span style={{ color: "var(--chung-light)", fontWeight: 700 }}>{llave.siguiente.comp2.nombre}</span>
                  </div>
                ) : null}
              </div>
              {llave.siguiente && (
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => onShowConfirm({
                    titulo: "ACTIVAR COMBATE DE ELIMINACIÓN",
                    mensaje: `${llave.nombre} · ${llave.siguiente?.ronda_nombre}: ${llave.siguiente?.comp1.nombre} (Rojo) vs ${llave.siguiente?.comp2.nombre} (Azul). Los nombres se cargarán en el marcador con el tiempo pausado.`,
                    tipo: "info",
                    confirmLabel: "ACTIVAR",
                    cancelLabel: "Cancelar",
                    onConfirm: () => enviarEvento("activar_combate_llave", { llave_id: llave.id }),
                  })}
                >
                  Activar
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
