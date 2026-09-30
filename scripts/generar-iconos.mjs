// Genera los iconos PNG de la PWA sin dependencias externas (solo node:zlib).
// Uso: npm run iconos
//
// Diseño: fondo azul oscuro y, al centro, una tarjeta blanca con tres
// "marcadores" de código QR y una onda de sonido. Es geométrico a propósito
// para poder dibujarlo píxel a píxel de forma reproducible.
//
// - icon-192.png / icon-512.png: propósito "any" (la tarjeta ocupa ~72 %).
// - icon-maskable-512.png: propósito "maskable"; todo el contenido importante
//   queda dentro del círculo central del 80 % (zona segura del estándar), y el
//   fondo llega hasta los bordes para que el sistema pueda recortarlo.
// - apple-touch-icon.png (180 px): iOS no usa transparencia; fondo completo.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';

const AZUL = [11, 61, 145];
const BLANCO = [255, 255, 255];
const OSCURO = [15, 23, 42];
const AMARILLO = [250, 204, 21];

function crc32(buf) {
  let c;
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function bloque(tipo, datos) {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  const tipoYDatos = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(tipoYDatos));
  return Buffer.concat([largo, tipoYDatos, crc]);
}

function png(tam, pixel) {
  const filas = [];
  for (let y = 0; y < tam; y++) {
    const fila = Buffer.alloc(1 + tam * 3);
    for (let x = 0; x < tam; x++) {
      const [r, g, b] = pixel(x / tam, y / tam);
      fila[1 + x * 3] = r;
      fila[2 + x * 3] = g;
      fila[3 + x * 3] = b;
    }
    filas.push(fila);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(tam, 0);
  ihdr.writeUInt32BE(tam, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloque('IHDR', ihdr),
    bloque('IDAT', deflateSync(Buffer.concat(filas), { level: 9 })),
    bloque('IEND', Buffer.alloc(0)),
  ]);
}

// Devuelve una función de píxel: `escala` es el lado de la tarjeta blanca
// respecto del icono (0..1). Coordenadas normalizadas 0..1.
function disenio(escala) {
  const ini = (1 - escala) / 2;
  const radio = escala * 0.14;
  return (x, y) => {
    const u = (x - ini) / escala; // coordenadas dentro de la tarjeta
    const v = (y - ini) / escala;
    if (u < 0 || u > 1 || v < 0 || v > 1) return AZUL;
    // Esquinas redondeadas de la tarjeta.
    const r = radio / escala;
    const cx = Math.min(Math.max(u, r), 1 - r);
    const cy = Math.min(Math.max(v, r), 1 - r);
    if ((u - cx) ** 2 + (v - cy) ** 2 > r * r) return AZUL;
    // Tres marcadores QR (arriba izquierda, arriba derecha, abajo izquierda).
    for (const [mx, my] of [[0.12, 0.12], [0.58, 0.12], [0.12, 0.58]]) {
      const du = u - mx;
      const dv = v - my;
      if (du >= 0 && du <= 0.3 && dv >= 0 && dv <= 0.3) {
        const borde = Math.min(du, dv, 0.3 - du, 0.3 - dv);
        if (borde < 0.05) return OSCURO;
        if (borde < 0.09) return BLANCO;
        return OSCURO;
      }
    }
    // Onda de sonido (abajo derecha): arcos concéntricos amarillos.
    const ox = 0.6;
    const oy = 0.73;
    const d = Math.hypot(u - ox, v - oy);
    const angulo = Math.atan2(v - oy, u - ox);
    if (d < 0.05) return AZUL;
    if (Math.abs(angulo) < Math.PI / 4) {
      for (const radioArco of [0.12, 0.22, 0.32]) {
        if (Math.abs(d - radioArco) < 0.03) return radioArco === 0.22 ? AZUL : AMARILLO;
      }
    }
    return BLANCO;
  };
}

const salida = join(new URL('..', import.meta.url).pathname, 'public', 'icons');
mkdirSync(salida, { recursive: true });

const iconos = [
  ['icon-192.png', 192, disenio(0.72)],
  ['icon-512.png', 512, disenio(0.72)],
  // 0.56 de lado: la diagonal de la tarjeta (0.56 * 1.41 ≈ 0.79) cabe en el
  // círculo seguro del 80 %.
  ['icon-maskable-512.png', 512, disenio(0.56)],
  ['apple-touch-icon.png', 180, disenio(0.72)],
];

for (const [nombre, tam, pixel] of iconos) {
  writeFileSync(join(salida, nombre), png(tam, pixel));
  console.log(`Generado public/icons/${nombre}`);
}
