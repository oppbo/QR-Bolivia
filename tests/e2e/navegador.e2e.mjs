/*
 * Prueba de extremo a extremo en un navegador real (Chromium con Playwright).
 *
 * Uso:  npm run test:e2e      (compila y luego ejecuta este archivo)
 *
 * Requiere el navegador de Playwright: `npx playwright install chromium`
 * (o la variable CHROMIUM_PATH con la ruta de un Chromium ya instalado).
 *
 * IMPORTANTE: emula perfiles móviles (tamaño, táctil, agente de usuario) dentro
 * de Chromium. NO reemplaza probar en un Android y un iPhone reales: Safari
 * (WebKit) no se ejecuta aquí.
 *
 * Todas las capturas se generan en el momento y son SINTÉTICAS: no imitan la
 * plantilla de ningún banco real.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { chromium, devices } from 'playwright';
import { preview } from 'vite';

const PUERTO = 4174;
const URL_APP = `http://localhost:${PUERTO}/`;
const TMP = mkdtempSync(join(tmpdir(), 'alerta-qr-'));
const resultados = [];
const externas = [];
const erroresConsola = [];

async function paso(nombre, fn) {
  const inicio = Date.now();
  try {
    const detalle = await fn();
    resultados.push({ nombre, ok: true, ms: Date.now() - inicio, detalle: detalle ?? '' });
  } catch (error) {
    resultados.push({ nombre, ok: false, ms: Date.now() - inicio, detalle: error.message.split('\n')[0] });
  }
}

// PNG en escala de grises, todo blanco, sin dependencias (para la prueba de
// dimensiones excesivas: 7000 × 6000 = 42 MP, pero pesa pocos KB).
function pngBlanco(ancho, alto) {
  const crcTabla = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTabla[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const bloque = (tipo, datos) => {
    const largo = Buffer.alloc(4);
    largo.writeUInt32BE(datos.length);
    const td = Buffer.concat([Buffer.from(tipo), datos]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([largo, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  const fila = Buffer.alloc(ancho + 1, 255);
  fila[0] = 0;
  const datos = Buffer.concat(Array.from({ length: alto }, () => fila));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloque('IHDR', ihdr),
    bloque('IDAT', deflateSync(datos)),
    bloque('IEND', Buffer.alloc(0)),
  ]);
}

async function crearCapturas(navegador) {
  const pagina = await navegador.newPage({ viewport: { width: 390, height: 300 }, deviceScaleFactor: 2 });
  const tarjeta = (estilo = '') => `<body style="font-family:sans-serif;margin:0;padding:20px;background:#fff">
    <div style="border:1px solid #ccc;border-radius:12px;padding:16px;${estilo}">
    <b>Banco Ejemplo (sintético)</b><br>Recibiste una transferencia QR<br>
    <span style="font-size:22px">Monto recibido: Bs 35,50</span><br>Saldo: Bs 1.220,00<br>
    Fecha 29/09/2026 14:05</div></body>`;
  await pagina.setContent(tarjeta());
  await pagina.screenshot({ path: join(TMP, 'captura.png') });
  await pagina.setContent(tarjeta('filter:blur(4px);font-size:11px'));
  await pagina.screenshot({ path: join(TMP, 'borrosa.png') });
  await pagina.setContent('<body style="background:#fff"></body>');
  await pagina.screenshot({ path: join(TMP, 'vacia.png') });
  await pagina.close();
  writeFileSync(join(TMP, 'enorme.png'), pngBlanco(7000, 6000));
}

const sel = {
  resultado: 'section[aria-labelledby=titulo-resultado]',
  ambiguo: 'section[aria-labelledby=titulo-ambiguo]',
  errorImagen: '#error-imagen',
  historial: 'section[aria-labelledby=titulo-historial] ol li',
  monto: '#titulo-resultado + p',
};

function vigilar(pagina) {
  pagina.on('request', (r) => {
    const url = r.url();
    if (!url.startsWith(URL_APP) && !url.startsWith('blob:') && !url.startsWith('data:')) externas.push(url);
  });
  pagina.on('console', (m) => {
    if (m.type() === 'error') erroresConsola.push(m.text());
  });
  pagina.on('pageerror', (e) => erroresConsola.push(e.message));
}

async function nuevaPagina(navegador, opciones = {}) {
  const contexto = await navegador.newContext(opciones);
  const pagina = await contexto.newPage();
  vigilar(pagina);
  await pagina.goto(URL_APP);
  if (opciones.serviceWorkers !== 'block') {
    await pagina.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 });
  }
  return { contexto, pagina };
}

const leerTexto = async (pagina, texto) => {
  await pagina.getByLabel('O pega el texto del SMS aquí').fill(texto);
  await pagina.getByRole('button', { name: /Leer monto del texto/ }).click();
};
const subir = (pagina, archivo) =>
  pagina.setInputFiles('#archivo', typeof archivo === 'string' ? join(TMP, archivo) : archivo);
const esperarFin = (pagina, timeout = 120000) =>
  pagina.locator(`${sel.resultado}, ${sel.ambiguo}, ${sel.errorImagen}`).first().waitFor({ timeout });
const otro = (pagina) => pagina.getByRole('button', { name: /leer otro comprobante/i }).click();

async function suitePerfil(navegador, etiqueta, perfil) {
  const { contexto, pagina } = await nuevaPagina(navegador, { ...perfil });
  const p = (nombre, fn) => paso(`[${etiqueta}] ${nombre}`, fn);

  await p('Sin desplazamiento horizontal', async () => {
    const { scroll, ancho } = await pagina.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      ancho: window.innerWidth,
    }));
    assert.ok(scroll <= ancho, `scrollWidth ${scroll} > ${ancho}`);
    return `${scroll} px ≤ ${ancho} px`;
  });

  await p('Botones de al menos 56 px de alto', async () => {
    const bajos = await pagina.evaluate(() =>
      [...document.querySelectorAll('button, label[for=archivo], summary')]
        .filter((b) => b.offsetParent !== null)
        .map((b) => [b.textContent.trim(), b.getBoundingClientRect().height])
        .filter(([, alto]) => alto < 56),
    );
    assert.deepEqual(bajos, []);
    return 'todos ≥ 56 px';
  });

  await p('Teclado: el primer Tab enfoca «Subir captura»', async () => {
    await pagina.locator('body').click({ position: { x: 1, y: 1 } });
    await pagina.keyboard.press('Tab');
    const id = await pagina.evaluate(() => document.activeElement?.id);
    assert.equal(id, 'archivo');
  });

  await p('Texto vacío → error asociado al campo', async () => {
    await leerTexto(pagina, '');
    const error = await pagina.locator('#error-texto').innerText();
    assert.match(error, /Pega el texto del SMS/);
    assert.equal(await pagina.getByLabel('O pega el texto del SMS aquí').getAttribute('aria-invalid'), 'true');
    assert.equal(await pagina.getByLabel('O pega el texto del SMS aquí').getAttribute('aria-describedby'), 'error-texto');
  });

  await p('Saldo y monto recibido → Bs 50,00', async () => {
    await leerTexto(pagina, 'Saldo: Bs 500. Monto recibido: Bs 50');
    assert.equal(await pagina.locator(sel.monto).innerText(), 'Bs 50,00');
    assert.equal(await pagina.locator(sel.historial).count(), 1);
    return 'estado: «Revisa el resultado»';
  });

  await p('Dos montos plausibles → elegir manualmente', async () => {
    await otro(pagina);
    await leerTexto(pagina, 'Recibiste Bs 50. Recibiste Bs 80');
    await pagina.locator(sel.ambiguo).waitFor();
    await pagina.getByRole('button', { name: 'Bs 80,00' }).click();
    assert.equal(await pagina.locator(sel.monto).innerText(), 'Bs 80,00');
  });

  await p('Formato «1.250» → revisar sin adivinar', async () => {
    await otro(pagina);
    await leerTexto(pagina, 'Monto recibido: Bs 1.250');
    const texto = await pagina.locator(sel.ambiguo).innerText();
    assert.match(texto, /Bs 1\.250,00/);
    assert.match(texto, /Bs 1,25/);
  });

  await p('Estado «pendiente» → advertencia visible', async () => {
    await otro(pagina);
    await leerTexto(pagina, 'Transferencia pendiente por Bs 50');
    assert.match(await pagina.locator(sel.resultado).innerText(), /Atención: el texto dice «pendiente»/);
  });

  await p('Sin voz local → resultado visible y mensaje claro', async () => {
    assert.equal(await pagina.locator(sel.monto).innerText(), 'Bs 50,00');
    await pagina.getByRole('button', { name: /Escuchar monto/ }).click();
    await pagina.getByText(/No hay una voz en español|no puede leer en voz alta/).first().waitFor();
  });

  await p('Portapapeles denegado → alternativa manual', async () => {
    await otro(pagina);
    await pagina.getByRole('button', { name: /Pegar desde el portapapeles/ }).click();
    await pagina.getByText(/no permitió leer el portapapeles/).waitFor();
  });

  await p('Archivo que no es imagen', async () => {
    await subir(pagina, { name: 'nota.txt', mimeType: 'text/plain', buffer: Buffer.from('hola') });
    assert.match(await pagina.locator(sel.errorImagen).innerText(), /no es una imagen compatible/);
  });

  await p('Imagen dañada', async () => {
    await subir(pagina, { name: 'rota.png', mimeType: 'image/png', buffer: Buffer.from('no es un png') });
    await pagina.locator(sel.errorImagen).getByText(/No pudimos abrir la imagen/).waitFor();
  });

  await p('Archivo de más de 10 MB', async () => {
    await subir(pagina, { name: 'grande.png', mimeType: 'image/png', buffer: Buffer.alloc(11 * 1024 * 1024) });
    await pagina.locator(sel.errorImagen).getByText(/pesa más de 10 MB/).waitFor();
  });

  await p('Dimensiones excesivas (42 MP)', async () => {
    await subir(pagina, 'enorme.png');
    await pagina.locator(sel.errorImagen).getByText(/demasiado grande para procesarla/).waitFor({ timeout: 30000 });
  });

  await p('OCR de captura sintética → Bs 35,50', async () => {
    const t0 = Date.now();
    await subir(pagina, 'captura.png');
    await esperarFin(pagina);
    assert.equal(await pagina.locator(sel.monto).innerText(), 'Bs 35,50');
    const origen = await pagina.locator(sel.resultado).innerText();
    assert.match(origen, /Origen:\s*Imagen/);
    assert.match(origen, /No indica si el pago es real/);
    return `${Date.now() - t0} ms (incluye preparar el lector)`;
  });

  await p('Elegir el mismo archivo otra vez', async () => {
    await otro(pagina);
    await subir(pagina, 'captura.png');
    await esperarFin(pagina);
    assert.equal(await pagina.locator(sel.monto).innerText(), 'Bs 35,50');
  });

  await p('Selecciones rápidas repetidas → una sola lectura', async () => {
    await otro(pagina);
    const antes = await pagina.locator(sel.historial).count();
    await subir(pagina, 'captura.png');
    const deshabilitado = await pagina.locator('#archivo').isDisabled();
    await subir(pagina, 'captura.png').catch(() => {});
    await esperarFin(pagina);
    await pagina.waitForTimeout(1500);
    assert.ok(deshabilitado, 'el input debía quedar deshabilitado');
    assert.equal(await pagina.locator(sel.historial).count(), Math.min(3, antes + 1));
  });

  await p('Historial: máximo 3 lecturas', async () => {
    assert.equal(await pagina.locator(sel.historial).count(), 3);
  });

  await p('Imagen sin texto → error amigable', async () => {
    await subir(pagina, 'vacia.png');
    await pagina.locator(sel.errorImagen).getByText(/No encontramos texto en la imagen/).waitFor({ timeout: 60000 });
  });

  await p('Captura borrosa → resultado o error amigable (nunca bloqueo)', async () => {
    await subir(pagina, 'borrosa.png');
    await esperarFin(pagina);
    const texto = await pagina.locator('main').innerText();
    const resumen = texto.match(/No encontramos[^.]*\.|No pudimos leer[^.]*\.|Bs [\d.,]+/)?.[0];
    assert.ok(resumen);
    assert.equal(await pagina.locator('#archivo').isDisabled(), false);
    return `resultado: «${resumen}»`;
  });

  await p('Cancelar lectura → «Listo» y controles activos', async () => {
    await subir(pagina, 'captura.png');
    await pagina.getByRole('button', { name: 'Cancelar lectura' }).click();
    assert.match(await pagina.locator('header').innerText(), /Listo/);
    assert.equal(await pagina.locator('#archivo').isDisabled(), false);
  });

  await p('Recargar borra el historial', async () => {
    await pagina.reload();
    await pagina.getByText('Todavía no hay lecturas').waitFor();
  });

  await p('Sin conexión (lector ya preparado): abrir, texto y OCR', async () => {
    await contexto.setOffline(true);
    await pagina.reload();
    await pagina.getByText(/Sin conexión\. Puedes leer texto pegado\./).waitFor();
    await leerTexto(pagina, 'Importe: Bs. 150,00');
    assert.equal(await pagina.locator(sel.monto).innerText(), 'Bs 150,00');
    await otro(pagina);
    await subir(pagina, 'captura.png');
    await esperarFin(pagina);
    assert.equal(await pagina.locator(sel.monto).innerText(), 'Bs 35,50');
    await contexto.setOffline(false);
  });

  await contexto.close();
}

async function main() {
  const servidor = await preview({ preview: { port: PUERTO, strictPort: true }, logLevel: 'error' });
  const navegador = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const version = navegador.version();
  try {
    await crearCapturas(navegador);

    await paso('PWA instalable según Chromium (manifest + service worker)', async () => {
      const { contexto, pagina } = await nuevaPagina(navegador);
      const cdp = await contexto.newCDPSession(pagina);
      const { errors } = await cdp.send('Page.getAppManifest');
      const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
      await contexto.close();
      assert.deepEqual(errors, []);
      assert.deepEqual(installabilityErrors, []);
      return 'sin errores de manifest ni de instalabilidad';
    });

    await suitePerfil(navegador, 'iPhone SE 320 px (Chromium)', devices['iPhone SE']);
    await suitePerfil(navegador, 'Pixel 7 (Chromium)', devices['Pixel 7']);

    await paso('Voz local simulada: frase exacta y sin historial', async () => {
      const contexto = await navegador.newContext();
      await contexto.addInitScript(() => {
        window.__dicho = [];
        const local = { lang: 'es-BO', localService: true, name: 'Local es-BO' };
        const remota = { lang: 'es-ES', localService: false, name: 'Remota' };
        const sintetizador = new EventTarget();
        sintetizador.getVoices = () => [remota, local];
        sintetizador.cancel = () => {};
        sintetizador.speak = (u) => {
          if (u.volume > 0) window.__dicho.push(`${u.voice.name}: ${u.text}`);
          setTimeout(() => {
            u.onstart?.();
            u.onend?.();
          }, 10);
        };
        Object.defineProperty(window, 'speechSynthesis', { value: sintetizador });
        window.SpeechSynthesisUtterance = class {
          constructor(texto) {
            this.text = texto;
            this.volume = 1;
          }
        };
      });
      const pagina = await contexto.newPage();
      vigilar(pagina);
      await pagina.goto(URL_APP);
      await pagina.getByRole('button', { name: /Simular prueba/ }).click();
      await pagina.waitForTimeout(200);
      await pagina.getByText('Todavía no hay lecturas').waitFor();
      await leerTexto(pagina, 'Importe: Bs. 20.50');
      await pagina.waitForTimeout(200);
      const dicho = await pagina.evaluate(() => window.__dicho);
      await contexto.close();
      assert.deepEqual(dicho, [
        'Local es-BO: ¡Prueba exitosa, el volumen está correcto!',
        'Local es-BO: Monto detectado: 20 bolivianos con 50 centavos. Revisa el abono en tu banco',
      ]);
      return 'usa la voz local e ignora la remota';
    });

    await paso('Sin conexión y sin preparar → mensaje claro', async () => {
      const { contexto, pagina } = await nuevaPagina(navegador);
      await contexto.setOffline(true);
      await subir(pagina, 'captura.png');
      await pagina.locator(sel.errorImagen).getByText(/todavía no está preparado/).waitFor({ timeout: 30000 });
      await contexto.close();
    });

    await paso('Error al descargar el modelo → mensaje claro y reintento posible', async () => {
      const { contexto, pagina } = await nuevaPagina(navegador, { serviceWorkers: 'block' });
      await pagina.route('**/lang/**', (ruta) => ruta.fulfill({ status: 503, body: '' }));
      await subir(pagina, 'captura.png');
      await pagina.locator(sel.errorImagen).getByText(/No se pudo descargar el lector/).waitFor({ timeout: 60000 });
      await pagina.unroute('**/lang/**');
      await subir(pagina, 'captura.png');
      await esperarFin(pagina);
      const monto = await pagina.locator(sel.monto).innerText();
      await contexto.close();
      assert.equal(monto, 'Bs 35,50');
      return 'el segundo intento funciona';
    });

    await paso('Preparar lectura sin conexión desde el botón', async () => {
      const { contexto, pagina } = await nuevaPagina(navegador);
      await pagina.getByText('Usar sin internet e instalar').click();
      await pagina.getByRole('button', { name: /Preparar lectura de imágenes/ }).click();
      await pagina.getByText(/Lector de imágenes listo para usar sin conexión/).waitFor({ timeout: 60000 });
      await contexto.close();
    });

    await paso('Actualización controlada del service worker', async () => {
      const { contexto, pagina } = await nuevaPagina(navegador);
      const rutaSw = join(process.cwd(), 'dist', 'sw.js');
      const original = readFileSync(rutaSw, 'utf8');
      try {
        writeFileSync(rutaSw, `${original}\n// versión de prueba ${Date.now()}\n`);
        await pagina.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
        await pagina.getByText('Hay una versión nueva de la app.').waitFor({ timeout: 15000 });
        await Promise.all([
          pagina.waitForEvent('load'),
          pagina.getByRole('button', { name: 'Actualizar ahora' }).click(),
        ]);
        await pagina.getByText('Hay una versión nueva de la app.').waitFor({ state: 'detached' });
      } finally {
        writeFileSync(rutaSw, original);
        await contexto.close();
      }
      return 'aviso → «Actualizar ahora» → recarga con la versión nueva';
    });

    await paso('Ninguna petición a otros dominios', async () => {
      assert.deepEqual(externas, []);
    });
    await paso('Sin errores en la consola', async () => {
      // net::ERR_INTERNET_DISCONNECTED y el 503 simulado son esperables.
      const reales = erroresConsola.filter((e) => !/ERR_INTERNET_DISCONNECTED|503|Failed to load resource/.test(e));
      assert.deepEqual(reales, []);
    });
  } finally {
    await navegador.close();
    await new Promise((resolver) => servidor.httpServer.close(resolver));
  }

  console.log(`\nResultados (Chromium ${version}):\n`);
  for (const r of resultados) {
    console.log(`${r.ok ? '✅' : '❌'} ${r.nombre}${r.detalle ? ` — ${r.detalle}` : ''} (${r.ms} ms)`);
  }
  const fallos = resultados.filter((r) => !r.ok).length;
  console.log(`\n${resultados.length - fallos} de ${resultados.length} pasos correctos.`);
  process.exit(fallos ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
