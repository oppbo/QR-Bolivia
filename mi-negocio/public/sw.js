// Service worker de Mi Negocio.
// Solo guarda en caché recursos estáticos y versionados de la app (/_next/static, /icons).
// NUNCA guarda páginas autenticadas, datos de clientes, QR, comprobantes ni solicitudes
// de escritura: todo lo demás va directo a la red. No hay cola de envíos sin conexión.
const CACHE = 'mi-negocio-static-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const isStatic = url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/');
  if (!isStatic) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    }),
  );
});
