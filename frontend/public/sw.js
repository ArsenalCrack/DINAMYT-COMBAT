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

const CACHE = "dinamyt-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
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
          return new Response(
            "<html><body style='background:#050507;color:#ddd;font-family:sans-serif;text-align:center;padding-top:40vh'>" +
            "Sin conexión y esta pantalla no está en caché.<br>Vuelve a intentarlo cuando regrese el internet.</body></html>",
            { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
          );
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
