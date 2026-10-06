// Genera los íconos PNG de la PWA a partir de un SVG simple (sin servicios externos).
// Uso: node scripts/generate-icons.mjs   (requiere el Chromium de Playwright)
import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const svg = (size, padding) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="${padding ? 0 : 22}" fill="#166534"/>
  <g transform="translate(${padding ? 20 : 14} ${padding ? 20 : 14}) scale(${padding ? 0.6 : 0.72})" fill="none" stroke="#ffffff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 40 L20 14 H80 L88 40"/>
    <path d="M12 40 a12 12 0 0 0 25 0 a12 12 0 0 0 26 0 a12 12 0 0 0 25 0"/>
    <path d="M18 50 V86 H82 V50"/>
    <path d="M40 86 V64 H60 V86"/>
  </g>
</svg>`;

const targets = [
  ['public/icons/icon-192.png', 192, false],
  ['public/icons/icon-512.png', 512, false],
  ['public/icons/icon-maskable-512.png', 512, true],
  ['public/icons/apple-touch-icon.png', 180, true],
];

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage();
for (const [file, size, maskable] of targets) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(size, maskable)}</body></html>`);
  await writeFile(file, await page.screenshot({ omitBackground: !maskable, clip: { x: 0, y: 0, width: size, height: size } }));
  console.log('ok', file);
}
await browser.close();
