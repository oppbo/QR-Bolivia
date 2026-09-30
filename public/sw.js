/*
 * Service worker de Alerta QR Bolivia.
 *
 * Qué guarda en caché:
 *  - "app-<versión>": HTML, JS, CSS, manifest e iconos de la app (precarga).
 *  - "ocr-recursos": worker, núcleo WebAssembly y modelo de idioma de
 *    Tesseract.js, SOLO cuando la app los descarga (al leer la primera imagen o
 *    al pulsar "Preparar lectura de imágenes sin conexión").
 *
 * Qué NUNCA guarda:
 *  - Capturas ni textos de SMS. Las imágenes se leen en memoria con FileReader
 *    y blob: (no pasan por la red), y el texto pegado nunca se envía.
 *  - Nada de otros dominios: solo intercepta peticiones GET del mismo origen.
 *
 * Actualización controlada: una versión nueva queda "en espera" hasta que la
 * persona pulsa "Actualizar" en la app (mensaje SALTAR_ESPERA). La primera
 * instalación se activa de inmediato porque no hay versión anterior.
 *
 * Los marcadores '__...__' los reemplaza vite.config.js al compilar.
 */
const VERSION_APP = '__VERSION_APP__';
const CARPETA_OCR = '__CARPETA_OCR__';
const LISTA_PRECACHE = ['__LISTA_PRECACHE__'];

const CACHE_APP = `app-${VERSION_APP}`;
const CACHE_OCR = 'ocr-recursos';
const RAIZ = new URL('./', self.location).href;
const URL_INDEX = new URL('./', self.location).href;

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_APP);
      // cache: 'reload' evita copiar respuestas viejas de la caché HTTP.
      await cache.addAll(
        LISTA_PRECACHE.map((ruta) => new Request(new URL(ruta, RAIZ).href, { cache: 'reload' })),
      );
      if (!self.registration.active) {
        await self.skipWaiting();
      }
    })(),
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    (async () => {
      // Borra cachés de versiones anteriores de la app.
      const nombres = await caches.keys();
      await Promise.all(
        nombres
          .filter((nombre) => nombre.startsWith('app-') && nombre !== CACHE_APP)
          .map((nombre) => caches.delete(nombre)),
      );
      // Borra recursos OCR de versiones anteriores de Tesseract.js.
      const cacheOcr = await caches.open(CACHE_OCR);
      const carpetaActual = new URL(`${CARPETA_OCR}/`, RAIZ).href;
      const entradas = await cacheOcr.keys();
      await Promise.all(
        entradas
          .filter((peticion) => !peticion.url.startsWith(carpetaActual))
          .map((peticion) => cacheOcr.delete(peticion)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (evento) => {
  if (evento.data && evento.data.tipo === 'SALTAR_ESPERA') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (evento) => {
  const peticion = evento.request;
  if (peticion.method !== 'GET') return;
  const url = new URL(peticion.url);
  if (url.origin !== self.location.origin) return;

  // 1) Recursos OCR: primero caché; si no están, red y se guardan.
  //    Nunca se responde con HTML: si falla la red, la petición falla y
  //    Tesseract.js informa el error (la app muestra un mensaje claro).
  if (url.href.startsWith(new URL('ocr/', RAIZ).href)) {
    evento.respondWith(primeroCache(peticion, CACHE_OCR));
    return;
  }

  // 2) Navegación (abrir la app): primero red para recibir actualizaciones;
  //    sin conexión, el index.html guardado. Solo las navegaciones reciben
  //    este respaldo HTML.
  if (peticion.mode === 'navigate') {
    evento.respondWith(
      (async () => {
        try {
          return await fetch(peticion);
        } catch {
          const cache = await caches.open(CACHE_APP);
          const respaldo = await cache.match(URL_INDEX);
          return respaldo || Response.error();
        }
      })(),
    );
    return;
  }

  // 3) Resto de archivos de la app (JS, CSS, iconos): primero caché.
  evento.respondWith(primeroCache(peticion, CACHE_APP));
});

async function primeroCache(peticion, nombreCache) {
  const cache = await caches.open(nombreCache);
  const guardada = await cache.match(peticion, { ignoreSearch: true });
  if (guardada) return guardada;
  const respuesta = await fetch(peticion);
  // Solo se guardan respuestas completas y correctas del mismo origen.
  if (respuesta.ok && respuesta.type === 'basic' && respuesta.status === 200) {
    await cache.put(peticion, respuesta.clone());
  }
  return respuesta;
}
