"use client";

import { useRef, useState } from "react";
import Logo from "@/components/Logo";

// ─── Types ──────────────────────────────────────────────────────────────────
export interface FlashData {
  ico: string;
  txt: string;
}

export interface FaltaFlashData {
  ico: string;
  titulo: string;
  sub: string;
  tipo: "adv" | "falta" | "especial";
}

export interface GanadorData {
  nombre: string;
  color: "hong" | "chung";
  motivo?: string;
}

export interface Alerta12Data {
  hong: string;
  chung: string;
  lider: string;
  diferencia?: string;
  motivo?: string;
}

export interface DerrotaData {
  perdedor: string;
  razon: string;
}

export interface ConfirmData {
  titulo: string;
  mensaje: string;
  onConfirm: () => void;
  onCancel?: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  solo_ok?: boolean; // Solo botón "Entendido"
  tipo?: "peligro" | "advertencia" | "info";
}

// ─── Hook para AlertSystem ───────────────────────────────────────────────────
interface AlertState {
  flash?: FlashData;
  faltaFlash?: FaltaFlashData;
  ganador?: GanadorData;
  alerta12?: Alerta12Data;
  derrota?: DerrotaData;
  confirm?: ConfirmData;
}

export function useAlertSystem() {
  const [alerts, setAlerts] = useState<AlertState>({});
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const faltaTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showFlash(ico: string, txt: string, duracion = 1100) {
    setAlerts((p) => ({ ...p, flash: { ico, txt } }));
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => {
      setAlerts((p) => ({ ...p, flash: undefined }));
    }, duracion);
  }

  function showFaltaFlash(data: FaltaFlashData, duracion = 3000) {
    setAlerts((p) => ({ ...p, faltaFlash: data }));
    if (faltaTimer.current) clearTimeout(faltaTimer.current);
    faltaTimer.current = setTimeout(() => {
      setAlerts((p) => ({ ...p, faltaFlash: undefined }));
    }, duracion);
  }

  function showGanador(data: GanadorData) {
    setAlerts((p) => ({ ...p, ganador: data }));
  }

  function clearGanador() {
    setAlerts((p) => ({ ...p, ganador: undefined }));
  }

  function showAlerta12(data: Alerta12Data) {
    setAlerts((p) => ({ ...p, alerta12: data }));
  }

  function clearAlerta12() {
    setAlerts((p) => ({ ...p, alerta12: undefined }));
  }

  function showDerrota(data: DerrotaData) {
    setAlerts((p) => ({ ...p, derrota: data }));
  }

  function clearDerrota() {
    setAlerts((p) => ({ ...p, derrota: undefined }));
  }

  function showConfirm(data: ConfirmData) {
    setAlerts((p) => ({ ...p, confirm: data }));
  }

  function clearConfirm() {
    setAlerts((p) => ({ ...p, confirm: undefined }));
  }

  return {
    alerts,
    showFlash,
    showFaltaFlash,
    showGanador,
    clearGanador,
    showAlerta12,
    clearAlerta12,
    showDerrota,
    clearDerrota,
    showConfirm,
    clearConfirm,
  };
}

// ─── AlertSystem Component ───────────────────────────────────────────────────
interface AlertSystemProps {
  alerts: AlertState;
  onClearGanador: () => void;
  onClearAlerta12: () => void;
  onClearDerrota: () => void;
  onClearConfirm: () => void;
  isPantalla?: boolean;
  canCloseGanador?: boolean;
}

export default function AlertSystem({
  alerts,
  onClearGanador,
  onClearAlerta12,
  onClearDerrota,
  onClearConfirm,
  isPantalla = false,
  canCloseGanador = true,
}: AlertSystemProps) {
  return (
    <>
      {/* ── FLASH NOTIF rápida (centro) ── */}
      <FlashNotif data={alerts.flash} />

      {/* ── FALTA FLASH grande (overlay) ── */}
      <FaltaFlashOverlay data={alerts.faltaFlash} />

      {/* ── GANADOR fullscreen ── */}
      {alerts.ganador && (
        <GanadorOverlay
          data={alerts.ganador}
          onClose={onClearGanador}
          isPantalla={isPantalla}
          canClose={canCloseGanador}
        />
      )}

      {/* ── ALERTA 12 puntos ── */}
      {alerts.alerta12 && (
        <Alerta12Modal data={alerts.alerta12} onClose={onClearAlerta12} />
      )}

      {/* ── DERROTA modal ── */}
      {alerts.derrota && (
        <DerrotaModal data={alerts.derrota} onClose={onClearDerrota} />
      )}

      {/* ── CONFIRM modal (reemplaza confirm() nativo) ── */}
      {alerts.confirm && (
        <ConfirmModal data={alerts.confirm} onClose={onClearConfirm} />
      )}
    </>
  );
}

