// Copia desde node_modules a public/ los archivos que Tesseract.js necesita,
// para servirlos desde el MISMO ORIGEN que la app (sin CDN de terceros).
// Se ejecuta solo antes de `npm run dev` y `npm run build` (predev/prebuild).
//
// Resultado:
//   public/ocr/<versiones>/worker.min.js
//   public/ocr/<versiones>/core/tesseract-core-*-lstm.wasm.js
//   public/ocr/<versiones>/lang/spa.traineddata.gz
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { CARPETA_OCR, NUCLEOS, carpetaDe } from './rutas-ocr.mjs';

const raiz = new URL('..', import.meta.url).pathname;
const destino = join(raiz, 'public', CARPETA_OCR);
const carpetaOcrPublica = join(raiz, 'public', 'ocr');

// Borra versiones anteriores para no publicar archivos obsoletos.
if (existsSync(carpetaOcrPublica)) {
  for (const nombre of readdirSync(carpetaOcrPublica)) {
    if (join('ocr', nombre) !== CARPETA_OCR) {
      rmSync(join(carpetaOcrPublica, nombre), { recursive: true, force: true });
    }
  }
}

mkdirSync(join(destino, 'core'), { recursive: true });
mkdirSync(join(destino, 'lang'), { recursive: true });

const copias = [
  [join(carpetaDe('tesseract.js'), 'dist', 'worker.min.js'), join(destino, 'worker.min.js')],
  ...NUCLEOS.map((archivo) => [
    join(carpetaDe('tesseract.js-core'), archivo),
    join(destino, 'core', archivo),
  ]),
  // "best_int": modelo LSTM entero, más pequeño (~2 MB) y adecuado para móviles.
  [
    join(carpetaDe('@tesseract.js-data/spa'), '4.0.0_best_int', 'spa.traineddata.gz'),
    join(destino, 'lang', 'spa.traineddata.gz'),
  ],
];

for (const [origen, fin] of copias) {
  if (!existsSync(origen)) {
    console.error(`Falta ${origen}. Ejecuta "npm install" antes de continuar.`);
    process.exit(1);
  }
  copyFileSync(origen, fin);
}

console.log(`Recursos OCR copiados en public/${CARPETA_OCR}`);
