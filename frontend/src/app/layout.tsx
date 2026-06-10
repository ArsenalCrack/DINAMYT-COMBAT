import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DINAMYT - Sistema de Competencias Hapkido",
  description: "Sistema profesional de gestion y puntuacion de competencias de Hapkido en tiempo real. Combate, Figuras y mas.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
        <meta name="format-detection" content="telephone=no" />
        <meta name="theme-color" content="#050507" />
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