// ─── Flash Notif ─────────────────────────────────────────────────────────────
function FlashNotif({ data }: { data?: FlashData }) {
  return (
    <div
      style={{
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: data
          ? "translate(-50%, -50%) scale(1)"
          : "translate(-50%, -50%) scale(0)",
        background: "rgba(15, 15, 22, 0.97)",
        border: "1.5px solid var(--gold)",
        borderRadius: "var(--radius-lg)",
        padding: "18px 32px",
        textAlign: "center",
        zIndex: 5000,
        pointerEvents: "none",
        transition: "transform 0.18s cubic-bezier(.4,0,.2,1), opacity 0.18s",
        opacity: data ? 1 : 0,
        backdropFilter: "blur(14px)",
        minWidth: 180,
      }}
    >
      <div style={{ fontSize: "2.2rem", lineHeight: 1 }}>{data?.ico}</div>
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "1.7rem",
          letterSpacing: "0.06em",
          marginTop: 4,
          color: "var(--text)",
        }}
      >
        {data?.txt}
      </div>
    </div>
  );
}

// ─── Falta Flash Overlay ──────────────────────────────────────────────────────
function FaltaFlashOverlay({ data }: { data?: FaltaFlashData }) {
  const colores = {
    adv: {
      bg: "rgba(255, 114, 0, 0.16)",
      border: "#FF8C00",
      tituloColor: "#FF8C00",
    },
    falta: {
      bg: "rgba(232, 0, 42, 0.18)",
      border: "var(--hong)",
      tituloColor: "var(--hong-light)",
    },
    especial: {
      bg: "rgba(240, 184, 0, 0.18)",
      border: "var(--gold)",
      tituloColor: "var(--gold)",
    },
  };
  const c = data ? colores[data.tipo] : colores.adv;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 8000,
        pointerEvents: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: data ? 1 : 0,
        transition: "opacity 0.2s",
      }}
    >
      <div
        style={{
          background: c.bg,
          border: `3px solid ${c.border}`,
          borderRadius: "var(--radius-xl)",
          padding: "28px 52px",
          textAlign: "center",
          backdropFilter: "blur(8px)",
          boxShadow: `0 0 60px ${c.border}55`,
          animation: data ? "pff-in 0.25s ease-out" : undefined,
        }}
      >
        <div style={{ fontSize: "3.5rem", lineHeight: 1 }}>{data?.ico}</div>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "3rem",
            letterSpacing: "0.06em",
            color: c.tituloColor,
            lineHeight: 1,
            marginTop: 4,
          }}
        >
          {data?.titulo}
        </div>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "1.4rem",
            color: "rgba(255,255,255,0.75)",
            letterSpacing: "0.1em",
            marginTop: 4,
          }}
        >
          {data?.sub}
        </div>
      </div>
    </div>
  );
}

