"use client";

/**
 * Logo de DINAMYT: imagen + marca de texto.
 * - inline (default): imagen a la izquierda del texto, escala con `fontSize`.
 * - stacked: imagen EN GRANDE arriba y "DINAMYT" centrado debajo (pantallas
 *   públicas y portadas).
 * - soloImagen: solo la imagen (para espacios reducidos donde la marca de
 *   texto ya aparece en otro lugar de la pantalla).
 * El alto de la imagen va en `em`, así que todo escala con el fontSize
 * (incluido clamp()) sin romper los layouts existentes.
 */
export default function Logo({
  fontSize = "2rem",
  stacked = false,
  soloImagen = false,
  className = "",
  style,
}: {
  fontSize?: string | number;
  stacked?: boolean;
  soloImagen?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      className={`logo ${className}`.trim()}
      style={{
        fontSize,
        display: "inline-flex",
        flexDirection: stacked ? "column" : "row",
        alignItems: "center",
        justifyContent: "center",
        gap: stacked ? "0.18em" : "0.26em",
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
          height: stacked ? "2.1em" : "1.08em",
          width: "auto",
          display: "block",
          borderRadius: "16%",
          flexShrink: 0,
        }}
      />
      {!soloImagen && <span>DINA<em>MYT</em></span>}
    </span>
  );
}
