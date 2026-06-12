import type { Metadata } from "next";
import { Barlow_Condensed, Bebas_Neue, Inter, Share_Tech_Mono } from "next/font/google";
import "./globals.css";

// Fuentes auto-hospedadas: next/font las descarga en el build y las sirve
// desde nuestro dominio. Con el @import a Google Fonts, los celulares que no
// alcanzaban fonts.googleapis.com caían a la fuente del sistema (Roboto, más
// ancha) y desencajaban todo el layout.
const bebasNeue = Bebas_Neue({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--next-font-bebas",
});
const barlowCondensed = Barlow_Condensed({
  weight: ["400", "600", "700", "800"],
  style: ["normal", "italic"],
  subsets: ["latin"],
  display: "swap",
  variable: "--next-font-barlow",
});
const inter = Inter({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
  variable: "--next-font-inter",
});
const shareTechMono = Share_Tech_Mono({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--next-font-share-tech",
});

const fontClasses = `${bebasNeue.variable} ${barlowCondensed.variable} ${inter.variable} ${shareTechMono.variable}`;

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
    <html lang="es" className={fontClasses}>
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