// ─── Ganador Overlay ─────────────────────────────────────────────────────────
function GanadorOverlay({
  data,
  onClose,
  isPantalla,
  canClose,
}: {
  data: GanadorData;
  onClose: () => void;
  isPantalla: boolean;
  canClose: boolean;
}) {
  const colorMap = {
    hong: "var(--hong-vivid)",
    chung: "var(--chung-vivid)",
  };
  const glowMap = {
    hong: "rgba(232, 0, 42, 0.5)",
    chung: "rgba(0, 85, 255, 0.5)",
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9500,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.9)",
        backdropFilter: "blur(12px)",
      }}
    >
      <div
        style={{
          textAlign: "center",
          animation: "ganador-entrada 0.5s cubic-bezier(.17,.67,.35,1.4)",
        }}
      >
        <div style={{ marginBottom: 10 }}>
          <Logo fontSize={isPantalla ? "1.6rem" : "1.1rem"} style={{ opacity: 0.85 }} />
        </div>
        <div style={{ fontSize: isPantalla ? "10rem" : "5rem", lineHeight: 1 }}>
          🏆
        </div>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: isPantalla ? "clamp(3rem,7vw,6rem)" : "2.5rem",
            letterSpacing: "0.4em",
            color: "var(--gold)",
            textShadow: "0 0 40px rgba(240,184,0,0.6)",
            margin: "8px 0",
          }}
        >
          SUNG
        </div>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: isPantalla ? "clamp(5rem,18vw,16rem)" : "clamp(3.5rem,10vw,8rem)",
            lineHeight: 0.9,
            color: colorMap[data.color],
            textShadow: `0 0 80px ${glowMap[data.color]}`,
          }}
        >
          {data.nombre.toUpperCase()}
        </div>
        {data.motivo && (
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: isPantalla ? "2rem" : "1.2rem",
              letterSpacing: "0.25em",
              color: "rgba(255,255,255,0.4)",
              marginTop: 12,
            }}
          >
            {data.motivo}
          </div>
        )}
        {canClose ? (
          <button
            onClick={onClose}
            style={{
              marginTop: 24,
              background: "rgba(255,255,255,0.1)",
              border: "1px solid rgba(255,255,255,0.2)",
              borderRadius: "var(--radius)",
              padding: "10px 32px",
              fontFamily: "var(--font-display)",
              fontSize: "1rem",
              letterSpacing: "0.1em",
              color: "rgba(255,255,255,0.6)",
              cursor: "pointer",
            }}
          >
            CERRAR
          </button>
        ) : (
          <div
            style={{
              marginTop: 24,
              fontFamily: "var(--font-display)",
              fontSize: isPantalla ? "1.4rem" : "0.95rem",
              letterSpacing: "0.12em",
              color: "rgba(255,255,255,0.45)",
            }}
          >
            ESPERANDO CIERRE DEL JUEZ CENTRAL
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Alerta 12 puntos ────────────────────────────────────────────────────────
function Alerta12Modal({
  data,
  onClose,
}: {
  data: Alerta12Data;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0,0,0,0.87)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: "var(--bg-card)",
          border: "2px solid var(--gold)",
          borderRadius: "var(--radius-xl)",
          padding: "32px 44px",
          textAlign: "center",
          maxWidth: 400,
          width: "92%",
          animation: "shake 0.4s ease-out",
          boxShadow: "var(--shadow-gold)",
        }}
      >
        <div style={{ fontSize: "2.8rem", lineHeight: 1 }}>⚠️</div>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "2rem",
            letterSpacing: "0.08em",
            color: "var(--gold)",
            marginTop: 6,
          }}
        >
          {(data.motivo || "SUPERIORIDAD TÉCNICA").toUpperCase()}
        </div>
        <div
          style={{
            fontSize: "0.9rem",
            color: "var(--text-muted)",
            margin: "8px 0 20px",
          }}
        >
          {data.lider} lidera por {data.diferencia || "12.0"} puntos — El Juez Central evalúa
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: 20,
            marginBottom: 24,
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "3.5rem",
              color: "var(--hong-vivid)",
            }}
          >
            {data.hong}
          </div>
          <div style={{ color: "var(--text-dim)", fontSize: "1.5rem" }}>vs</div>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "3.5rem",
              color: "var(--chung-vivid)",
            }}
          >
            {data.chung}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: "linear-gradient(135deg,var(--gold),var(--gold-dark))",
            border: "none",
            borderRadius: "var(--radius)",
            padding: "12px 32px",
            fontFamily: "var(--font-display)",
            fontSize: "1.1rem",
            letterSpacing: "0.06em",
            color: "var(--text-on-gold)",
            cursor: "pointer",
          }}
        >
          ENTENDIDO
        </button>
      </div>
    </div>
  );
}

