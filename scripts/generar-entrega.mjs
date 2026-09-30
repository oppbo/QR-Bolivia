// Genera ENTREGA.md: la respuesta completa por pasos (el contenido de
// README.md) con el CÓDIGO COMPLETO de cada archivo insertado en el Paso 4,
// con su ruta encima de cada bloque. Se genera a partir de los archivos reales
// para que el documento nunca quede desincronizado del código.
// Uso: npm run entrega
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const raiz = new URL('..', import.meta.url).pathname;

const ARCHIVOS = [
  ['package.json', 'json'],
  ['index.html', 'html'],
  ['vite.config.js', 'js'],
  ['src/main.jsx', 'jsx'],
  ['src/index.css', 'css'],
  ['src/App.jsx', 'jsx'],
  ['public/manifest.json', 'json'],
  ['public/sw.js', 'js'],
  ['scripts/rutas-ocr.mjs', 'js'],
  ['scripts/copiar-recursos-ocr.mjs', 'js'],
  ['scripts/generar-iconos.mjs', 'js'],
  ['scripts/generar-entrega.mjs', 'js'],
  ['tests/parser.test.js', 'js'],
  ['tests/e2e/navegador.e2e.mjs', 'js'],
  ['.gitignore', 'gitignore'],
];

function bloque(ruta, lenguaje) {
  const contenido = readFileSync(join(raiz, ruta), 'utf8').replace(/\n$/, '');
  const mayorRacha = Math.max(0, ...(contenido.match(/`+/g) || []).map((r) => r.length));
  const cerca = '`'.repeat(Math.max(3, mayorRacha + 1));
  return `#### \`${ruta}\`\n\n${cerca}${lenguaje}\n${contenido}\n${cerca}\n`;
}

const readme = readFileSync(join(raiz, 'README.md'), 'utf8');
const corte = readme.indexOf('## Paso 5.');
if (corte < 0) throw new Error('README.md no tiene la sección "## Paso 5."');

const codigo = [
  '### Código completo de cada archivo\n',
  'Recursos binarios que no se muestran como texto:',
  '- `public/icons/*.png`: se generan con `npm run iconos` (script incluido abajo).',
  '- `public/ocr/**`: se copian desde `node_modules` con `npm run dev` o `npm run build` (script incluido abajo).',
  '- `package-lock.json`: lo genera `npm install`.\n',
  ...ARCHIVOS.map(([ruta, lenguaje]) => bloque(ruta, lenguaje)),
].join('\n');

const entrega =
  '<!-- Archivo generado por scripts/generar-entrega.mjs. No editar a mano: ejecuta "npm run entrega". -->\n\n' +
  readme.slice(0, corte) +
  codigo +
  '\n' +
  readme.slice(corte);

writeFileSync(join(raiz, 'ENTREGA.md'), entrega);
console.log(`ENTREGA.md generado (${ARCHIVOS.length} archivos, ${entrega.length} caracteres).`);
