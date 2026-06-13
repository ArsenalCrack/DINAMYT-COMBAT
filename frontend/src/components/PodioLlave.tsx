"use client";

import { podioLlave, medallaPuesto, type PodioItem } from "@/lib/llaves";
import type { LlaveEstructura } from "@/lib/api";

/**
 * Podio de una llave de eliminación (1°, 2°, 3° — bronce compartido).
 * Acepta el cuadro completo o un podio ya calculado (reportes).
 */
export default function PodioLlave({
  estructura, podio, grande = false, titulo = "Podio de la categoría",
}: {
  estructura?: LlaveEstructura | null;
  podio?: PodioItem[];
  grande?: boolean;
  titulo?: string;
}) {
  const items = podio ?? podioLlave(estructura);
  if (items.length === 0) return null;

  const fNombre = grande ? "clamp(1.2rem, 2.8vw, 2.2rem)" : "0.95rem";
  const fMedalla = grande ? "clamp(1.6rem, 3.5vw, 2.8rem)" : "1.2rem";
  const pad = grande ? "clamp(8px,1.6vh,16px) clamp(14px,2vw,24px)" : "6px 12px";

  return (
    <div>
      {titulo && (
        <div style={{
          fontSize: grande ? "clamp(0.9rem,1.8vw,1.2rem)" : "0.72rem",
          fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em",
          color: "var(--text-muted)", marginBottom: 8, textAlign: grande ? "center" : "left",
        }}>{titulo}</div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: grande ? "clamp(6px,1.4vh,12px)" : 4,
        maxWidth: grande ? 900 : undefined, margin: grande ? "0 auto" : undefined }}>
        {items.map((r, i) => {
          const podio = r.puesto <= 3;
          return (
            <div key={`${r.puesto}-${r.nombre}-${i}`} style={{
              display: "flex", alignItems: "center", gap: grande ? 16 : 10, padding: pad,
              borderRadius: "var(--radius)",
              background: r.puesto === 1 ? "var(--gold-bg)" : "var(--bg-elevated)",
              border: `${grande ? 2 : 1}px solid ${podio ? "var(--gold-border)" : "var(--border)"}`,
            }}>
              <span style={{
                fontSize: fMedalla, minWidth: grande ? "clamp(48px,6vw,80px)" : 32,
                textAlign: "center", color: "var(--gold)",
              }}>{medallaPuesto(r.puesto)}</span>
              <span style={{ flex: 1, minWidth: 0, fontWeight: 800, fontSize: fNombre, overflowWrap: "anywhere" }}>
                {r.nombre}
                {r.club && (
                  <span style={{ color: "var(--text-muted)", fontWeight: 500, marginLeft: grande ? 12 : 8, fontSize: grande ? "0.7em" : "0.8rem" }}>
                    {r.club}
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
