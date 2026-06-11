"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { loginAPI } from "@/lib/api";
import Logo from "@/components/Logo";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await loginAPI(email, password);
      localStorage.setItem("dinamyt_token", data.token);
      localStorage.setItem("dinamyt_user", JSON.stringify(data.user));
      router.push(data.user.rol === "admin" ? "/admin" : "/juez");
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setError(axiosErr.response?.data?.error || "Error de conexion con el servidor");
    } finally {
      setLoading(false);
    }
  }


  return (
    <div className="login-page">
      {/* Fondo con gradiente */}
      <div className="login-bg" aria-hidden="true" />

      <div className="login-wrapper animate-slide">
        {/* Logo central */}
        <div className="login-logo">
          <Logo stacked fontSize="clamp(2rem, 6vw, 2.8rem)" />
          <p className="login-tagline">Sistema Oficial de Competencias Hapkido</p>
          <p className="login-sub">Global Hapkido Association · GHA</p>
        </div>

        {/* GRID: Pantalla Publica | Separator | Login */}
        <div className="login-grid">

          {/* ── PANTALLA PUBLICA ── */}
          <div className="login-card login-card-public animate-fade">
            <div className="login-card-icon" aria-hidden="true">📺</div>
            <h2 className="login-card-title">Pantalla Publica</h2>
            <p className="login-card-desc">
              Ve el marcador en tiempo real de cualquier tatami.<br />
              Elige el campeonato y el tatami — no requiere cuenta.
            </p>
            <button
              type="button"
              className="btn btn-lg"
              onClick={() => router.push("/pantalla")}
              style={{
                width: "100%",
                background: "linear-gradient(135deg, #1c2e5e 0%, #0d1d42 100%)",
                border: "2px solid var(--chung-border)",
                color: "var(--chung-light)",
                fontWeight: 800,
                fontSize: "1rem",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
              id="public-access-btn"
            >
              Elegir Tatami
            </button>
            <p className="login-card-note">Cualquier persona puede acceder</p>
          </div>

          {/* ── SEPARADOR ── */}
          <div className="login-separator" aria-hidden="true">
            <div className="login-separator-line" />
            <span className="login-separator-label">O</span>
            <div className="login-separator-line" />
          </div>

          {/* ── LOGIN JUECES / ADMIN ── */}
          <div className="login-card login-card-auth animate-fade" style={{ animationDelay: "0.1s" }}>
            <div className="login-card-icon" aria-hidden="true">🏅</div>
            <h2 className="login-card-title">Jueces y Admin</h2>
            <p className="login-card-desc">
              Accede con tu cuenta para ingresar puntajes o administrar el campeonato.
            </p>

            <form onSubmit={handleSubmit} className="login-form">
              <div className="login-field">
                <label className="login-label" htmlFor="login-email">Correo Electronico</label>
                <input
                  type="email"
                  className="input"
                  placeholder="juez@dinamyt.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  id="login-email"
                />
              </div>

              <div className="login-field">
                <label className="login-label" htmlFor="login-password">Contrasena</label>
                <input
                  type="password"
                  className="input"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  id="login-password"
                />
              </div>

              {error && (
                <div className="login-error animate-fade" role="alert">
                  {error}
                </div>
              )}

              <button
                type="submit"
                className="btn btn-primary btn-lg"
                style={{ width: "100%" }}
                disabled={loading}
                id="login-submit"
              >
                {loading ? "Verificando..." : "Iniciar Sesion"}
              </button>
            </form>
          </div>

        </div>
      </div>

      <p className="login-footer">DINAMYT v4.0 · Global Hapkido ASSOCIATION · Competencias en tiempo real</p>

      <style>{`
        .login-page {
          min-height: 100dvh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 20px;
          position: relative;
          overflow: hidden;
        }

        .login-bg {
          position: absolute;
          inset: 0;
          background:
            radial-gradient(ellipse 80% 50% at 20% 30%, rgba(240,184,0,0.06) 0%, transparent 60%),
            radial-gradient(ellipse 60% 40% at 80% 70%, rgba(0,85,255,0.05) 0%, transparent 60%);
          pointer-events: none;
          z-index: 0;
        }

        .login-wrapper {
          position: relative;
          z-index: 1;
          width: 100%;
          max-width: 900px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 32px;
        }

        .login-logo {
          text-align: center;
        }

        .login-tagline {
          font-family: var(--font-body);
          font-size: 1.05rem;
          font-weight: 600;
          color: var(--text-muted);
          letter-spacing: 0.04em;
          margin-top: 6px;
        }

        .login-sub {
          font-size: 0.78rem;
          color: var(--text-dim);
          text-transform: uppercase;
          letter-spacing: 0.12em;
          margin-top: 2px;
        }

        .login-grid {
          display: grid;
          grid-template-columns: 1fr auto 1fr;
          gap: 0;
          width: 100%;
          align-items: start;
        }

        .login-card {
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 32px 28px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .login-card-public {
          border-color: var(--chung-border);
        }

        .login-card-auth {
          border-color: var(--gold-border);
        }

        .login-card-icon {
          font-size: 2.2rem;
          line-height: 1;
        }

        .login-card-title {
          font-size: 1.3rem;
          font-weight: 800;
          color: var(--text);
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }

        .login-card-desc {
          font-size: 0.88rem;
          color: var(--text-muted);
          line-height: 1.5;
        }

        .login-card-note {
          font-size: 0.75rem;
          color: var(--text-dim);
          text-align: center;
          margin-top: auto;
        }

        .login-public-form {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .login-separator {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 0 24px;
          gap: 8px;
          padding-top: 80px;
        }

        .login-separator-line {
          flex: 1;
          width: 1px;
          background: var(--border);
          min-height: 60px;
        }

        .login-separator-label {
          font-size: 0.8rem;
          font-weight: 800;
          color: var(--text-dim);
          letter-spacing: 0.1em;
          padding: 8px 0;
        }

        .login-form {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .login-field {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .login-label {
          font-size: 0.75rem;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.10em;
          color: var(--text-muted);
        }

        .login-error {
          background: rgba(255,68,68,0.10);
          border: 1px solid rgba(255,68,68,0.30);
          border-radius: var(--radius-sm);
          padding: 10px 14px;
          color: var(--red-alert);
          font-size: 0.88rem;
          text-align: center;
        }

        .login-footer {
          position: relative;
          z-index: 1;
          margin-top: 20px;
          color: var(--text-dim);
          font-size: 0.72rem;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          text-align: center;
        }

        /* Responsive */
        @media (max-width: 700px) {
          .login-grid {
            grid-template-columns: 1fr;
            gap: 0;
          }
          .login-separator {
            flex-direction: row;
            padding: 16px 0;
          }
          .login-separator-line {
            flex: 1;
            width: auto;
            height: 1px;
            min-height: auto;
          }
        }
      `}</style>
    </div>
  );
}
