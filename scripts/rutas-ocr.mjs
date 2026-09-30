// Calcula, en un solo lugar, la carpeta versionada donde se publican los
// recursos de Tesseract.js (worker, núcleo WebAssembly y modelo de idioma).
// La usan vite.config.js (para inyectar rutas en la app y en el service worker)
// y scripts/copiar-recursos-ocr.mjs (para copiar los archivos a public/).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';

const require = createRequire(import.meta.url);

function versionDe(paquete) {
  const ruta = require.resolve(`${paquete}/package.json`);
  return JSON.parse(readFileSync(ruta, 'utf8')).version;
}

export function carpetaDe(paquete) {
  return dirname(require.resolve(`${paquete}/package.json`));
}

export const VERSION_TESSERACT = versionDe('tesseract.js');
export const VERSION_CORE = versionDe('tesseract.js-core');
export const VERSION_IDIOMA = versionDe('@tesseract.js-data/spa');

// Al cambiar cualquier versión cambia la carpeta, así el service worker no
// mezcla un worker nuevo con un núcleo o modelo antiguos guardados en caché.
export const CARPETA_OCR = `ocr/${VERSION_TESSERACT}-${VERSION_CORE}-spa${VERSION_IDIOMA}`;

// Archivos que se copian. Solo las variantes "lstm" del núcleo: la app usa el
// motor LSTM (oem = 1), que es el predeterminado y el más liviano.
// El navegador descarga UNA de las tres variantes según soporte SIMD.
export const NUCLEOS = [
  'tesseract-core-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-relaxedsimd-lstm.wasm.js',
];
