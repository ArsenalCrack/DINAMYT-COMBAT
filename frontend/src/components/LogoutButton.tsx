"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Botón de cerrar sesión con confirmación.
 * Buenas prácticas aplicadas:
 * - Icono + etiqueta visible (no solo icono).
 * - Estilo neutro en reposo, peligro solo al pasar el cursor (no alarma).
 * - Diálogo de confirmación para evitar cierres accidentales en pleno torneo.
 * - Accesible: role="dialog", cierre con Escape, foco inicial en "Cancelar".
 * - Estado de carga mientras se cierra la sesión.
 */
export default function LogoutButton({ label = "Cerrar sesión" }: { label?: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!confirming) return;
    cancelRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setConfirming(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirming]);

  function handleLogout() {
    setLoggingOut(true);
    localStorage.removeItem("dinamyt_token");
    localStorage.removeItem("dinamyt_user");
    router.replace("/login");
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-sm logout-btn"
        onClick={() => setConfirming(true)}
        aria-haspopup="dialog"
      >
        <svg
          width="15" height="15" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.2"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
        >
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
        <span>{label}</span>
      </button>

      {confirming && (
        <div
          className="overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="logout-dialog-title"
          onClick={(e) => {
            if (e.target === e.currentTarget && !loggingOut) setConfirming(false);
          }}
        >
          <div className="overlay-box" style={{ maxWidth: 400, padding: "28px 24px" }}>
            <div style={{ fontSize: "2rem", marginBottom: 8 }} aria-hidden="true">👋</div>
            <h2
              id="logout-dialog-title"
              style={{
                fontSize: "1.15rem", fontWeight: 800,
                letterSpacing: "0.04em", marginBottom: 8,
              }}
            >
              ¿Cerrar sesión?
            </h2>
            <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: 22 }}>
              Volverás a la pantalla de inicio de sesión. Los datos de los
              tatamis permanecen guardados en el servidor.
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
              <button
                ref={cancelRef}
                type="button"
                className="btn"
                onClick={() => setConfirming(false)}
                disabled={loggingOut}
                style={{ minWidth: 130 }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleLogout}
                disabled={loggingOut}
                style={{ minWidth: 150, fontWeight: 800 }}
              >
                {loggingOut ? "Cerrando..." : "Cerrar sesión"}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .logout-btn {
          gap: 7px;
          color: var(--text-muted);
        }
        .logout-btn:hover,
        .logout-btn:focus-visible {
          background: rgba(255, 68, 68, 0.10);
          border-color: rgba(255, 68, 68, 0.35);
          color: var(--red-alert);
        }
        .logout-btn:focus-visible {
          outline: 2px solid var(--red-alert);
          outline-offset: 2px;
        }
      `}</style>
    </>
  );
}
