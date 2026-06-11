"use client";

import { useEffect, useRef, useState } from "react";

export interface ConfirmDialogOptions {
  titulo: string;
  mensaje: string;
  tipo?: "peligro" | "advertencia" | "info";
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
}

const COLORES = {
  peligro: { color: "var(--red-alert)", icono: "⚠️" },
  advertencia: { color: "var(--orange)", icono: "⚠️" },
  info: { color: "var(--gold)", icono: "ℹ️" },
};

function ConfirmDialog({
  opciones, onClose,
}: {
  opciones: ConfirmDialogOptions;
  onClose: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const tipo = opciones.tipo || "advertencia";
  const { color, icono } = COLORES[tipo];

  useEffect(() => {
    cancelRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="overlay-box" style={{ maxWidth: 420, padding: "28px 24px" }}>
        <div style={{ fontSize: "2rem", marginBottom: 8 }} aria-hidden="true">{icono}</div>
        <h2
          id="confirm-dialog-title"
          style={{
            fontSize: "1.1rem", fontWeight: 800, letterSpacing: "0.05em",
            textTransform: "uppercase", color, marginBottom: 10,
          }}
        >
          {opciones.titulo}
        </h2>
        <p style={{ color: "var(--text-muted)", fontSize: "0.92rem", marginBottom: 22, lineHeight: 1.5 }}>
          {opciones.mensaje}
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          <button
            ref={cancelRef}
            type="button"
            className="btn"
            onClick={onClose}
            style={{ minWidth: 120 }}
          >
            {opciones.cancelLabel || "Cancelar"}
          </button>
          <button
            type="button"
            className={`btn ${tipo === "peligro" ? "btn-danger" : "btn-primary"}`}
            onClick={() => {
              onClose();
              opciones.onConfirm();
            }}
            style={{ minWidth: 140, fontWeight: 800 }}
          >
            {opciones.confirmLabel || "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Confirmaciones con el estilo del proyecto (reemplaza window.confirm).
 * Uso:
 *   const { pedirConfirmacion, dialogo } = useConfirmDialog();
 *   pedirConfirmacion({ titulo, mensaje, tipo: "peligro", onConfirm });
 *   ... y renderizar {dialogo} en el JSX.
 */
export function useConfirmDialog() {
  const [opciones, setOpciones] = useState<ConfirmDialogOptions | null>(null);

  const dialogo = opciones ? (
    <ConfirmDialog opciones={opciones} onClose={() => setOpciones(null)} />
  ) : null;

  return { pedirConfirmacion: setOpciones, dialogo };
}
