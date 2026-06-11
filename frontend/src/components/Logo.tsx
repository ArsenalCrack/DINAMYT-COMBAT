"use client";

/**
 * Logo de DINAMYT: imagen + marca de texto.
 * La imagen escala con el tamaño de fuente (alto en `em`), así que se adapta
 * a cualquier pantalla sin romper los layouts existentes: basta con pasar el
 * mismo fontSize que usaba el texto "DINAMYT".
 */
export default function Logo({
  fontSize = "2rem",
  className = "",
  style,
}: {
  fontSize?: string | number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      className={`logo ${className}`.trim()}
      style={{
        fontSize,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.26em",
        lineHeight: 1,
        ...style,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo.png"
        alt=""
        aria-hidden="true"
        style={{
          height: "1.08em",
          width: "auto",
          display: "block",
          borderRadius: "16%",
          flexShrink: 0,
        }}
      />
      <span>DINA<em>MYT</em></span>
    </span>
  );
}
