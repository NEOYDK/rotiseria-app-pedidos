// Lo que hace que Lo de Tito funcione como app: abre al instante y, sin señal, muestra el último menú visto.
// Páginas: primero la red (siempre lo último), si no hay, lo guardado. Fotos, letras y estilos: lo guardado, y se renueva atrás.
// El menú (/api/menu): red primero, guardado si no hay señal. El resto de /api (pedidos, panel, pagos) nunca se guarda.
const VERSION = "tito-1";
const BASICO = ["/", "/panel/", "/manifest.webmanifest", "/assets/icons/tito-192.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(BASICO)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

async function redPrimero(req, clave) {
  const cache = await caches.open(VERSION);
  try {
    const r = await fetch(req);
    if (r.ok) cache.put(clave || req, r.clone());
    return r;
  } catch (_) {
    const g = await cache.match(clave || req, { ignoreSearch: !clave });
    if (g) return g;
    throw _;
  }
}

async function guardadoPrimero(req) {
  const cache = await caches.open(VERSION);
  const g = await cache.match(req);
  const red = fetch(req).then(r => { if (r.ok) cache.put(req, r.clone()); return r; }).catch(() => g);
  return g || red;
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (req.mode === "navigate") {
    const pagina = url.pathname.startsWith("/panel") ? "/panel/" : url.pathname === "/" ? "/" : null;
    if (pagina) e.respondWith(redPrimero(req, pagina));
    return;
  }
  if (url.pathname === "/api/menu") { e.respondWith(redPrimero(req)); return; }
  if (url.pathname.startsWith("/api/")) return;
  if (/\.(css|js|webp|png|svg|woff2|webmanifest)$/.test(url.pathname)) e.respondWith(guardadoPrimero(req));
});

// Tocar un aviso abre (o trae al frente) la app
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window" }).then(ws => (ws.length ? ws[0].focus() : self.clients.openWindow("/"))));
});
