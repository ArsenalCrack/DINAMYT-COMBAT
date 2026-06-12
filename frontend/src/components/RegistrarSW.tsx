"use client";

import { useEffect } from "react";

/**
 * Registra el service worker que mantiene la app utilizable sin internet
 * (ver public/sw.js). Solo en producción: en desarrollo la caché estorba.
 */
export default function RegistrarSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* sin soporte o bloqueado: la app funciona igual, solo sin caché offline */
    });
  }, []);
  return null;
}