// ─── Derrota Modal ───────────────────────────────────────────────────────────
function DerrotaModal({
  data,
  onClose,
}: {
  data: DerrotaData;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "rgba(0,0,0,0.93)",
        backdropFilter: "blur(14px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: "var(--bg-card)",
          border: "3px solid var(--hong)",
          borderRadius: "var(--radius-xl)",
          padding: "36px 48px",
          textAlign: "center",
          maxWidth: 440,
          width: "92%",
          animation: "shake 0.5s ease-out",
          boxShadow: "var(--shadow-hong)",
        }}
      >
        <div style={{ fontSize: "4rem", lineHeight: 1 }}>🚫</div>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "2.6rem",
            letterSpacing: "0.06em",
            color: "var(--hong-light)",
            marginTop: 8,
          }}
        >
          DESCALIFICADO
        </div>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "3.2rem",
            lineHeight: 1.1,
            margin: "8px 0",
          }}
        >
          {data.perdedor.toUpperCase()}
        </div>
        <div
          style={{
            fontSize: "0.9rem",
            color: "var(--text-muted)",
            marginBottom: 24,
          }}
        >
          {data.razon}
        </div>
        <button
          onClick={onClose}
          style={{
            background: "var(--hong)",
            border: "none",
            borderRadius: "var(--radius)",
            padding: "13px 32px",
            fontFamily: "var(--font-display)",
            fontSize: "1.1rem",
            letterSpacing: "0.08em",
            color: "#fff",
            cursor: "pointer",
          }}
        >
          CERRAR
        </button>
      </div>
    </div>
  );
}

// ─── Confirm Modal (reemplaza confirm() nativo) ────────────────────────────
function ConfirmModal({
  data,
  onClose,
}: {
  data: ConfirmData;
  onClose: () => void;
}) {
  const tipoBorder = {
    peligro: "var(--hong)",
    advertencia: "var(--gold)",
    info: "var(--border-light)",
  };
  const tipoIco = {
    peligro: "🚫",
    advertencia: "⚠️",
    info: "ℹ️",
  };

  const tipo = data.tipo || "advertencia";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9800,
        background: "rgba(0,0,0,0.88)",
        backdropFilter: "blur(10px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
      }}
    >
      <div
        style={{
          background: "var(--bg-card)",
          border: `2px solid ${tipoBorder[tipo]}`,
          borderRadius: "var(--radius-xl)",
          padding: "32px 40px",
          textAlign: "center",
          maxWidth: 460,
          width: "100%",
          animation: "shake 0.35s ease-out",
          boxShadow: "var(--shadow-lg)",
        }}
      >
        <div style={{ fontSize: "2.5rem", lineHeight: 1 }}>
          {tipoIco[tipo]}
        </div>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "1.8rem",
            letterSpacing: "0.06em",
            color:
              tipo === "peligro"
                ? "var(--hong-light)"
                : tipo === "advertencia"
                ? "var(--gold)"
                : "var(--text)",
            marginTop: 10,
            marginBottom: 12,
          }}
        >
          {data.titulo}
        </div>
        <p
          style={{
            color: "var(--text-muted)",
            fontSize: "0.95rem",
            lineHeight: 1.6,
            marginBottom: 28,
          }}
        >
          {data.mensaje}
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          {!data.solo_ok && (
            <button
              onClick={() => {
                data.onCancel?.();
                onClose();
              }}
              style={{
                background: "var(--bg-elevated)",
                border: "1px solid var(--border-light)",
                borderRadius: "var(--radius)",
                padding: "12px 28px",
                fontFamily: "var(--font-body)",
                fontSize: "0.95rem",
                fontWeight: 700,
                color: "var(--text-muted)",
                cursor: "pointer",
              }}
            >
              {data.cancelLabel || "Cancelar"}
            </button>
          )}
          <button
            onClick={() => {
              data.onConfirm();
              onClose();
            }}
            style={{
              background:
                tipo === "peligro"
                  ? "var(--hong)"
                  : tipo === "advertencia"
                  ? "linear-gradient(135deg,var(--gold),var(--gold-dark))"
                  : "var(--bg-elevated)",
              border: "none",
              borderRadius: "var(--radius)",
              padding: "12px 32px",
              fontFamily: "var(--font-display)",
              fontSize: "1rem",
              letterSpacing: "0.06em",
              color:
                tipo === "advertencia" ? "var(--text-on-gold)" : "#fff",
              cursor: "pointer",
            }}
          >
            {data.solo_ok
              ? "ENTENDIDO"
              : data.confirmLabel || "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}
