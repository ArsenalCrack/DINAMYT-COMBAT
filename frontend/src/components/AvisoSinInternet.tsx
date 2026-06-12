"use client";

import { useEffect, useState } from "react";

/** Detecta la falta de internet reportada por el sistema operativo. */
export function useSinInternet() {
  const [sinInternet, setSinInternet] = useState(false);
  useEffect(() => {
    setSinInternet(typeof navigator !== "undefined" && !navigator.onLine);
    const on = () => setSinInternet(false);
    const off = () => setSinInternet(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return sinInternet;
}

/**
 * Banner para las pantallas de administración: el admin trabaja 100% contra
 * el servidor, así que sin internet queda en modo solo-consulta. Nada se
 * pierde en el servidor (las peticiones simplemente no salen), pero se avisa
 * de frente para evitar intentos a ciegas.
 */
export default function AvisoSinInternet() {
  const sinInternet = useSinInternet();
  if (!sinInternet) return null;
  return (
    <div style={{
      position: "sticky", top: 0, zIndex: 300,
      padding: "10px 14px", textAlign: "center",
      background: "rgba(180, 16, 40, 0.97)", color: "#fff",
      fontWeight: 800, fontSize: "0.85rem", letterSpacing: "0.04em",
    }}>
      📡 SIN CONEXIÓN — Solo consulta: los cambios no se guardarán hasta que vuelva el internet.
    </div>
  );
}
