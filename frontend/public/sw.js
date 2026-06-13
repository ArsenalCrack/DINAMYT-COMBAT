/*
 * DINAMYT — Service Worker para uso en lugares con internet inestable.
 *
 * Objetivo: si un juez recarga la página (o el navegador descarta la pestaña)
 * sin internet, la aplicación debe seguir cargando desde la caché para que el
 * modo de registro local funcione.
 *
 * Estrategia:
 *  - Archivos estáticos con hash (/_next/static, fuentes, imágenes): caché
 *    primero (son inmutables entre builds).
 *  - Navegaciones (HTML): red primero y la respuesta se guarda en caché;
 *    sin red, se sirve la última copia cacheada de esa ruta.
 *  - Nunca se interceptan peticiones a otros orígenes (API de Render, sockets).
 */

const CACHE = "dinamyt-v2";

// Rutas que deben funcionar SIN conexión aunque no se hayan visitado antes
// (el Tablero local y el retorno del juez). Se precachean al instalar el SW.
const PRECACHE = [
  "/",
  "/login",
  "/juez",
  "/pantalla",
  "/tablero",
  "/tablero/pantalla",
  "/logo.png",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
];

// Página de respaldo cuando no hay red NI copia en caché de la ruta pedida
const PAGINA_SIN_CONEXION = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DINAMYT — Sin conexión</title>
<style>
  body {
    margin: 0; min-height: 100vh; display: flex; flex-direction: column;
    align-items: center; justify-content: center; text-align: center;
    background: radial-gradient(circle at 50% 30%, #14141f 0%, #050507 70%);
    color: #e8e8ee; font-family: system-ui, sans-serif; padding: 24px;
  }
  .logo { font-size: 2.4rem; font-weight: 900; letter-spacing: 0.12em; color: #f0b800; }
  .logo span { color: #e8e8ee; }
  .ico { font-size: 3rem; margin: 24px 0 8px; }
  h1 { font-size: 1.15rem; margin: 0 0 10px; letter-spacing: 0.04em; }
  p { color: #9a9aa8; font-size: 0.92rem; max-width: 340px; line-height: 1.5; margin: 0 0 24px; }
  button {
    background: linear-gradient(135deg, #f0b800, #c79600); color: #1a1400;
    border: 0; border-radius: 10px; padding: 13px 30px;
    font-size: 1rem; font-weight: 800; letter-spacing: 0.05em; cursor: pointer;
  }
</style>
</head>
<body>
  <div class="logo">DINAMYT<span> COMBAT</span></div>
  <div class="ico">📡</div>
  <h1>Sin conexión a internet</h1>
  <p>Esta pantalla aún no se ha abierto en este dispositivo, así que necesita
  internet la primera vez. Las pantallas que ya visitaste sí funcionan sin conexión.</p>
  <button onclick="location.reload()">Reintentar</button>
</body>
</html>`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Best-effort: precachear el documento HTML de cada ruta crítica para
      // que estén disponibles offline. No se aborta la instalación si alguna
      // ruta falla (los subrecursos JS se cachean al navegar/prefetch online).
      await Promise.all(
        PRECACHE.map(async (ruta) => {
          try {
            const res = await fetch(ruta, { cache: "no-cache" });
            if (res && res.ok) await cache.put(ruta, res.clone());
          } catch { /* sin red en install: se cacheará al primer uso online */ }
        })
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const claves = await caches.keys();
      await Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // HTML de navegación: red primero, caché de respaldo
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        try {
          const fresca = await fetch(req);
          if (fresca.ok) cache.put(req, fresca.clone());
          return fresca;
        } catch {
          // El rol viaja en el query (?rol=j1) pero el documento es el mismo:
          // ignoreSearch permite servir la ruta aunque cambie el parámetro.
          const cacheada = await cache.match(req, { ignoreSearch: true });
          if (cacheada) return cacheada;
          return new Response(PAGINA_SIN_CONEXION, {
            status: 503,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }
      })()
    );
    return;
  }

  // Estáticos: caché primero
  const esEstatico =
    url.pathname.startsWith("/_next/static/") ||
    /\.(woff2?|png|ico|svg|jpg|jpeg|webp)$/.test(url.pathname);
  if (esEstatico) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const cacheada = await cache.match(req);
        if (cacheada) return cacheada;
        const fresca = await fetch(req);
        if (fresca.ok) cache.put(req, fresca.clone());
        return fresca;
      })()
    );
  }
});
