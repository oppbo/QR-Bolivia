import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { CARPETA_OCR } from './scripts/rutas-ocr.mjs';

// Lista recursivamente los archivos de una carpeta.
function listarArchivos(carpeta) {
  return readdirSync(carpeta).flatMap((nombre) => {
    const ruta = join(carpeta, nombre);
    return statSync(ruta).isDirectory() ? listarArchivos(ruta) : [ruta];
  });
}

// Plugin mínimo: al terminar la compilación completa dist/sw.js con
//  1) la lista de archivos de la app que se deben precargar en caché, y
//  2) una versión calculada a partir del contenido de esos archivos.
// Así cada despliegue con cambios produce un service worker distinto y el
// navegador detecta la actualización. Los recursos OCR NO se precargan
// (pesan varios MB); se guardan solo cuando el usuario prepara el lector.
function serviceWorkerConPrecache() {
  let carpetaSalida;
  return {
    name: 'service-worker-con-precache',
    apply: 'build',
    configResolved(config) {
      carpetaSalida = join(config.root, config.build.outDir);
    },
    closeBundle() {
      const rutaSw = join(carpetaSalida, 'sw.js');
      const archivos = listarArchivos(carpetaSalida)
        .map((ruta) => relative(carpetaSalida, ruta).split(sep).join('/'))
        .filter((ruta) => ruta !== 'sw.js' && !ruta.startsWith('ocr/'))
        .sort();
      const hash = createHash('sha256');
      for (const archivo of archivos) {
        hash.update(archivo);
        hash.update(readFileSync(join(carpetaSalida, archivo)));
      }
      const version = hash.digest('hex').slice(0, 12);
      const precache = ['./', ...archivos.filter((a) => a !== 'index.html')];
      const codigo = readFileSync(rutaSw, 'utf8')
        .replace("'__VERSION_APP__'", JSON.stringify(version))
        .replace("'__CARPETA_OCR__'", JSON.stringify(CARPETA_OCR))
        .replace("['__LISTA_PRECACHE__']", JSON.stringify(precache));
      writeFileSync(rutaSw, codigo);
    },
  };
}

// Política de seguridad de contenido (solo en producción; en desarrollo Vite
// necesita scripts en línea y WebSocket para recargar en caliente).
// connect-src 'self': la página no puede enviar datos a otros dominios.
// 'wasm-unsafe-eval': necesario para compilar WebAssembly. blob: cubre la vista
// previa local de la captura, que nunca sale del dispositivo.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self'",
  "connect-src 'self'",
  "img-src 'self' blob: data:",
  "style-src 'self' 'unsafe-inline'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

function politicaDeSeguridad() {
  return {
    name: 'politica-de-seguridad',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}

export default defineConfig({
  // Rutas relativas: el mismo build funciona en la raíz de un dominio o en
  // una subcarpeta (por ejemplo https://usuario.github.io/alerta/).
  base: './',
  plugins: [react(), tailwindcss(), politicaDeSeguridad(), serviceWorkerConPrecache()],
  define: {
    // Carpeta versionada de los recursos OCR, compartida con el script de copia.
    __CARPETA_OCR__: JSON.stringify(CARPETA_OCR),
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{js,jsx}'],
  },
});
