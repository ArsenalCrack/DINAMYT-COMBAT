"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { getCampeonatoAPI } from "@/lib/api";
import LlavesSection from "@/components/LlavesSection";
import AvisoSinInternet from "@/components/AvisoSinInternet";

export default function LlavesCampeonatoPage() {
  const router = useRouter();
  const params = useParams();
  const campId = Number(params.id);
  const [campNombre, setCampNombre] = useState("");

  useEffect(() => {
    const user = localStorage.getItem("dinamyt_user");
    if (!user || JSON.parse(user).rol !== "admin") {
      router.replace("/login"); return;
    }
    let cancelled = false;
    queueMicrotask(async () => {
      try {
        const c = await getCampeonatoAPI(campId);
        if (!cancelled) setCampNombre(c.nombre);
      } catch {
        if (!cancelled) router.replace("/admin");
      }
    });
    return () => { cancelled = true; };
  }, [campId, router]);

  return (
    <div className="llaves-page">
      <AvisoSinInternet />
      <div style={{ marginBottom: 20 }}>
        <button className="btn btn-sm btn-ghost" onClick={() => router.push(`/admin/campeonato/${campId}`)}
          style={{ marginBottom: 8 }}>
          ← Volver al campeonato
        </button>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 800, overflowWrap: "anywhere" }}>
          Llaves y Grupos — {campNombre || "..."}
        </h1>
        <p className="text-muted" style={{ fontSize: "0.88rem" }}>
          Crea llaves de combate (eliminación) o grupos de figuras, asígnalos a
          un tatami —o déjalos en el pool para asignar después— y actívalos desde
          el panel del Juez Central. Cada llave muestra su estado: pendiente,
          activa o terminada.
        </p>
      </div>

      <LlavesSection campeonatoId={campId} />

      <style>{`
        .llaves-page {
          max-width: 1200px;
          margin: 0 auto;
          padding: 20px;
        }
        @media (max-width: 600px) {
          .llaves-page { padding: 14px; }
        }
      `}</style>
    </div>
  );
}
