<!-- Archivo generado por scripts/generar-entrega.mjs. No editar a mano: ejecuta "npm run entrega". -->

# Alerta QR Bolivia (MVP)

PWA que **lee en voz alta el monto** de una captura de la notificación bancaria del propio comerciante, o del texto de un SMS pegado. Está pensada para tiendas de barrio, puestos de comida, pensiones, vendedores de mercado y taxistas.

> **Límite de seguridad.** El OCR reconoce texto; **no autentica comprobantes**. Una imagen editada o un SMS falso pueden mostrar un monto perfectamente legible. Sin integración bancaria no se puede comprobar que una transacción exista, esté completada o haya abonado dinero. La app es una **herramienta de lectura asistida**, no un sistema de verificación bancaria. Por eso dice «Monto detectado», nunca «Pago verificado», y siempre pide confirmar el abono en la app o los movimientos de la cuenta propia. El comprobante que muestra el comprador **no basta** para entregar mercadería.

---

## Paso 1. Arquitectura y límites

| Pieza | Qué hace |
|---|---|
| `src/App.jsx` | Toda la lógica: intérprete de montos (funciones puras exportadas), OCR con Tesseract.js, voz con Web Speech API, estados e interfaz. |
| `public/sw.js` | Service worker: caché de la app y de los recursos OCR; nunca guarda capturas ni SMS. |
| `scripts/copiar-recursos-ocr.mjs` | Copia worker, WebAssembly y modelo de español de `node_modules` a `public/ocr/<versión>/` para servirlos **desde el mismo origen**. |
| `vite.config.js` | Inserta en `dist/sw.js` la lista de precarga y la versión; agrega la política CSP en producción. |

**Qué es local y qué no:**

1. **No hay procesamiento en servidores propios.** No hay backend, base de datos, funciones serverless, API Routes, analítica ni claves. La imagen se lee en memoria (`blob:`), el OCR corre en un Web Worker del navegador y el texto pegado nunca sale del teléfono. La CSP de producción (`connect-src 'self'`) impide que la página envíe datos a otros dominios.
2. **El hosting sí transfiere archivos:** sirve HTML, JS, iconos y los recursos OCR. Eso consume la transferencia y el almacenamiento del plan del proveedor, con sus propias condiciones (ver Paso 6).
3. **Descarga inicial:** la app pesa ~90 KB comprimida. La primera vez que se lee una imagen (o se pulsa «Preparar lectura de imágenes sin conexión») el navegador **descarga** unos 6 MB del mismo sitio. **Descargar el modelo no significa subir la imagen:** la imagen nunca viaja al servidor.

| Archivo descargado | Tamaño aprox. | Para qué sirve |
|---|---|---|
| `ocr/<v>/worker.min.js` | 110 KB | Código del Web Worker de Tesseract.js |
| `ocr/<v>/core/tesseract-core-*-lstm.wasm.js` | 3,9 MB (se descarga **una** de tres variantes según SIMD) | Motor Tesseract compilado a WebAssembly |
| `ocr/<v>/lang/spa.traineddata.gz` | 2,1 MB | Modelo de español `4.0.0_best_int` |

El historial vive solo en memoria y guarda monto, hora y origen, nunca la imagen ni el texto. Desaparece al recargar. No se escribe contenido bancario en la consola.

**Decisiones secundarias tomadas:**
- Límite técnico de **Bs 100.000,00** (`CONFIG.LIMITE_TECNICO_CENTAVOS`) para descartar lecturas absurdas. **No es un límite bancario** y se puede cambiar.
- Tamaño máximo de archivo 10 MB y 40 megapíxeles.
- Solo se usa el motor LSTM (`oem = 1`) y el modelo entero `best_int`, más livianos para teléfonos.
- `cacheMethod: 'none'` en Tesseract: la caché la maneja solo el service worker, así se versiona y se borra en un único lugar.
- Vista previa de la captura durante la lectura (URL `blob:` que se revoca al cambiar, reiniciar o cerrar).
- Botón «Cancelar lectura» para que la interfaz nunca quede bloqueada si una descarga se cuelga.

## Paso 2. Comandos exactos

Requiere **Node.js 20.19 o superior** (probado con Node 22.22 y npm 10.9).

Versiones: **Vite 8**, **React 19**, **Tailwind CSS 4** (plugin `@tailwindcss/vite`, sin `tailwind.config.js` ni PostCSS), **Tesseract.js 7** (con `tesseract.js-core` 7) y **Vitest 5**.

Para crear el proyecto desde cero (equivalente a este repositorio):

```bash
npm create vite@latest alerta-qr-bolivia -- --template react
cd alerta-qr-bolivia
npm install react@^19 react-dom@^19 tesseract.js@^7
npm install -D vite@^8 @vitejs/plugin-react@^6 tailwindcss@^4 @tailwindcss/vite@^4 vitest@^5 @tesseract.js-data/spa@^1
# Reemplaza/crea los archivos del Paso 4. Tailwind 4 se configura solo con:
#   - el plugin tailwindcss() en vite.config.js
#   - @import 'tailwindcss'; en src/index.css
```

Con este repositorio clonado:

```bash
npm install          # instala dependencias
npm run dev          # desarrollo en http://localhost:5173 (copia antes los recursos OCR)
npm test             # 72 pruebas automáticas del intérprete (Vitest)
npm run build        # producción en dist/ (copia antes los recursos OCR)
npm run preview      # previsualiza dist/ en http://localhost:4173
npm run test:e2e     # compila y prueba la app en Chromium (54 comprobaciones)
npm run iconos       # (opcional) regenera los iconos PNG
npm run entrega      # (opcional) regenera ENTREGA.md con el código completo
```

`test:e2e` usa Playwright 1.56.1. Si en tu equipo no tienes su Chromium, ejecuta una vez `npx playwright install chromium`, o define `CHROMIUM_PATH` con la ruta de un Chromium instalado.

`predev` y `prebuild` ejecutan `scripts/copiar-recursos-ocr.mjs`, que deja los recursos OCR en `public/ocr/<tesseract>-<core>-spa<modelo>/`. Esa carpeta está en `.gitignore` porque se genera desde `node_modules`. El nombre versionado evita mezclar un worker nuevo con un núcleo viejo guardado en caché.

**Rutas OCR** (en `useOcr()`, dentro de `src/App.jsx`):

```js
createWorker('spa', 1, {
  workerPath: `${base}worker.min.js`,  // base = <sitio>/ocr/<versión>/
  corePath:   `${base}core`,           // carpeta: Tesseract elige la variante SIMD
  langPath:   `${base}lang`,           // busca spa.traineddata.gz
  workerBlobURL: false, cacheMethod: 'none', gzip: true,
});
```

Si omites estas rutas, Tesseract.js descarga de un CDN externo (jsDelivr). La app no lo hace.

## Paso 3. Árbol de archivos

```
.
├── index.html
├── package.json
├── package-lock.json
├── vite.config.js
├── README.md
├── ENTREGA.md               ← respuesta completa por pasos, con todo el código
├── .gitignore
├── public/
│   ├── manifest.json
│   ├── sw.js
│   ├── icons/
│   │   ├── icon-192.png
│   │   ├── icon-512.png
│   │   ├── icon-maskable-512.png
│   │   └── apple-touch-icon.png
│   └── ocr/                 ← generado por el script (no se versiona)
│       └── 7.0.0-7.0.0-spa1.0.0/
│           ├── worker.min.js
│           ├── core/tesseract-core{,-simd,-relaxedsimd}-lstm.wasm.js
│           └── lang/spa.traineddata.gz
├── scripts/
│   ├── rutas-ocr.mjs
│   ├── copiar-recursos-ocr.mjs
│   ├── generar-iconos.mjs
│   └── generar-entrega.mjs
├── src/
│   ├── main.jsx             ← monta React y registra el service worker
│   ├── index.css
│   └── App.jsx
└── tests/
    ├── parser.test.js
    └── e2e/navegador.e2e.mjs
```

## Paso 4. Código

El código completo está en los archivos del repositorio, comentado en español (interpretación de importes, ambigüedad, ciclo de vida del worker, voz, privacidad y errores). **`ENTREGA.md` reproduce cada archivo completo con su ruta encima del bloque de código.** Puntos clave:

### Interpretación de importes (`src/App.jsx`, sección 2)

- `normalizarTexto()` quita tildes, pasa a minúsculas y unifica espacios y saltos de línea. **No** cambia letras por números.
- `corregirOcrNumerico()`: solo cuando el número está pegado a «Bs» o «BOB» y la cadena tiene únicamente dígitos, «o», «.» y «,» con al menos un dígito real, la «o» se lee como cero (`Bs 5O,00` → 50,00). No se aplica en ningún otro contexto.
- `normalizarImporte()` devuelve **centavos enteros**:
  - Punto **y** coma: el separador final es el decimal (2 dígitos obligatorios) y el otro agrupa miles de 3 en 3. `1.250,50` y `1,250.50` → 125050.
  - Un solo separador con 2 dígitos → decimales (`20.50`, `20,50`).
  - **Un solo separador con 3 dígitos (`1.250`, `1,250`) es ambiguo**: normalmente es mil doscientos cincuenta, pero podría ser 1,25. No se adivina: se muestran las lecturas posibles y la persona elige. `1.257` solo admite la lectura de miles, pero igual se pide confirmar.
  - Un solo separador con 1 dígito (`20.5`) → 20,50, también con confirmación.
  - Se rechazan cero, signos, ceros a la izquierda (`050`), grupos mal formados y valores sobre el límite técnico.
- `extraerCandidatosDeMonto()` busca números con moneda antes (`Bs. 50`, `Bs50`, `BOB 100`), moneda después (`100 Bs`) o una etiqueta (`Monto: 100`). Descarta fechas, horas, códigos alfanuméricos, números sin moneda de 7 o más dígitos (teléfonos y cuentas), montos precedidos por saldo, comisión, cargo, ITF o disponible, y otras monedas (USD, $us). Puntaje: +2 con moneda, +5 con contexto fuerte (recibido, abono, abonado, te enviaron, monto de la transferencia…) o +2 con etiqueta genérica (monto, importe, total…).
- `seleccionarMonto()` unifica montos iguales y elige solo si el mejor supera al siguiente por **3 puntos o más**. Si no, pide elegir (`varios`). Si el mejor tiene formato ambiguo, pide revisar (`revisar`).
- `detectarEstadosAdversos()`: rechazada, pendiente, anulada, no realizada, fallida, revertida, cancelada, en proceso, denegada o devuelta. El resultado se muestra con una alerta roja y la voz empieza con «Atención: el texto dice pendiente…».
- `formatearMonto()` → `1.250,50`. `crearTextoParaVoz()` → «Monto detectado: 1250 bolivianos con 50 centavos. Revisa el abono en tu banco». Se usan dígitos **sin** separador de miles para que ninguna voz lea «uno punto doscientos».

Los formatos de Banco Unión, BCP, BNB, Banco Económico y Banco FIE pueden variar y cambiar. **No hay plantillas oficiales ni compatibilidad certificada.** Las pruebas usan textos sintéticos marcados como tales.

### OCR (`useOcr()` y `manejarArchivo()`)

- `import('tesseract.js')` y `createWorker()` se ejecutan solo al leer la primera imagen. El worker se **reutiliza** en las lecturas siguientes y se **termina tras 3 minutos sin uso** (`CONFIG.LIBERAR_WORKER_INACTIVO_MS`) para devolver memoria al teléfono. La siguiente lectura lo recrea desde la caché en ~1 s.
- **Error de Tesseract.js 7 que se esquiva:** si falla la descarga o la inicialización del modelo de idioma, `createWorker` no rechaza su promesa (solo llama a `errorHandler`). La app convierte ese aviso en un rechazo, termina el Web Worker interno y muestra «No se pudo descargar el lector…». El siguiente intento empieza de cero.
- `ocupadoRef` impide lecturas simultáneas y el input se deshabilita mientras se lee. `lecturaRef` numera cada lectura, así un resultado viejo se ignora si hubo cancelación o una lectura nueva. `montadoRef` evita actualizar el estado después de desmontar.
- `input.value = ''` permite elegir **el mismo archivo** otra vez.
- Validaciones: tipo `image/*` (o tipo vacío en algunos Android), máximo 10 MB, decodificación con `<img>` y máximo de 40 MP **antes** de dibujar en canvas.
- Canvas solo si hace falta: lado mayor > 2400 px se reduce, < 1000 px se amplía hasta x2, y los formatos que no son PNG ni JPG (WebP, HEIC en Safari) se convierten a PNG. Una captura normal se entrega **sin recomprimir**. No se binariza: un filtro agresivo borra comas y puntos decimales.
- El progreso se muestra por etapas y por porcentaje en saltos de 5 %. El lector de pantalla solo escucha los cambios de etapa.
- Al desmontar se termina el worker y se revocan las URL `blob:`.
- La confianza del OCR se muestra como «nitidez alta/media/baja. No indica si el pago es real».

### Voz (`useVoz()`)

- Solo usa voces en español con `localService === true`. Prioridad: `es-BO`, luego español latinoamericano, luego `es-ES`. **Nunca pasa en silencio a una voz remota**: si no hay voz local, muestra el mensaje y el monto sigue en pantalla.
- Escucha `voiceschanged` con `addEventListener`, así no pisa otros manejadores, y limpia al desmontar.
- Cancela la locución anterior, usa velocidad 0,95 y volumen 1, y maneja errores (`not-allowed`, sin respuesta en 2,5 s, etc.).
- Al tocar «Subir captura» se emite una locución **silenciosa** (volumen 0) que "desbloquea" la síntesis en Safari para iOS. Es una mejora de mejor esfuerzo.
- Después del OCR intenta hablar automáticamente. Si el navegador lo bloquea (frecuente en iOS), queda el botón grande «Escuchar monto».

### PWA

- `public/manifest.json`: `name`, `short_name`, `lang`, `start_url`, `scope`, `display: standalone`, colores, iconos de 192 y 512 px y un icono maskable con el contenido dentro del círculo seguro del 80 %.
- `index.html`: `apple-touch-icon`, `theme-color`, `viewport-fit=cover` (áreas seguras) e `interactive-widget=resizes-content` (teclado).
- Los iconos se generan con `npm run iconos` (Node puro, sin dependencias) y ya están incluidos.
- `public/sw.js`:
  - Precarga la app en `app-<hash>` y borra las versiones anteriores al activarse.
  - Los recursos OCR van a `ocr-recursos` con estrategia «primero caché» y solo cuando se descargan. Al activarse se eliminan las versiones viejas.
  - **Solo las navegaciones** reciben el `index.html` de respaldo. Los archivos OCR y WebAssembly nunca reciben HTML: si faltan, fallan y la app muestra un mensaje claro.
  - Actualización controlada: la versión nueva espera hasta que se pulsa «Actualizar ahora».

### Código completo de cada archivo

Recursos binarios que no se muestran como texto:
- `public/icons/*.png`: se generan con `npm run iconos` (script incluido abajo).
- `public/ocr/**`: se copian desde `node_modules` con `npm run dev` o `npm run build` (script incluido abajo).
- `package-lock.json`: lo genera `npm install`.

#### `package.json`

```json
{
  "name": "alerta-qr-bolivia",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "predev": "node scripts/copiar-recursos-ocr.mjs",
    "prebuild": "node scripts/copiar-recursos-ocr.mjs",
    "iconos": "node scripts/generar-iconos.mjs",
    "test:e2e": "npm run build && node tests/e2e/navegador.e2e.mjs",
    "entrega": "node scripts/generar-entrega.mjs"
  },
  "dependencies": {
    "react": "^19.3.0",
    "react-dom": "^19.3.0",
    "tesseract.js": "^7.0.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.3.3",
    "@tesseract.js-data/spa": "^1.0.0",
    "@vitejs/plugin-react": "^6.1.1",
    "playwright": "^1.56.1",
    "tailwindcss": "^4.3.3",
    "vite": "^8.3.1",
    "vitest": "^5.0.2"
  },
  "engines": {
    "node": ">=20.19"
  }
}
```

#### `index.html`

```html
<!doctype html>
<html lang="es-BO">
  <head>
    <meta charset="UTF-8" />
    <!--
      viewport-fit=cover: permite respetar las áreas seguras (muesca, barra de gestos)
      con env(safe-area-inset-*). interactive-widget=resizes-content: en Chrome para
      Android el teclado reduce el área visible en lugar de tapar los controles.
    -->
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content"
    />
    <title>Alerta QR Bolivia</title>
    <meta
      name="description"
      content="Lee en voz alta el monto de tu notificación bancaria. Procesa todo en tu teléfono. No verifica pagos: confirma el abono en tu banco."
    />
    <meta name="theme-color" content="#0b3d91" />
    <meta name="color-scheme" content="light" />
    <meta name="referrer" content="no-referrer" />
    <link rel="manifest" href="./manifest.json" />
    <link rel="icon" href="./icons/icon-192.png" type="image/png" sizes="192x192" />
    <link rel="apple-touch-icon" href="./icons/apple-touch-icon.png" />
    <!-- Metadatos para iOS al usar "Añadir a pantalla de inicio". -->
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="Alerta QR" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <meta name="format-detection" content="telephone=no" />
  </head>
  <body>
    <noscript>Alerta QR Bolivia necesita JavaScript activado para funcionar.</noscript>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

#### `vite.config.js`

```js
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
```

#### `src/main.jsx`

```jsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Registro del service worker (solo en producción: en desarrollo Vite sirve
// archivos que cambian constantemente y una caché estorbaría).
// Cuando hay una versión nueva en espera se avisa a la app con un evento; la
// persona decide cuándo actualizar (no recargamos en medio de una lectura).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  const habiaControlador = Boolean(navigator.serviceWorker.controller);
  let recargando = false;

  const avisarActualizacion = (worker) => {
    window.__alertaQrSwEnEspera = worker;
    window.dispatchEvent(new CustomEvent('alerta-qr:actualizacion'));
  };

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js', { scope: './' })
      .then((registro) => {
        if (registro.waiting && navigator.serviceWorker.controller) {
          avisarActualizacion(registro.waiting);
        }
        registro.addEventListener('updatefound', () => {
          const nuevo = registro.installing;
          if (!nuevo) return;
          nuevo.addEventListener('statechange', () => {
            if (nuevo.state === 'installed' && navigator.serviceWorker.controller) {
              avisarActualizacion(nuevo);
            }
          });
        });
      })
      .catch(() => {
        // Sin service worker la app sigue funcionando en línea.
      });
  });

  // Tras pulsar "Actualizar" (o si otra pestaña activó la versión nueva), el
  // worker nuevo toma el control y recargamos una sola vez. En la primera
  // instalación (clients.claim sin versión anterior) no recargamos.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (recargando) return;
    if (!habiaControlador && !window.__alertaQrActualizacionPedida) return;
    recargando = true;
    window.location.reload();
  });
}
```

#### `src/index.css`

```css
@import 'tailwindcss';

/* Colores de la marca como variables de Tailwind v4 (clases bg-marca, text-marca...). */
@theme {
  --color-marca: #0b3d91;
  --color-marca-oscuro: #082c69;
  --font-sans: system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', sans-serif;
}

@layer base {
  html {
    /* Evita que iOS agrande el texto al girar el teléfono. */
    -webkit-text-size-adjust: 100%;
    text-size-adjust: 100%;
  }

  body {
    @apply bg-slate-100 text-slate-900 antialiased;
    font-size: 1.0625rem;
    line-height: 1.5;
    overflow-x: hidden;
  }

  /* Foco siempre visible al navegar con teclado. */
  :focus-visible {
    outline: 3px solid #f59e0b;
    outline-offset: 3px;
  }

  button:disabled {
    cursor: not-allowed;
  }
}

/* Respeta la preferencia de reducir movimiento: sin animaciones ni scroll suave. */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

#### `src/App.jsx`

```jsx
/*
 * Alerta QR Bolivia — MVP
 *
 * Qué hace: lee (OCR) el texto de una captura de la notificación bancaria del
 * propio comerciante, o el texto de un SMS pegado, busca el monto en bolivianos
 * y lo dice en voz alta.
 *
 * Qué NO hace: no verifica pagos. El OCR reconoce letras; no autentica
 * comprobantes. Una imagen editada o un SMS falso pueden mostrar un monto
 * perfectamente legible. Sin integración bancaria no podemos saber si una
 * transacción existe o si el dinero llegó a la cuenta. Por eso la app habla de
 * "Monto detectado" y siempre pide revisar el abono en el banco.
 *
 * Privacidad: todo ocurre en el dispositivo.
 *  - La imagen se lee en memoria y se entrega al worker de Tesseract.js, que
 *    corre dentro del navegador. No hay backend ni se sube nada.
 *  - Los archivos que Tesseract.js descarga (worker, WebAssembly y modelo de
 *    idioma) son PROGRAMAS y DATOS DEL MODELO que bajan del mismo sitio; la
 *    imagen nunca viaja en sentido contrario.
 *  - El historial vive solo en memoria (estado de React) y guarda monto, hora y
 *    origen; nunca la imagen ni el texto completo. Se pierde al recargar.
 *  - No se escribe contenido bancario en la consola.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

/* =========================================================================
 * 1. CONFIGURACIÓN
 * ========================================================================= */

export const CONFIG = {
  // Límite TÉCNICO para descartar lecturas absurdas del OCR (por ejemplo, un
  // número de cuenta tomado como monto). No es un límite bancario. En
  // centavos: 10.000.000 = Bs 100.000,00. Ajústalo si tu negocio lo necesita.
  LIMITE_TECNICO_CENTAVOS: 10_000_000,
  // Tamaño máximo del archivo de imagen.
  TAMANO_MAXIMO_BYTES: 10 * 1024 * 1024,
  // Más de 40 megapíxeles puede agotar la memoria de un teléfono modesto.
  MAX_PIXELES: 40_000_000,
  // Las capturas de teléfono suelen medir 720–1440 px de ancho. Solo reducimos
  // si el lado mayor supera este valor (fotos de cámara muy grandes).
  LADO_MAXIMO_OCR: 2400,
  // Si la imagen es pequeña, se amplía (máx. x2) para que las letras tengan
  // suficientes píxeles; Tesseract reconoce mejor texto de ~20–30 px de alto.
  LADO_MINIMO_OCR: 1000,
  // Diferencia mínima de puntaje para elegir un monto sin preguntar.
  MARGEN_DECISION: 3,
  // Largo máximo del texto pegado (un SMS rara vez supera 500 caracteres).
  MAX_CARACTERES_TEXTO: 2000,
  // Tiempo para considerar que el navegador bloqueó la voz automática.
  ESPERA_INICIO_VOZ_MS: 2500,
  // Tras este tiempo sin lecturas se termina el worker de OCR para devolver
  // memoria al teléfono. La siguiente lectura lo recrea desde la caché (~1 s).
  LIBERAR_WORKER_INACTIVO_MS: 3 * 60 * 1000,
};

// Carpeta versionada de los recursos OCR (la inyecta vite.config.js).
const CARPETA_OCR = typeof __CARPETA_OCR__ === 'string' ? __CARPETA_OCR__ : 'ocr';
const NOMBRE_CACHE_OCR = 'ocr-recursos';
const NUCLEOS_OCR = [
  'tesseract-core-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-relaxedsimd-lstm.wasm.js',
];

/* =========================================================================
 * 2. INTERPRETACIÓN DE IMPORTES (funciones puras, probadas en tests/)
 * ========================================================================= */

/**
 * Normaliza el texto para buscar montos:
 *  - quita tildes (operación → operacion) y pasa a minúsculas;
 *  - convierte espacios especiales (no separables, tabulaciones) en espacios;
 *  - unifica saltos de línea y colapsa espacios repetidos.
 * NO cambia letras por números: eso se hace solo en contexto numérico (ver
 * `corregirOcrNumerico`).
 */
export function normalizarTexto(texto) {
  if (typeof texto !== 'string') return '';
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[   \t]/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/ {2,}/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Corrección OCR restringida: dentro de un número pegado a "Bs"/"BOB" el OCR a
 * veces lee la letra "o" en lugar del cero ("Bs 5O,00"). Solo se corrige si la
 * cadena contiene al menos un dígito real y únicamente dígitos, "o", "." y ",".
 * Nunca se aplica al texto completo ni fuera de ese contexto.
 */
export function corregirOcrNumerico(cadena) {
  if (!/\d/.test(cadena) || !/^[0-9o.,]+$/.test(cadena)) return null;
  return cadena.replace(/o/g, '0');
}

const invalido = (motivo) => ({ estado: 'invalido', motivo });

// Entero sin separadores. Rechaza ceros a la izquierda ("050"), que suelen ser
// códigos y no montos.
function enteroSimple(parte) {
  if (!/^(0|[1-9]\d{0,8})$/.test(parte)) return null;
  return Number(parte);
}

// Entero con separador de miles: primer grupo de 1–3 dígitos (sin cero
// inicial) y los demás de exactamente 3. "1.250.000" → 1250000.
function enteroConMiles(parte, separador) {
  const grupos = parte.split(separador);
  if (grupos.length < 2) return null;
  if (!/^[1-9]\d{0,2}$/.test(grupos[0])) return null;
  if (!grupos.slice(1).every((g) => /^\d{3}$/.test(g))) return null;
  return enteroSimple(grupos.join(''));
}

/**
 * Convierte una cadena numérica en CENTAVOS ENTEROS (evita errores de coma
 * flotante: 20,50 → 2050).
 *
 * Reglas conservadoras:
 *  - "50" → 5000.
 *  - Con punto Y coma, el separador que aparece AL FINAL es el decimal y debe
 *    tener exactamente 2 dígitos; el otro debe agrupar miles de 3 en 3:
 *    "1.250,50" y "1,250.50" → 125050.
 *  - Un solo separador seguido de 2 dígitos → decimales: "20.50", "20,50".
 *  - Un solo separador seguido de 3 dígitos ("1.250" o "1,250") es AMBIGUO:
 *    en Bolivia suele ser mil doscientos cincuenta, pero un sistema con otro
 *    formato podría querer decir 1,25 (si el último dígito es 0). No se adivina:
 *    se devuelven las opciones posibles para que la persona elija.
 *  - Un solo separador seguido de 1 dígito ("20.5") se entiende como 20,50,
 *    pero también se marca para revisión por ser un formato poco habitual.
 *  - Varios separadores iguales ("1.250.000") → solo miles.
 *  - Cualquier otra forma → inválido. También cero, negativos (el signo no se
 *    acepta) y valores sobre el límite técnico.
 *
 * Devuelve { estado: 'valido', centavos } | { estado: 'ambiguo', opciones,
 * motivo } | { estado: 'invalido', motivo }.
 */
export function normalizarImporte(cadena, limite = CONFIG.LIMITE_TECNICO_CENTAVOS) {
  const s = String(cadena ?? '').trim();
  if (!/^\d[\d.,]*$/.test(s) || /[.,]$/.test(s) || /[.,]{2}/.test(s)) {
    return invalido('formato');
  }
  const puntos = (s.match(/\./g) || []).length;
  const comas = (s.match(/,/g) || []).length;
  let opciones = [];
  let ambiguo = false;
  let motivoAmbiguo = null;

  if (!puntos && !comas) {
    const entero = enteroSimple(s);
    if (entero === null) return invalido('formato');
    opciones = [entero * 100];
  } else if (puntos && comas) {
    const decimal = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
    const miles = decimal === '.' ? ',' : '.';
    const posicion = s.lastIndexOf(decimal);
    const parteEntera = s.slice(0, posicion);
    const parteDecimal = s.slice(posicion + 1);
    if (parteEntera.includes(decimal) || parteDecimal.length !== 2) return invalido('formato');
    const entero = enteroConMiles(parteEntera, miles);
    if (entero === null) return invalido('formato');
    opciones = [entero * 100 + Number(parteDecimal)];
  } else {
    const separador = puntos ? '.' : ',';
    const partes = s.split(separador);
    if (partes.length > 2) {
      const entero = enteroConMiles(s, separador);
      if (entero === null) return invalido('formato');
      opciones = [entero * 100];
    } else {
      const [izquierda, derecha] = partes;
      const entero = enteroSimple(izquierda);
      if (derecha.length === 2) {
        if (entero === null) return invalido('formato');
        opciones = [entero * 100 + Number(derecha)];
      } else if (derecha.length === 1) {
        if (entero === null) return invalido('formato');
        opciones = [entero * 100 + Number(derecha) * 10];
        ambiguo = true;
        motivoAmbiguo = 'un-decimal';
      } else if (derecha.length === 3) {
        const comoMiles = enteroConMiles(s, separador);
        if (comoMiles !== null) opciones.push(comoMiles * 100);
        if (entero !== null && derecha.endsWith('0')) {
          opciones.push(entero * 100 + Number(derecha.slice(0, 2)));
        }
        ambiguo = true;
        motivoAmbiguo = 'separador-tres-digitos';
      } else {
        return invalido('formato');
      }
    }
  }

  opciones = [...new Set(opciones)].filter((c) => Number.isInteger(c) && c > 0);
  if (!opciones.length) return invalido('cero');
  opciones = opciones.filter((c) => c <= limite);
  if (!opciones.length) return invalido('fuera-de-limite');
  if (ambiguo) return { estado: 'ambiguo', opciones, motivo: motivoAmbiguo };
  return { estado: 'valido', centavos: opciones[0] };
}

// Palabras que indican que el monto NO es lo recibido: se descarta.
const CONTEXTO_EXCLUYENTE =
  /\b(saldo|comision|cargo|itf|disponible|deuda|costo|tarifa|impuesto|limite|cuota)\b/;
// Palabras de moneda extranjera: el monto no es en bolivianos.
const CONTEXTO_OTRA_MONEDA = /(\busd\b|\bus\$|\$us|\bdolar|\beur\b|\beuro|\$\s*$)/;
// Palabras que indican con fuerza el monto recibido.
const CONTEXTO_FUERTE =
  /(recib|abon|te envi|te transfiri|deposit|monto de la transferencia|importe de la transferencia)/;
// Etiquetas genéricas de monto.
const CONTEXTO_GENERICO = /\b(monto|importe|total|valor|por|transferencia|pago|qr)\b/;

// Separadores de frase para acotar el contexto de cada número. El punto solo
// cuenta como fin de frase si no es la abreviatura "Bs." o "Nro.".
const FIN_DE_FRASE = /\n|[;|]|,\s|(?<!\b(?:bs|nro|num|no|ref|cod|op))\.\s/g;

function contextoAnterior(texto, indice) {
  const ventana = texto.slice(Math.max(0, indice - 70), indice);
  let corte = 0;
  for (const m of ventana.matchAll(FIN_DE_FRASE)) corte = m.index + m[0].length;
  return ventana.slice(corte);
}

function contextoPosterior(texto, indiceFin) {
  return texto.slice(indiceFin, indiceFin + 25);
}

// ¿El número forma parte de una fecha (29/09/2026), hora (10:30), teléfono con
// guion o código alfanumérico? Revisa los caracteres vecinos.
function pareceFechaHoraOCodigo(texto, inicio, fin) {
  const antes = texto.slice(Math.max(0, inicio - 2), inicio);
  const despues = texto.slice(fin, fin + 2);
  if (/[/\-]$/.test(antes) || /^[/\-]\d/.test(despues)) return true;
  if (/\d:$/.test(antes) || /^:\d/.test(despues)) return true;
  if (/^[a-z0-9]/.test(despues)) return true;
  return false;
}

const NUM = '\\d(?:[\\d.,]*\\d)?';
const NUM_OCR = '[0-9o](?:[0-9o.,]*[0-9o])?';
// Moneda ANTES del número: "Bs. 50", "Bs50", "BOB 100", "Bs: 20,50".
const RE_MONEDA_ANTES = new RegExp(`(?<![a-z0-9])(?:bs|bob)(?![a-z])\\.?\\s{0,2}:?\\s{0,2}(${NUM_OCR})`, 'g');
// Moneda DESPUÉS del número: "100 Bs", "50 bolivianos".
const RE_MONEDA_DESPUES = new RegExp(`(${NUM})\\s?(?:bs|bob|bolivianos?)(?![a-z])`, 'g');
// Etiqueta sin moneda: "Monto: 100", "Importe recibido 150,00".
const RE_ETIQUETA = new RegExp(
  `\\b(?:monto|importe|total|abono|valor)(?:[a-z ]{0,30}?)\\s?:?\\s?(${NUM})`,
  'g',
);

/**
 * Busca todos los números que PODRÍAN ser el monto y les asigna un puntaje
 * según su contexto. Devuelve también los descartados, con el motivo, para
 * poder explicar y probar las decisiones.
 */
export function extraerCandidatosDeMonto(textoEntrada) {
  const texto = normalizarTexto(textoEntrada);
  const porPosicion = new Map();

  const registrar = (inicio, crudo, conMoneda) => {
    const previo = porPosicion.get(inicio);
    if (previo && (previo.conMoneda || !conMoneda)) return;
    porPosicion.set(inicio, { inicio, crudo, conMoneda });
  };

  for (const m of texto.matchAll(RE_MONEDA_ANTES)) {
    registrar(m.index + m[0].length - m[1].length, m[1], true);
  }
  for (const m of texto.matchAll(RE_MONEDA_DESPUES)) {
    registrar(m.index, m[1], true);
  }
  for (const m of texto.matchAll(RE_ETIQUETA)) {
    registrar(m.index + m[0].length - m[1].length, m[1], false);
  }

  const candidatos = [];
  for (const { inicio, crudo, conMoneda } of porPosicion.values()) {
    const fin = inicio + crudo.length;
    const base = { inicio, textoNumero: crudo, conMoneda, puntaje: 0, descartado: false };
    const numero = conMoneda ? corregirOcrNumerico(crudo) : crudo;
    if (numero === null) continue; // "bs o" u otra cadena sin dígitos.

    const antes = contextoAnterior(texto, inicio);
    const despues = contextoPosterior(texto, fin);
    const descartar = (motivo) => candidatos.push({ ...base, descartado: true, motivo });

    if (pareceFechaHoraOCodigo(texto, inicio, fin)) {
      descartar('fecha-hora-o-codigo');
      continue;
    }
    if (!conMoneda && numero.replace(/\D/g, '').length >= 7) {
      descartar('parece-telefono-o-cuenta');
      continue;
    }
    if (CONTEXTO_EXCLUYENTE.test(antes) || /^ (de|en) (saldo|comision)/.test(despues)) {
      descartar('saldo-o-comision');
      continue;
    }
    if (CONTEXTO_OTRA_MONEDA.test(antes)) {
      descartar('otra-moneda');
      continue;
    }

    const importe = normalizarImporte(numero);
    if (importe.estado === 'invalido') {
      descartar(`importe-${importe.motivo}`);
      continue;
    }

    let puntaje = conMoneda ? 2 : 0;
    if (CONTEXTO_FUERTE.test(antes)) puntaje += 5;
    else if (CONTEXTO_GENERICO.test(antes)) puntaje += 2;

    candidatos.push({
      ...base,
      puntaje,
      formatoAmbiguo: importe.estado === 'ambiguo',
      motivoFormato: importe.estado === 'ambiguo' ? importe.motivo : null,
      opciones: importe.estado === 'ambiguo' ? importe.opciones : [importe.centavos],
      centavos: importe.estado === 'valido' ? importe.centavos : null,
    });
  }
  return candidatos.sort((a, b) => a.inicio - b.inicio);
}

/**
 * Decide qué hacer con los candidatos:
 *  - 'ninguno': no hay montos válidos.
 *  - 'unico': un monto claramente mejor que el resto (margen suficiente).
 *  - 'revisar': el mejor candidato tiene formato ambiguo ("1.250").
 *  - 'varios': dos o más montos distintos igual de plausibles.
 * Los candidatos con el mismo valor se unifican (por ejemplo, "Bs 50" en el
 * título y "Monto: Bs 50" en el detalle).
 */
export function seleccionarMonto(candidatos, margen = CONFIG.MARGEN_DECISION) {
  const validos = candidatos.filter((c) => !c.descartado);
  if (!validos.length) return { tipo: 'ninguno' };

  const unificados = new Map();
  for (const c of validos) {
    const clave = c.formatoAmbiguo ? `a:${c.opciones.join('|')}` : `v:${c.centavos}`;
    const previo = unificados.get(clave);
    if (!previo) {
      unificados.set(clave, { ...c });
    } else {
      previo.puntaje = Math.max(previo.puntaje, c.puntaje);
      previo.conMoneda = previo.conMoneda || c.conMoneda;
    }
  }
  const lista = [...unificados.values()].sort((a, b) => b.puntaje - a.puntaje);
  const [mejor, segundo] = lista;

  if (mejor.formatoAmbiguo) {
    return { tipo: 'revisar', motivo: mejor.motivoFormato, opciones: mejor.opciones };
  }
  if (!segundo || mejor.puntaje - segundo.puntaje >= margen) {
    return { tipo: 'unico', centavos: mejor.centavos, monedaAsumida: !mejor.conMoneda };
  }
  const cercanos = lista.filter((c) => mejor.puntaje - c.puntaje < margen);
  const opciones = [...new Set(cercanos.flatMap((c) => c.opciones))].slice(0, 4);
  return { tipo: 'varios', opciones };
}

// Palabras que indican que la operación NO se completó.
const ESTADOS_ADVERSOS = [
  [/rechazad/, 'rechazada'],
  [/pendiente/, 'pendiente'],
  [/anulad/, 'anulada'],
  [/no (fue |ha sido )?realizad|no se realizo|no se pudo (realizar|completar|procesar)/, 'no realizada'],
  [/fallid|\bfallo\b/, 'fallida'],
  [/revertid/, 'revertida'],
  [/cancelad/, 'cancelada'],
  [/en proceso|procesando/, 'en proceso'],
  [/no exitos|denegad/, 'denegada'],
  [/devuelt/, 'devuelta'],
];

/** Devuelve las expresiones de estado adverso encontradas en el texto. */
export function detectarEstadosAdversos(texto) {
  const t = normalizarTexto(texto);
  return ESTADOS_ADVERSOS.filter(([re]) => re.test(t)).map(([, etiqueta]) => etiqueta);
}

/**
 * Punto de entrada del análisis. Devuelve un objeto con `tipo`
 * ('vacio' | 'ninguno' | 'unico' | 'revisar' | 'varios') y los datos
 * necesarios para la interfaz. Nunca inventa un monto.
 */
export function analizarTexto(texto) {
  const normalizado = normalizarTexto(texto);
  if (!normalizado) return { tipo: 'vacio', advertencias: [] };
  const seleccion = seleccionarMonto(extraerCandidatosDeMonto(normalizado));
  return { ...seleccion, advertencias: detectarEstadosAdversos(normalizado) };
}

/** 125050 → "1.250,50" (formato boliviano: punto para miles, coma decimal). */
export function formatearMonto(centavos) {
  const bs = Math.floor(centavos / 100);
  const cts = centavos % 100;
  const miles = String(bs).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${miles},${String(cts).padStart(2, '0')}`;
}

// Cantidad en palabras que cualquier voz en español lee bien. Se usan dígitos
// SIN separadores de miles ("1250"), porque "1.250" podría leerse como
// "uno punto doscientos cincuenta".
function cantidadHablada(centavos) {
  const bs = Math.floor(centavos / 100);
  const cts = centavos % 100;
  const textoBs = `${bs} ${bs === 1 ? 'boliviano' : 'bolivianos'}`;
  const textoCts = `${cts} ${cts === 1 ? 'centavo' : 'centavos'}`;
  if (bs > 0 && cts > 0) return `${textoBs} con ${textoCts}`;
  if (bs > 0) return textoBs;
  return textoCts;
}

/**
 * Frase para la voz. Nunca dice "pago recibido": solo "monto detectado".
 * Si el texto menciona un estado adverso, la frase empieza con una alerta.
 */
export function crearTextoParaVoz(centavos, { advertencias = [] } = {}) {
  const cantidad = cantidadHablada(centavos);
  if (advertencias.length) {
    return `Atención: el texto dice ${advertencias.join(' y ')}. Monto mencionado: ${cantidad}. No entregues mercadería sin revisar tu banco`;
  }
  return `Monto detectado: ${cantidad}. Revisa el abono en tu banco`;
}

export const FRASE_PRUEBA = '¡Prueba exitosa, el volumen está correcto!';

/* =========================================================================
 * 3. VOZ (Web Speech API)
 * ========================================================================= */

/**
 * Elige una voz LOCAL en español. No todas las voces de la Web Speech API se
 * ejecutan en el dispositivo: algunas (p. ej. "Google español" en Chrome de
 * escritorio) envían el texto a un servidor. Solo aceptamos voces con
 * localService === true. Prioridad: es-BO → español latinoamericano → otro
 * español. Si no hay ninguna local, devolvemos null y la app lo informa (no
 * cambiamos en silencio a una voz remota).
 */
export function elegirVozLocal(voces) {
  const locales = (voces || []).filter(
    (v) => v.localService === true && /^es([-_]|$)/i.test(v.lang || ''),
  );
  const idioma = (v) => (v.lang || '').replace('_', '-').toLowerCase();
  const prioridad = (v) => {
    const l = idioma(v);
    if (l === 'es-bo') return 0;
    if (/^es-(419|us|mx|pe|cl|ar|co|ec|py|uy|ve)$/.test(l)) return 1;
    if (l === 'es-es') return 2;
    return 3;
  };
  return [...locales].sort((a, b) => prioridad(a) - prioridad(b))[0] || null;
}

const MENSAJES_VOZ = {
  'sin-soporte':
    'Este navegador no puede leer en voz alta. El monto sigue en pantalla.',
  'sin-voz-local':
    'No hay una voz en español instalada en el teléfono. El monto sigue en pantalla. Puedes instalar una voz en los ajustes de "Texto a voz" del teléfono.',
  bloqueado: 'El navegador no dejó hablar automáticamente. Pulsa «Escuchar monto».',
  error: 'No se pudo reproducir la voz. El monto sigue en pantalla.',
};

function useVoz() {
  const soporte =
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof window.SpeechSynthesisUtterance === 'function';
  const [vozLocal, setVozLocal] = useState(null);
  const [vocesCargadas, setVocesCargadas] = useState(false);
  // Se guarda la locución activa: en Chrome, si el objeto se libera antes de
  // terminar, a veces no se disparan sus eventos.
  const locucionRef = useRef(null);

  useEffect(() => {
    if (!soporte) return undefined;
    const sintetizador = window.speechSynthesis;
    const cargar = () => {
      const voces = sintetizador.getVoices();
      setVozLocal(elegirVozLocal(voces));
      if (voces.length) setVocesCargadas(true);
    };
    cargar();
    // addEventListener en lugar de onvoiceschanged para no pisar otros manejadores.
    sintetizador.addEventListener?.('voiceschanged', cargar);
    return () => {
      sintetizador.removeEventListener?.('voiceschanged', cargar);
      sintetizador.cancel();
    };
  }, [soporte]);

  const detener = useCallback(() => {
    if (soporte) window.speechSynthesis.cancel();
  }, [soporte]);

  /**
   * Mejora de mejor esfuerzo para iOS: Safari solo permite hablar si la
   * primera locución ocurre durante un toque del usuario. Al tocar «Subir
   * captura» se emite una locución silenciosa (volumen 0) que "desbloquea" la
   * síntesis; así, cuando el OCR termina segundos después, la voz automática
   * tiene más probabilidades de sonar. No está garantizado.
   */
  const desbloqueadoRef = useRef(false);
  const desbloquear = useCallback(() => {
    if (!soporte || desbloqueadoRef.current) return;
    const voz = elegirVozLocal(window.speechSynthesis.getVoices());
    if (!voz) return;
    try {
      const silenciosa = new window.SpeechSynthesisUtterance(' ');
      silenciosa.voice = voz;
      silenciosa.lang = voz.lang;
      silenciosa.volume = 0;
      window.speechSynthesis.speak(silenciosa);
      desbloqueadoRef.current = true;
    } catch {
      // Sin desbloqueo queda el botón «Escuchar monto».
    }
  }, [soporte]);

  /**
   * Habla un texto. Devuelve una promesa que se resuelve con
   * { ok: true } o { ok: false, motivo } — nunca lanza errores.
   */
  const hablar = useCallback(
    (texto) =>
      new Promise((resolver) => {
        if (!soporte) {
          resolver({ ok: false, motivo: 'sin-soporte' });
          return;
        }
        const sintetizador = window.speechSynthesis;
        // Algunas plataformas cargan las voces tarde: se vuelve a consultar.
        const voz = elegirVozLocal(sintetizador.getVoices());
        if (!voz) {
          resolver({ ok: false, motivo: 'sin-voz-local' });
          return;
        }
        sintetizador.cancel(); // corta cualquier locución anterior
        let locucion;
        try {
          locucion = new window.SpeechSynthesisUtterance(texto);
          locucion.voice = voz;
          locucion.lang = voz.lang;
        } catch {
          resolver({ ok: false, motivo: 'error' });
          return;
        }
        locucion.rate = 0.95; // un poco más lento que lo normal, más claro
        locucion.pitch = 1;
        locucion.volume = 1; // máximo permitido; NO sube el volumen del sistema
        let empezo = false;
        let terminado = false;
        const terminar = (resultado) => {
          if (terminado) return;
          terminado = true;
          clearTimeout(temporizador);
          if (locucionRef.current === locucion) locucionRef.current = null;
          resolver(resultado);
        };
        // Si no empieza en unos segundos, el navegador probablemente la bloqueó
        // (p. ej. Safari en iOS fuera de un toque directo del usuario).
        const temporizador = setTimeout(() => {
          if (!empezo) {
            sintetizador.cancel();
            terminar({ ok: false, motivo: 'bloqueado' });
          }
        }, CONFIG.ESPERA_INICIO_VOZ_MS);
        locucion.onstart = () => {
          empezo = true;
        };
        locucion.onend = () => terminar({ ok: true });
        locucion.onerror = (evento) => {
          if (evento.error === 'interrupted' || evento.error === 'canceled') {
            terminar({ ok: true, interrumpida: true });
          } else if (evento.error === 'not-allowed') {
            terminar({ ok: false, motivo: 'bloqueado' });
          } else {
            terminar({ ok: false, motivo: 'error' });
          }
        };
        locucionRef.current = locucion;
        try {
          sintetizador.speak(locucion);
        } catch {
          terminar({ ok: false, motivo: 'error' });
        }
      }),
    [soporte],
  );

  return { soporte, vozLocal, vocesCargadas, hablar, detener, desbloquear };
}

/* =========================================================================
 * 4. OCR (Tesseract.js v7) — ciclo de vida del worker
 * ========================================================================= */

function urlRecursosOcr() {
  return new URL(`${CARPETA_OCR}/`, document.baseURI).href;
}

// ¿Están los recursos OCR guardados por el service worker? Solo entonces se
// puede prometer OCR sin conexión.
async function recursosOcrEnCache() {
  try {
    if (!('caches' in window) || !navigator.serviceWorker?.controller) return false;
    if (!(await caches.has(NOMBRE_CACHE_OCR))) return false;
    const cache = await caches.open(NOMBRE_CACHE_OCR);
    const base = urlRecursosOcr();
    const [worker, idioma, ...nucleos] = await Promise.all([
      cache.match(`${base}worker.min.js`),
      cache.match(`${base}lang/spa.traineddata.gz`),
      ...NUCLEOS_OCR.map((n) => cache.match(`${base}core/${n}`)),
    ]);
    return Boolean(worker && idioma && nucleos.some(Boolean));
  } catch {
    return false;
  }
}

/**
 * Crea el worker de Tesseract.js SOLO cuando se necesita (carga diferida con
 * import()) y lo reutiliza en las siguientes lecturas.
 *
 * Configuración (API de createWorker en v7: createWorker(idiomas, oem, opciones)):
 *  - 'spa': modelo de español; también reconoce dígitos y "Bs".
 *  - oem 1: motor LSTM (el único incluido en el núcleo "lstm", más liviano).
 *  - workerPath / corePath / langPath: rutas del MISMO ORIGEN (public/ocr/...),
 *    copiadas por scripts/copiar-recursos-ocr.mjs. Sin ellas Tesseract.js
 *    descargaría de un CDN externo.
 *  - workerBlobURL: false: el worker se crea directamente desde su URL, para
 *    que lo controle el service worker y la CSP no necesite blob: para scripts.
 *  - cacheMethod: 'none': no usa IndexedDB; la caché la maneja el service worker
 *    (un solo lugar, fácil de borrar y de versionar).
 *  - errorHandler: evita que Tesseract.js lance errores no capturados; los
 *    errores llegan igualmente a las promesas y se muestran con mensajes claros.
 */
function useOcr() {
  const workerPromesaRef = useRef(null);
  const oyenteProgresoRef = useRef(null);
  const enUsoRef = useRef(0); // lecturas o preparaciones en curso
  const temporizadorRef = useRef(null);

  const obtenerWorker = useCallback(() => {
    if (!workerPromesaRef.current) {
      const promesa = (async () => {
        const modulo = await import('tesseract.js');
        const createWorker = modulo.createWorker ?? modulo.default?.createWorker;
        const base = urlRecursosOcr();

        // En Tesseract.js 7, si falla la descarga del MODELO DE IDIOMA (o su
        // inicialización), la promesa de createWorker nunca se rechaza: solo se
        // llama a errorHandler. Para no dejar la lectura colgada:
        //  1) errorHandler rechaza nuestra propia promesa de inicio;
        //  2) se captura el Web Worker que crea la librería (lo crea de forma
        //     síncrona al llamar a createWorker) para poder terminarlo si falla.
        let rechazarInicio = null;
        const falloInicio = new Promise((_, rechazar) => {
          rechazarInicio = rechazar;
        });
        const WorkerOriginal = window.Worker;
        let hiloCapturado = null;
        window.Worker = class extends WorkerOriginal {
          constructor(...argumentos) {
            super(...argumentos);
            hiloCapturado = this;
          }
        };
        let creacion;
        try {
          creacion = createWorker('spa', 1, {
            workerPath: `${base}worker.min.js`,
            corePath: `${base}core`,
            langPath: `${base}lang`,
            workerBlobURL: false,
            cacheMethod: 'none',
            gzip: true,
            logger: (mensaje) => oyenteProgresoRef.current?.(mensaje),
            // Después del inicio, los errores llegan como rechazo de recognize().
            errorHandler: () => rechazarInicio?.(new Error('fallo-inicio-ocr')),
          });
        } finally {
          window.Worker = WorkerOriginal;
        }
        try {
          const worker = await Promise.race([creacion, falloInicio]);
          rechazarInicio = null;
          return worker;
        } catch (error) {
          rechazarInicio = null;
          hiloCapturado?.terminate();
          creacion.then((w) => w.terminate()).catch(() => {});
          throw error;
        }
      })();
      workerPromesaRef.current = promesa;
      // Si falla (por ejemplo, sin conexión), se olvida para reintentar luego.
      promesa.catch(() => {
        if (workerPromesaRef.current === promesa) workerPromesaRef.current = null;
      });
    }
    return workerPromesaRef.current;
  }, []);

  // Termina el worker y libera la memoria del modelo (~decenas de MB).
  const liberarWorker = useCallback(async () => {
    const promesa = workerPromesaRef.current;
    workerPromesaRef.current = null;
    if (!promesa) return;
    try {
      const worker = await promesa;
      await worker.terminate();
    } catch {
      // Si nunca llegó a crearse, no hay nada que liberar.
    }
  }, []);

  // Reutilización con límite: mientras haya uso activo el worker se conserva;
  // cuando queda inactivo se programa su liberación.
  const empezarUso = useCallback(() => {
    enUsoRef.current += 1;
    clearTimeout(temporizadorRef.current);
  }, []);

  const terminarUso = useCallback(() => {
    enUsoRef.current = Math.max(0, enUsoRef.current - 1);
    if (enUsoRef.current > 0) return;
    clearTimeout(temporizadorRef.current);
    temporizadorRef.current = setTimeout(() => {
      if (enUsoRef.current === 0) void liberarWorker();
    }, CONFIG.LIBERAR_WORKER_INACTIVO_MS);
  }, [liberarWorker]);

  // Al desmontar el componente se cancela el temporizador y se libera el worker.
  useEffect(
    () => () => {
      clearTimeout(temporizadorRef.current);
      void liberarWorker();
    },
    [liberarWorker],
  );

  return { obtenerWorker, liberarWorker, empezarUso, terminarUso, oyenteProgresoRef };
}

class ErrorLectura extends Error {
  constructor(codigo) {
    super(codigo);
    this.codigo = codigo;
  }
}

const MENSAJES_ERROR = {
  'no-es-imagen': 'Ese archivo no es una imagen compatible. Elige una captura en formato PNG o JPG.',
  'muy-pesada': 'La imagen pesa más de 10 MB. Usa una captura de pantalla (suelen pesar menos de 2 MB).',
  'imagen-danada': 'No pudimos abrir la imagen. Puede estar dañada o en un formato no compatible. Prueba con otra captura.',
  'imagen-enorme': 'La imagen es demasiado grande para procesarla en el teléfono. Usa una captura de pantalla en lugar de una foto.',
  'sin-texto': 'No encontramos texto en la imagen. Usa una captura de la notificación o pega el texto del SMS.',
  borrosa: 'No pudimos leer el monto. Prueba con una captura más nítida o pega el texto del SMS.',
  'sin-monto': 'No encontramos un monto en bolivianos. Prueba con una captura más nítida o pega el texto del SMS.',
  'sin-conexion':
    'Sin conexión: el lector de imágenes todavía no está preparado en este teléfono. Conéctate una vez para prepararlo o pega el texto del SMS.',
  'descarga-modelo':
    'No se pudo descargar el lector de imágenes. Revisa tu conexión e inténtalo otra vez, o pega el texto del SMS.',
  general: 'Algo falló al leer la imagen. Inténtalo otra vez o pega el texto del SMS.',
  'texto-vacio': 'Pega el texto del SMS antes de pulsar «Leer monto del texto».',
  'texto-sin-monto':
    'No encontramos un monto en bolivianos en el texto. Revisa que incluya el monto, por ejemplo «Bs 50».',
};

const FORMATOS_DIRECTOS = ['image/png', 'image/jpeg'];

function validarArchivo(archivo) {
  // Algunos Android no informan el tipo; en ese caso se intenta decodificar.
  if (archivo.type && !archivo.type.startsWith('image/')) throw new ErrorLectura('no-es-imagen');
  if (archivo.size > CONFIG.TAMANO_MAXIMO_BYTES) throw new ErrorLectura('muy-pesada');
  if (archivo.size === 0) throw new ErrorLectura('imagen-danada');
}

// Abre la imagen con el decodificador del navegador. `onload` entrega las
// dimensiones sin pintar la imagen completa, así podemos rechazar imágenes
// enormes ANTES de dibujarlas en un canvas.
function decodificarImagen(archivo) {
  return new Promise((resolver, rechazar) => {
    const url = URL.createObjectURL(archivo);
    const img = new Image();
    img.onload = () => {
      if (!img.naturalWidth || !img.naturalHeight) {
        URL.revokeObjectURL(url);
        rechazar(new ErrorLectura('imagen-danada'));
        return;
      }
      resolver({ img, url, ancho: img.naturalWidth, alto: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      rechazar(new ErrorLectura(archivo.type && !archivo.type.startsWith('image/') ? 'no-es-imagen' : 'imagen-danada'));
    };
    img.src = url;
  });
}

/**
 * Prepara la imagen para Tesseract:
 *  - Capturas PNG/JPG de tamaño normal: se entregan TAL CUAL (sin recomprimir,
 *    para no degradar el texto).
 *  - Lado mayor > 2400 px: se reduce proporcionalmente (fotos de cámara).
 *  - Lado mayor < 1000 px: se amplía hasta x2 (capturas muy pequeñas).
 *  - Otros formatos (WebP, HEIC en Safari, etc.): se convierten a PNG con canvas.
 * No se aplica binarización ni filtros: Tesseract ya lo hace internamente y
 * un filtro agresivo puede borrar comas y puntos decimales.
 */
async function prepararParaOcr({ img, ancho, alto }, archivo) {
  if (ancho * alto > CONFIG.MAX_PIXELES) throw new ErrorLectura('imagen-enorme');
  const lado = Math.max(ancho, alto);
  let escala = 1;
  if (lado > CONFIG.LADO_MAXIMO_OCR) escala = CONFIG.LADO_MAXIMO_OCR / lado;
  else if (lado < CONFIG.LADO_MINIMO_OCR) escala = Math.min(2, CONFIG.LADO_MINIMO_OCR / lado);
  if (escala === 1 && FORMATOS_DIRECTOS.includes(archivo.type)) return archivo;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(ancho * escala);
  canvas.height = Math.round(alto * escala);
  const contexto = canvas.getContext('2d');
  if (!contexto) throw new ErrorLectura('imagen-enorme');
  contexto.fillStyle = '#ffffff'; // fondo blanco para imágenes con transparencia
  contexto.fillRect(0, 0, canvas.width, canvas.height);
  contexto.imageSmoothingEnabled = true;
  contexto.imageSmoothingQuality = 'high';
  contexto.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolver) => canvas.toBlob(resolver, 'image/png'));
  // Libera la memoria del canvas de inmediato.
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) throw new ErrorLectura('imagen-enorme');
  return blob;
}

const ETAPAS_OCR = {
  'loading tesseract core': 'Preparando el lector de imágenes (la primera vez tarda más)',
  'initializing tesseract': 'Preparando el lector de imágenes',
  'loading language traineddata': 'Cargando el modelo de español (la primera vez tarda más)',
  'initializing api': 'Preparando el lector de imágenes',
  'recognizing text': 'Reconociendo el texto',
};

// La confianza del OCR describe la nitidez de la lectura, NO si el pago es real.
function calidadDeLectura(confianza) {
  if (typeof confianza !== 'number') return null;
  if (confianza >= 80) return 'alta';
  if (confianza >= 55) return 'media';
  return 'baja';
}

/* =========================================================================
 * 5. ESTADO DE LA PANTALLA
 * ========================================================================= */

// Fases: inicial → procesando → resultado | ambiguo | error → inicial.
const ESTADO_INICIAL = {
  fase: 'inicial',
  origen: null,
  etapa: null,
  porcentaje: null,
  centavos: null,
  opciones: [],
  motivoOpciones: null,
  advertencias: [],
  monedaAsumida: false,
  calidad: null,
  error: null,
  campoError: null,
};

function reductor(estado, accion) {
  switch (accion.tipo) {
    case 'INICIO':
      return { ...ESTADO_INICIAL, fase: 'procesando', origen: accion.origen, etapa: 'Abriendo la imagen' };
    case 'PROGRESO':
      if (estado.fase !== 'procesando') return estado;
      return { ...estado, etapa: accion.etapa, porcentaje: accion.porcentaje };
    case 'RESULTADO':
      return {
        ...ESTADO_INICIAL,
        fase: 'resultado',
        origen: accion.origen,
        centavos: accion.centavos,
        advertencias: accion.advertencias,
        monedaAsumida: accion.monedaAsumida,
        calidad: accion.calidad ?? null,
      };
    case 'OPCIONES':
      return {
        ...ESTADO_INICIAL,
        fase: 'ambiguo',
        origen: accion.origen,
        opciones: accion.opciones,
        motivoOpciones: accion.motivo,
        advertencias: accion.advertencias,
        calidad: accion.calidad ?? null,
      };
    case 'ELEGIR':
      return {
        ...estado,
        fase: 'resultado',
        centavos: accion.centavos,
        opciones: [],
        monedaAsumida: false,
      };
    case 'ERROR':
      return {
        ...ESTADO_INICIAL,
        fase: 'error',
        origen: accion.origen,
        error: accion.codigo,
        campoError: accion.campo,
      };
    case 'REINICIAR':
      return ESTADO_INICIAL;
    default:
      return estado;
  }
}

const TEXTO_FASE = {
  inicial: 'Listo',
  procesando: 'Leyendo imagen',
  resultado: 'Revisa el resultado',
  ambiguo: 'Revisa el resultado',
  error: 'No se pudo leer',
};

const ICONO_FASE = { inicial: '●', procesando: '◌', resultado: '✓', ambiguo: '?', error: '✕' };

const ETIQUETA_ORIGEN = { imagen: 'Imagen', texto: 'Texto pegado' };

function horaCorta(fecha) {
  try {
    return fecha.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return `${String(fecha.getHours()).padStart(2, '0')}:${String(fecha.getMinutes()).padStart(2, '0')}`;
  }
}

/* =========================================================================
 * 6. COMPONENTE PRINCIPAL
 * ========================================================================= */

const claseBotonPrincipal =
  'flex w-full min-h-14 items-center justify-center gap-2 rounded-2xl px-4 py-3 text-lg font-bold ' +
  'transition-colors disabled:opacity-50 disabled:saturate-50';
const claseBotonAzul = `${claseBotonPrincipal} bg-marca text-white hover:bg-marca-oscuro active:bg-marca-oscuro`;
const claseBotonBlanco = `${claseBotonPrincipal} border-2 border-marca bg-white text-marca hover:bg-blue-50`;

export default function App() {
  const [estado, despachar] = useReducer(reductor, ESTADO_INICIAL);
  const [texto, setTexto] = useState('');
  const [historial, setHistorial] = useState([]);
  const [vistaPrevia, setVistaPrevia] = useState(null);
  const [avisoVoz, setAvisoVoz] = useState(null);
  const [avisoPrueba, setAvisoPrueba] = useState(null);
  const [avisoPortapapeles, setAvisoPortapapeles] = useState(null);
  const [anuncio, setAnuncio] = useState('');
  const [enLinea, setEnLinea] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [preparacion, setPreparacion] = useState({ estado: 'sin-comprobar', etapa: null });
  const [hayActualizacion, setHayActualizacion] = useState(false);

  const voz = useVoz();
  const { obtenerWorker, liberarWorker, empezarUso, terminarUso, oyenteProgresoRef } = useOcr();

  const montadoRef = useRef(false);
  const ocupadoRef = useRef(false); // impide procesamientos simultáneos
  const lecturaRef = useRef(0); // identificador de la lectura vigente
  const vistaPreviaRef = useRef(null);
  const inputArchivoRef = useRef(null);
  const textareaRef = useRef(null);
  const resultadoRef = useRef(null);
  const ultimoProgresoRef = useRef({ etapa: null, porcentaje: null });

  const procesando = estado.fase === 'procesando';
  const puedePegar = typeof navigator !== 'undefined' && typeof navigator.clipboard?.readText === 'function';

  // --- Montaje / desmontaje -------------------------------------------------
  useEffect(() => {
    montadoRef.current = true;
    return () => {
      montadoRef.current = false;
      lecturaRef.current += 1; // invalida cualquier lectura en curso
      if (vistaPreviaRef.current) URL.revokeObjectURL(vistaPreviaRef.current);
      vistaPreviaRef.current = null;
    };
  }, []);

  // Cambia la vista previa revocando SIEMPRE la URL temporal anterior.
  const cambiarVistaPrevia = useCallback((url) => {
    if (vistaPreviaRef.current && vistaPreviaRef.current !== url) {
      URL.revokeObjectURL(vistaPreviaRef.current);
    }
    vistaPreviaRef.current = url;
    setVistaPrevia(url);
  }, []);

  // --- Conexión y actualizaciones de la PWA ---------------------------------
  useEffect(() => {
    const alCambiar = () => setEnLinea(navigator.onLine);
    const alActualizar = () => setHayActualizacion(true);
    window.addEventListener('online', alCambiar);
    window.addEventListener('offline', alCambiar);
    window.addEventListener('alerta-qr:actualizacion', alActualizar);
    if (window.__alertaQrSwEnEspera) setHayActualizacion(true);
    let activo = true;
    recursosOcrEnCache().then((listo) => {
      if (activo && listo) setPreparacion({ estado: 'listo', etapa: null });
    });
    return () => {
      activo = false;
      window.removeEventListener('online', alCambiar);
      window.removeEventListener('offline', alCambiar);
      window.removeEventListener('alerta-qr:actualizacion', alActualizar);
    };
  }, []);

  // Mueve el foco al resultado o al error para lectores de pantalla y para que
  // la persona vea la respuesta sin buscarla.
  useEffect(() => {
    if (estado.fase === 'error' && estado.campoError === 'texto') {
      textareaRef.current?.focus();
    } else if (['resultado', 'ambiguo', 'error'].includes(estado.fase)) {
      resultadoRef.current?.focus();
    }
  }, [estado.fase, estado.campoError, estado.centavos]);

  // --- Historial (solo memoria) ---------------------------------------------
  const agregarAlHistorial = useCallback((centavos, origen, advertencias) => {
    setHistorial((previo) =>
      [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          centavos,
          origen,
          hora: new Date(),
          conAdvertencia: advertencias.length > 0,
        },
        ...previo,
      ].slice(0, 3),
    );
  }, []);

  // --- Voz --------------------------------------------------------------------
  const decir = useCallback(
    async (frase, setAviso) => {
      setAviso(null);
      const resultado = await voz.hablar(frase);
      if (!montadoRef.current) return resultado;
      if (!resultado.ok) setAviso(MENSAJES_VOZ[resultado.motivo] || MENSAJES_VOZ.error);
      return resultado;
    },
    [voz],
  );

  const escucharMonto = useCallback(() => {
    if (estado.centavos == null) return;
    decir(crearTextoParaVoz(estado.centavos, { advertencias: estado.advertencias }), setAvisoVoz);
  }, [decir, estado.centavos, estado.advertencias]);

  const simularPrueba = useCallback(() => {
    // La prueba NO toca el historial ni el resultado.
    decir(FRASE_PRUEBA, setAvisoPrueba);
  }, [decir]);

  // --- Aplicar un análisis (común a imagen y texto) -------------------------
  const aplicarAnalisis = useCallback(
    (analisis, origen, calidad = null) => {
      if (analisis.tipo === 'unico') {
        despachar({
          tipo: 'RESULTADO',
          origen,
          centavos: analisis.centavos,
          advertencias: analisis.advertencias,
          monedaAsumida: analisis.monedaAsumida,
          calidad,
        });
        agregarAlHistorial(analisis.centavos, origen, analisis.advertencias);
        setAnuncio(`Monto detectado: ${formatearMonto(analisis.centavos)} bolivianos.`);
        // Intento de voz automática. Tras un proceso largo (OCR) el navegador
        // puede haber perdido el permiso del toque; si falla, queda el botón.
        decir(crearTextoParaVoz(analisis.centavos, { advertencias: analisis.advertencias }), setAvisoVoz);
      } else {
        despachar({
          tipo: 'OPCIONES',
          origen,
          opciones: analisis.opciones,
          motivo: analisis.tipo === 'revisar' ? analisis.motivo : 'varios',
          advertencias: analisis.advertencias,
          calidad,
        });
        setAnuncio('Revisa el resultado: elige el monto correcto.');
        // No se anuncia ninguna cantidad ambigua, solo que hay que revisar.
        decir(
          analisis.tipo === 'varios'
            ? 'Encontramos más de un monto posible. Elige el correcto en la pantalla'
            : 'Revisa el monto en la pantalla antes de continuar',
          setAvisoVoz,
        );
      }
    },
    [agregarAlHistorial, decir],
  );

  const mostrarError = useCallback((codigo, origen, campo) => {
    despachar({ tipo: 'ERROR', codigo, origen, campo });
    setAnuncio(MENSAJES_ERROR[codigo] || MENSAJES_ERROR.general);
  }, []);

  // --- Lectura de imagen ------------------------------------------------------
  const reportarProgreso = useCallback((mensaje, idLectura) => {
    if (!montadoRef.current || lecturaRef.current !== idLectura) return;
    const etapa = ETAPAS_OCR[mensaje.status];
    if (!etapa) return;
    const porcentaje =
      mensaje.status === 'recognizing text' && typeof mensaje.progress === 'number'
        ? Math.round(mensaje.progress * 100)
        : null;
    const previo = ultimoProgresoRef.current;
    // Evita renderizar por cada décima: solo cambios de etapa o de 5 %.
    if (previo.etapa === etapa && (porcentaje === null || Math.abs((previo.porcentaje ?? -10) - porcentaje) < 5)) {
      return;
    }
    if (previo.etapa !== etapa) setAnuncio(etapa); // al lector de pantalla, solo la etapa
    ultimoProgresoRef.current = { etapa, porcentaje };
    despachar({ tipo: 'PROGRESO', etapa, porcentaje });
  }, []);

  const manejarArchivo = useCallback(
    async (evento) => {
      const input = evento.target;
      const archivo = input.files?.[0];
      // Vaciar el input permite volver a elegir EL MISMO archivo.
      input.value = '';
      if (!archivo || ocupadoRef.current) return;

      ocupadoRef.current = true;
      empezarUso();
      const idLectura = ++lecturaRef.current;
      const vigente = () => montadoRef.current && lecturaRef.current === idLectura;
      voz.detener();
      setAvisoVoz(null);
      cambiarVistaPrevia(null);
      ultimoProgresoRef.current = { etapa: null, porcentaje: null };
      despachar({ tipo: 'INICIO', origen: 'imagen' });
      setAnuncio('Leyendo imagen');

      let urlImagen = null;
      try {
        validarArchivo(archivo);
        const imagen = await decodificarImagen(archivo);
        urlImagen = imagen.url;
        if (!vigente()) return;
        const entrada = await prepararParaOcr(imagen, archivo);
        if (!vigente()) return;
        cambiarVistaPrevia(urlImagen);
        urlImagen = null; // ahora la gestiona cambiarVistaPrevia

        if (!navigator.onLine && !(await recursosOcrEnCache())) {
          throw new ErrorLectura('sin-conexion');
        }
        oyenteProgresoRef.current = (m) => reportarProgreso(m, idLectura);
        let worker;
        try {
          worker = await obtenerWorker();
        } catch {
          throw new ErrorLectura(navigator.onLine ? 'descarga-modelo' : 'sin-conexion');
        }
        if (!vigente()) return;

        let datos;
        try {
          ({ data: datos } = await worker.recognize(entrada));
        } catch {
          // Un fallo dentro del worker puede dejarlo inestable: se recrea.
          await liberarWorker();
          throw new ErrorLectura('general');
        }
        if (!vigente()) return;

        // El texto reconocido se analiza aquí y se descarta; no se guarda.
        const textoOcr = datos?.text || '';
        const calidad = calidadDeLectura(datos?.confidence);
        if (textoOcr.replace(/[^a-z0-9]/gi, '').length < 6) {
          throw new ErrorLectura('sin-texto');
        }
        const analisis = analizarTexto(textoOcr);
        if (analisis.tipo === 'ninguno' || analisis.tipo === 'vacio') {
          throw new ErrorLectura(calidad === 'baja' ? 'borrosa' : 'sin-monto');
        }
        aplicarAnalisis(analisis, 'imagen', calidad);
      } catch (error) {
        if (urlImagen) URL.revokeObjectURL(urlImagen);
        if (vigente()) {
          mostrarError(error instanceof ErrorLectura ? error.codigo : 'general', 'imagen', 'imagen');
        }
      } finally {
        terminarUso();
        if (lecturaRef.current === idLectura) {
          ocupadoRef.current = false;
          oyenteProgresoRef.current = null;
        }
      }
    },
    [
      aplicarAnalisis,
      cambiarVistaPrevia,
      empezarUso,
      liberarWorker,
      mostrarError,
      obtenerWorker,
      oyenteProgresoRef,
      reportarProgreso,
      terminarUso,
      voz,
    ],
  );

  // Cancelar: invalida la lectura y termina el worker (Tesseract no permite
  // cancelar un reconocimiento a medias). La próxima lectura crea uno nuevo.
  const cancelarLectura = useCallback(() => {
    lecturaRef.current += 1;
    ocupadoRef.current = false;
    oyenteProgresoRef.current = null;
    void liberarWorker();
    cambiarVistaPrevia(null);
    despachar({ tipo: 'REINICIAR' });
    setAnuncio('Lectura cancelada. Listo.');
    inputArchivoRef.current?.focus();
  }, [cambiarVistaPrevia, liberarWorker, oyenteProgresoRef]);

  // --- Lectura de texto -------------------------------------------------------
  const leerTexto = useCallback(
    (evento) => {
      evento.preventDefault();
      if (ocupadoRef.current) return;
      lecturaRef.current += 1; // cualquier resultado anterior queda obsoleto
      voz.detener();
      setAvisoVoz(null);
      cambiarVistaPrevia(null);
      const analisis = analizarTexto(texto);
      if (analisis.tipo === 'vacio') {
        mostrarError('texto-vacio', 'texto', 'texto');
        return;
      }
      if (analisis.tipo === 'ninguno') {
        mostrarError('texto-sin-monto', 'texto', 'texto');
        return;
      }
      aplicarAnalisis(analisis, 'texto');
    },
    [aplicarAnalisis, cambiarVistaPrevia, mostrarError, texto, voz],
  );

  // Botón opcional: leer el portapapeles. Pegar manualmente siempre funciona.
  const pegarDesdePortapapeles = useCallback(async () => {
    setAvisoPortapapeles(null);
    try {
      const contenido = await navigator.clipboard.readText();
      if (!montadoRef.current) return;
      if (!contenido.trim()) {
        setAvisoPortapapeles('El portapapeles está vacío. Copia primero el SMS.');
        return;
      }
      setTexto(contenido.slice(0, CONFIG.MAX_CARACTERES_TEXTO));
      textareaRef.current?.focus();
    } catch {
      if (montadoRef.current) {
        setAvisoPortapapeles(
          'El navegador no permitió leer el portapapeles. Mantén presionado el campo de texto y elige «Pegar».',
        );
      }
    }
  }, []);

  // --- Selección manual cuando hay ambigüedad --------------------------------
  const elegirOpcion = useCallback(
    (centavos) => {
      despachar({ tipo: 'ELEGIR', centavos });
      agregarAlHistorial(centavos, estado.origen, estado.advertencias);
      setAnuncio(`Monto elegido: ${formatearMonto(centavos)} bolivianos.`);
      decir(crearTextoParaVoz(centavos, { advertencias: estado.advertencias }), setAvisoVoz);
    },
    [agregarAlHistorial, decir, estado.advertencias, estado.origen],
  );

  const leerOtro = useCallback(() => {
    lecturaRef.current += 1;
    voz.detener();
    setAvisoVoz(null);
    setTexto('');
    cambiarVistaPrevia(null);
    despachar({ tipo: 'REINICIAR' });
    setAnuncio('Listo para leer otro comprobante.');
    inputArchivoRef.current?.focus();
  }, [cambiarVistaPrevia, voz]);

  // --- Preparar OCR sin conexión ---------------------------------------------
  const prepararSinConexion = useCallback(async () => {
    if (!navigator.onLine) {
      setPreparacion({ estado: 'error', etapa: 'Necesitas conexión a internet para preparar el lector.' });
      return;
    }
    setPreparacion({ estado: 'preparando', etapa: 'Descargando el lector de imágenes…' });
    empezarUso();
    const oyenteAnterior = oyenteProgresoRef.current;
    if (!ocupadoRef.current) {
      oyenteProgresoRef.current = (m) => {
        const etapa = ETAPAS_OCR[m.status];
        if (etapa && montadoRef.current) setPreparacion({ estado: 'preparando', etapa });
      };
    }
    try {
      await obtenerWorker();
      const listo = await recursosOcrEnCache();
      if (!montadoRef.current) return;
      setPreparacion(
        listo
          ? { estado: 'listo', etapa: null }
          : {
              estado: 'solo-sesion',
              etapa:
                'El lector funciona ahora, pero este navegador no permitió guardarlo. Sin conexión puede no estar disponible.',
            },
      );
    } catch {
      if (montadoRef.current) {
        setPreparacion({ estado: 'error', etapa: 'No se pudo descargar el lector. Revisa tu conexión e inténtalo otra vez.' });
      }
    } finally {
      terminarUso();
      if (!ocupadoRef.current) oyenteProgresoRef.current = oyenteAnterior;
    }
  }, [empezarUso, obtenerWorker, oyenteProgresoRef, terminarUso]);

  const actualizarApp = useCallback(() => {
    const enEspera = window.__alertaQrSwEnEspera;
    if (!enEspera) return;
    // main.jsx recarga la página cuando la versión nueva toma el control.
    window.__alertaQrActualizacionPedida = true;
    enEspera.postMessage({ tipo: 'SALTAR_ESPERA' });
  }, []);

  /* ------------------------------------------------------------------------
   * Interfaz
   * ---------------------------------------------------------------------- */
  const errorImagen = estado.fase === 'error' && estado.campoError === 'imagen';
  const errorTexto = estado.fase === 'error' && estado.campoError === 'texto';

  return (
    <div
      className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-5 pb-8"
      style={{
        paddingTop: 'max(1rem, env(safe-area-inset-top))',
        paddingBottom: 'max(2rem, env(safe-area-inset-bottom))',
        paddingLeft: 'max(1rem, env(safe-area-inset-left))',
        paddingRight: 'max(1rem, env(safe-area-inset-right))',
      }}
    >
      {/* Región viva: anuncia cambios de fase, no cada punto de progreso. */}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {anuncio}
      </p>

      {hayActualizacion && (
        <div className="flex flex-col gap-2 rounded-2xl border-2 border-marca bg-blue-50 p-4" role="status">
          <p className="font-semibold">Hay una versión nueva de la app.</p>
          <button type="button" className={claseBotonAzul} onClick={actualizarApp} disabled={procesando}>
            Actualizar ahora
          </button>
          {procesando && <p className="text-base">Podrás actualizar cuando termine la lectura.</p>}
        </div>
      )}

      {/* A. Encabezado */}
      <header className="flex flex-col gap-3">
        <div>
          <h1 className="text-3xl font-extrabold leading-tight text-marca">Alerta QR Bolivia</h1>
          <p className="text-lg text-slate-700">Lee el monto de tu notificación bancaria</p>
        </div>
        <p className="flex items-center gap-2 text-base">
          <span className="font-semibold">Estado:</span>
          <span
            className={`inline-flex items-center gap-2 rounded-full border-2 px-3 py-1 font-bold ${
              estado.fase === 'error'
                ? 'border-red-700 bg-red-50 text-red-800'
                : estado.fase === 'procesando'
                  ? 'border-marca bg-blue-50 text-marca'
                  : estado.fase === 'inicial'
                    ? 'border-slate-500 bg-white text-slate-800'
                    : 'border-amber-600 bg-amber-50 text-amber-900'
            }`}
          >
            <span aria-hidden="true">{ICONO_FASE[estado.fase]}</span>
            {TEXTO_FASE[estado.fase]}
          </span>
        </p>
        <p className="rounded-xl border-l-8 border-amber-500 bg-amber-50 p-3 font-semibold text-amber-950">
          <span aria-hidden="true">⚠ </span>
          Esta app lee el comprobante. Confirma el ingreso en tu banco.
        </p>
        {!enLinea && (
          <p className="rounded-xl bg-slate-200 p-3 text-slate-900" role="status">
            Sin conexión. Puedes leer texto pegado.
            {preparacion.estado === 'listo'
              ? ' El lector de imágenes está preparado.'
              : ' El lector de imágenes necesita prepararse con conexión.'}
          </p>
        )}
      </header>

      <main className="flex flex-col gap-5">
        {/* B. Acción principal: subir captura */}
        <section aria-labelledby="titulo-captura" className="flex flex-col gap-2 rounded-3xl bg-white p-4 shadow-sm">
          <h2 id="titulo-captura" className="sr-only">
            Leer una captura
          </h2>
          {/*
            El input está oculto visualmente pero sigue siendo accesible: la
            etiqueta <label> actúa como botón gigante. Sin "capture": el caso
            principal es elegir una captura existente de la galería.
          */}
          <input
            ref={inputArchivoRef}
            id="archivo"
            type="file"
            accept="image/*"
            className="peer sr-only"
            onChange={manejarArchivo}
            onClick={voz.desbloquear}
            disabled={procesando}
            aria-describedby={`ayuda-archivo${errorImagen ? ' error-imagen' : ''}`}
            aria-invalid={errorImagen || undefined}
          />
          <label
            htmlFor="archivo"
            className={`flex min-h-24 w-full cursor-pointer select-none items-center justify-center gap-3 rounded-2xl bg-marca px-4 py-4 text-center text-xl font-extrabold text-white shadow-md peer-focus-visible:outline-4 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-amber-500 ${
              procesando ? 'cursor-not-allowed opacity-50' : 'hover:bg-marca-oscuro active:bg-marca-oscuro'
            }`}
            aria-disabled={procesando || undefined}
          >
            <span aria-hidden="true" className="text-3xl">
              🖼️
            </span>
            Subir captura del comprobante
          </label>
          <p id="ayuda-archivo" className="text-base text-slate-700">
            Usa una captura de tu propia app bancaria.
          </p>

          {procesando && (
            <div className="flex flex-col gap-3 rounded-2xl bg-blue-50 p-3">
              <p className="font-semibold text-marca">{estado.etapa}</p>
              <div
                role="progressbar"
                aria-label="Progreso de la lectura"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={estado.porcentaje ?? undefined}
                aria-valuetext={estado.porcentaje != null ? `${estado.porcentaje} %` : estado.etapa}
                className="h-4 w-full overflow-hidden rounded-full bg-blue-200"
              >
                <div
                  className={`h-full rounded-full bg-marca transition-all ${
                    estado.porcentaje == null ? 'w-1/3 motion-safe:animate-pulse' : ''
                  }`}
                  style={estado.porcentaje != null ? { width: `${Math.max(4, estado.porcentaje)}%` } : undefined}
                />
              </div>
              {estado.porcentaje != null && <p className="text-base">{estado.porcentaje} %</p>}
              <button type="button" className={claseBotonBlanco} onClick={cancelarLectura}>
                Cancelar lectura
              </button>
            </div>
          )}

          {errorImagen && (
            <div
              id="error-imagen"
              ref={resultadoRef}
              tabIndex={-1}
              className="rounded-2xl border-2 border-red-700 bg-red-50 p-3 text-red-900"
            >
              <p className="font-bold">
                <span aria-hidden="true">✕ </span>No se pudo leer
              </p>
              <p>{MENSAJES_ERROR[estado.error] || MENSAJES_ERROR.general}</p>
            </div>
          )}
        </section>

        {/* C. Alternativa por texto */}
        <section aria-labelledby="titulo-texto" className="rounded-3xl bg-white p-4 shadow-sm">
          <h2 id="titulo-texto" className="sr-only">
            Leer el texto de un SMS
          </h2>
          <form className="flex flex-col gap-3" onSubmit={leerTexto} noValidate>
            <label htmlFor="texto-sms" className="text-lg font-bold">
              O pega el texto del SMS aquí
            </label>
            <textarea
              ref={textareaRef}
              id="texto-sms"
              value={texto}
              onChange={(e) => setTexto(e.target.value.slice(0, CONFIG.MAX_CARACTERES_TEXTO))}
              rows={4}
              maxLength={CONFIG.MAX_CARACTERES_TEXTO}
              placeholder="Ejemplo: Recibiste Bs 50,00 de JUAN P."
              className="w-full scroll-mb-40 rounded-xl border-2 border-slate-500 p-3 text-lg focus:border-marca"
              aria-invalid={errorTexto || undefined}
              aria-describedby={errorTexto ? 'error-texto' : 'ayuda-texto'}
              enterKeyHint="done"
              autoComplete="off"
              spellCheck={false}
              disabled={procesando}
            />
            <p id="ayuda-texto" className="text-base text-slate-700">
              El texto se analiza en tu teléfono y no se guarda.
            </p>
            {errorTexto && (
              <p id="error-texto" className="rounded-xl border-2 border-red-700 bg-red-50 p-3 font-semibold text-red-900">
                <span aria-hidden="true">✕ </span>
                {MENSAJES_ERROR[estado.error]}
              </p>
            )}
            <button
              type="submit"
              className={claseBotonAzul}
              disabled={procesando}
              aria-describedby={procesando ? 'aviso-ocupado' : undefined}
            >
              <span aria-hidden="true">🔎</span> Leer monto del texto
            </button>
            {procesando && (
              <p id="aviso-ocupado" className="text-base font-semibold text-slate-800">
                Espera a que termine la lectura de la imagen o pulsa «Cancelar lectura».
              </p>
            )}
            {puedePegar && (
              <button type="button" className={claseBotonBlanco} onClick={pegarDesdePortapapeles} disabled={procesando}>
                <span aria-hidden="true">📋</span> Pegar desde el portapapeles
              </button>
            )}
            {avisoPortapapeles && (
              <p className="text-base font-semibold text-slate-900" role="status">
                {avisoPortapapeles}
              </p>
            )}
          </form>
        </section>

        {/* D. Prueba de sonido */}
        <section aria-labelledby="titulo-prueba" className="flex flex-col gap-2 rounded-3xl bg-white p-4 shadow-sm">
          <h2 id="titulo-prueba" className="text-lg font-bold">
            Prueba de sonido
          </h2>
          <button type="button" className={claseBotonBlanco} onClick={simularPrueba}>
            <span aria-hidden="true">🔊</span> Simular prueba
          </button>
          <p className="text-base text-slate-700">
            La app no puede subir el volumen del teléfono. Súbelo con los botones laterales.
          </p>
          {voz.soporte && voz.vocesCargadas && !voz.vozLocal && !avisoPrueba && (
            <p className="text-base font-semibold">{MENSAJES_VOZ['sin-voz-local']}</p>
          )}
          {avisoPrueba && (
            <p className="text-base font-semibold" role="status">
              {avisoPrueba}
            </p>
          )}
        </section>

        {/* E. Resultado */}
        {estado.fase === 'resultado' && (
          <section
            aria-labelledby="titulo-resultado"
            className="flex flex-col gap-3 rounded-3xl border-4 border-marca bg-white p-4 shadow-md"
          >
            <h2 id="titulo-resultado" ref={resultadoRef} tabIndex={-1} className="text-xl font-bold">
              Monto detectado
            </h2>
            <p className="break-words text-5xl font-extrabold tabular-nums text-slate-950">
              <span className="text-3xl">Bs</span> {formatearMonto(estado.centavos)}
            </p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-base">
              <dt className="font-semibold">Moneda:</dt>
              <dd>
                bolivianos
                {estado.monedaAsumida && ' (asumida: el texto no indica la moneda)'}
              </dd>
              <dt className="font-semibold">Origen:</dt>
              <dd>{ETIQUETA_ORIGEN[estado.origen]}</dd>
              {estado.calidad && (
                <>
                  <dt className="font-semibold">Lectura:</dt>
                  <dd>
                    nitidez {estado.calidad}. No indica si el pago es real.
                  </dd>
                </>
              )}
            </dl>
            <Advertencias lista={estado.advertencias} />
            <p className="rounded-xl bg-amber-50 p-3 text-base font-semibold text-amber-950">
              Antes de entregar mercadería, confirma el abono en la app o los movimientos de tu propia cuenta.
            </p>
            {vistaPrevia && (
              <img
                src={vistaPrevia}
                alt="Captura que se leyó"
                className="max-h-48 w-full rounded-xl border border-slate-300 object-contain"
              />
            )}
            <button type="button" className={claseBotonAzul} onClick={escucharMonto}>
              <span aria-hidden="true">🔊</span> Escuchar monto
            </button>
            {avisoVoz && (
              <p className="text-base font-semibold" role="status">
                {avisoVoz}
              </p>
            )}
            <button type="button" className={claseBotonBlanco} onClick={leerOtro}>
              Leer otro comprobante
            </button>
          </section>
        )}

        {estado.fase === 'ambiguo' && (
          <section
            aria-labelledby="titulo-ambiguo"
            className="flex flex-col gap-3 rounded-3xl border-4 border-amber-600 bg-white p-4 shadow-md"
          >
            <h2 id="titulo-ambiguo" ref={resultadoRef} tabIndex={-1} className="text-xl font-bold">
              <span aria-hidden="true">? </span>Revisa el resultado
            </h2>
            <p>
              {estado.motivoOpciones === 'separador-tres-digitos'
                ? 'El formato del monto es ambiguo (por ejemplo, «1.250» puede ser mil doscientos cincuenta o uno con veinticinco). Toca el monto que ves en tu comprobante:'
                : estado.motivoOpciones === 'un-decimal'
                  ? 'El monto tiene un formato poco habitual. Confirma si es este:'
                  : 'Encontramos más de un monto posible. Toca el que corresponde al abono:'}
            </p>
            <Advertencias lista={estado.advertencias} />
            <ul className="flex flex-col gap-2">
              {estado.opciones.map((centavos) => (
                <li key={centavos}>
                  <button type="button" className={claseBotonBlanco} onClick={() => elegirOpcion(centavos)}>
                    Bs {formatearMonto(centavos)}
                  </button>
                </li>
              ))}
            </ul>
            {vistaPrevia && (
              <img
                src={vistaPrevia}
                alt="Captura que se leyó"
                className="max-h-48 w-full rounded-xl border border-slate-300 object-contain"
              />
            )}
            {avisoVoz && (
              <p className="text-base font-semibold" role="status">
                {avisoVoz}
              </p>
            )}
            <button type="button" className={claseBotonBlanco} onClick={leerOtro}>
              Ninguno es correcto: leer otro comprobante
            </button>
          </section>
        )}

        {/* F. Historial temporal (solo memoria) */}
        <section aria-labelledby="titulo-historial" className="flex flex-col gap-3 rounded-3xl bg-white p-4 shadow-sm">
          <h2 id="titulo-historial" className="text-lg font-bold">
            Últimas 3 lecturas
          </h2>
          {historial.length === 0 ? (
            <p className="text-base text-slate-700">Todavía no hay lecturas. Se borran al cerrar o recargar la app.</p>
          ) : (
            <>
              <ol className="flex flex-col gap-2">
                {historial.map((item) => (
                  <li key={item.id} className="rounded-xl border border-slate-300 p-3">
                    <p className="text-2xl font-bold tabular-nums">Bs {formatearMonto(item.centavos)}</p>
                    <p className="text-base text-slate-700">
                      {horaCorta(item.hora)} · {ETIQUETA_ORIGEN[item.origen]}
                      {item.conAdvertencia && ' · ⚠ con advertencia de estado'}
                    </p>
                  </li>
                ))}
              </ol>
              <p className="text-sm text-slate-700">
                Son lecturas de texto, no pagos confirmados. Un monto repetido no significa un pago duplicado.
              </p>
              <button type="button" className={claseBotonBlanco} onClick={() => setHistorial([])}>
                Borrar historial
              </button>
            </>
          )}
        </section>

        {/* Ayuda: uso sin conexión e instalación */}
        <section className="rounded-3xl bg-white p-4 shadow-sm">
          <details>
            <summary className="flex min-h-14 cursor-pointer items-center text-lg font-bold">
              Usar sin internet e instalar
            </summary>
            <div className="flex flex-col gap-3 pt-2 text-base">
              <p>
                Leer texto pegado funciona sin internet. Para leer imágenes sin internet, prepara el lector una vez
                con conexión (descarga unos 6 MB). La descarga trae el programa lector; tus capturas nunca se suben.
              </p>
              <button
                type="button"
                className={claseBotonBlanco}
                onClick={prepararSinConexion}
                disabled={preparacion.estado === 'preparando' || procesando}
              >
                Preparar lectura de imágenes sin conexión
              </button>
              <p role="status" className="font-semibold">
                {preparacion.estado === 'listo' && '✓ Lector de imágenes listo para usar sin conexión.'}
                {preparacion.estado !== 'listo' && preparacion.etapa}
              </p>
              <p>
                <strong>Android (Chrome):</strong> abre el menú ⋮ y elige «Instalar aplicación» o «Añadir a pantalla
                de inicio».
              </p>
              <p>
                <strong>iPhone (Safari):</strong> toca Compartir (cuadro con flecha) y elige «Añadir a pantalla de
                inicio».
              </p>
              <p className="text-slate-700">
                Privacidad: sin cuentas, sin publicidad y sin seguimiento. Todo se procesa en este teléfono.
              </p>
            </div>
          </details>
        </section>
      </main>
    </div>
  );
}

function Advertencias({ lista }) {
  if (!lista.length) return null;
  return (
    <div className="rounded-xl border-2 border-red-700 bg-red-50 p-3 text-red-900">
      <p className="font-bold">
        <span aria-hidden="true">⚠ </span>Atención: el texto dice «{lista.join('», «')}».
      </p>
      <p>No lo tomes como ingreso. Revisa tu banco antes de entregar mercadería.</p>
    </div>
  );
}
```

#### `public/manifest.json`

```json
{
  "id": "./",
  "name": "Alerta QR Bolivia",
  "short_name": "Alerta QR",
  "description": "Lee en voz alta el monto de tu notificación bancaria. No verifica pagos: confirma el abono en tu banco.",
  "lang": "es-BO",
  "dir": "ltr",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "orientation": "portrait",
  "theme_color": "#0b3d91",
  "background_color": "#ffffff",
  "categories": ["business", "utilities"],
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

#### `public/sw.js`

```js
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
```

#### `scripts/rutas-ocr.mjs`

```js
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
```

#### `scripts/copiar-recursos-ocr.mjs`

```js
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
```

#### `scripts/generar-iconos.mjs`

```js
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
```

#### `scripts/generar-entrega.mjs`

```js
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
```

#### `tests/parser.test.js`

```js
// Pruebas del intérprete de montos. Todos los textos son EJEMPLOS SINTÉTICOS
// escritos para estas pruebas; no son plantillas oficiales de ningún banco.
import { describe, expect, it } from 'vitest';
import {
  analizarTexto,
  corregirOcrNumerico,
  crearTextoParaVoz,
  detectarEstadosAdversos,
  elegirVozLocal,
  extraerCandidatosDeMonto,
  formatearMonto,
  normalizarImporte,
  normalizarTexto,
} from '../src/App.jsx';

describe('normalizarTexto', () => {
  it('quita tildes, pasa a minúsculas y colapsa espacios', () => {
    expect(normalizarTexto('  Operación  EXITOSA \r\n\r\n\r\n Bs  50 ')).toBe('operacion exitosa\n\nbs 50');
  });
  it('tolera valores que no son texto', () => {
    expect(normalizarTexto(null)).toBe('');
  });
});

describe('normalizarImporte', () => {
  it.each([
    ['50', 5000],
    ['20.50', 2050],
    ['20,50', 2050],
    ['1.250,50', 125050],
    ['1,250.50', 125050],
    ['150,00', 15000],
    ['1.250.000', 125000000],
  ])('%s → %i centavos', (entrada, centavos) => {
    expect(normalizarImporte(entrada, Number.MAX_SAFE_INTEGER)).toEqual({ estado: 'valido', centavos });
  });

  it('marca "1.250" como ambiguo y ofrece ambas lecturas', () => {
    expect(normalizarImporte('1.250')).toEqual({
      estado: 'ambiguo',
      opciones: [125000, 125],
      motivo: 'separador-tres-digitos',
    });
  });

  it('"1.257" solo puede ser miles, pero igual pide revisión', () => {
    expect(normalizarImporte('1.257')).toEqual({ estado: 'ambiguo', opciones: [125700], motivo: 'separador-tres-digitos' });
  });

  it.each(['0', '0,00', '-50', '1.2.3', '12,3456', '050', '1..0', '1.250,5', 'abc', ''])(
    'rechaza "%s"',
    (entrada) => {
      expect(normalizarImporte(entrada).estado).toBe('invalido');
    },
  );

  it('rechaza valores sobre el límite técnico', () => {
    expect(normalizarImporte('500000')).toEqual({ estado: 'invalido', motivo: 'fuera-de-limite' });
  });
});

describe('corregirOcrNumerico', () => {
  it('cambia "o" por cero solo en una cadena numérica', () => {
    expect(corregirOcrNumerico('5o,oo')).toBe('50,00');
    expect(corregirOcrNumerico('oo')).toBeNull();
  });
  it('lo aplica al leer "Bs 5O,00" pero no a palabras', () => {
    expect(analizarTexto('Recibiste Bs 5O,00 de Pedro')).toMatchObject({ tipo: 'unico', centavos: 5000 });
  });
});

describe('formatos mínimos reconocidos', () => {
  it.each([
    ['Bs. 50', 5000],
    ['Bs50', 5000],
    ['Bs 50', 5000],
    ['Bs. 20.50', 2050],
    ['Bs 20,50', 2050],
    ['BOB 100', 10000],
    ['100 Bs', 10000],
    ['Monto: 100', 10000],
    ['Importe: Bs. 150,00', 15000],
    ['Monto recibido: Bs 1.250,50', 125050],
    ['Monto abonado: BOB 1,250.50', 125050],
    ['MONTO   RECIBIDO:\n  bs 75,00', 7500],
  ])('%j → %i', (entrada, centavos) => {
    expect(analizarTexto(entrada)).toMatchObject({ tipo: 'unico', centavos });
  });
});

describe('tabla de casos mínimos', () => {
  it('1. Recibiste Bs. 50 → 50,00', () => {
    expect(analizarTexto('Recibiste Bs. 50')).toMatchObject({ tipo: 'unico', centavos: 5000, advertencias: [] });
  });
  it('2. Abono recibido: Bs50 → 50,00', () => {
    expect(analizarTexto('Abono recibido: Bs50')).toMatchObject({ tipo: 'unico', centavos: 5000 });
  });
  it('3. Monto: 100 → 100,00 con moneda asumida', () => {
    expect(analizarTexto('Monto: 100')).toMatchObject({ tipo: 'unico', centavos: 10000, monedaAsumida: true });
  });
  it('4. Importe: Bs. 20.50 → 20,50', () => {
    expect(analizarTexto('Importe: Bs. 20.50')).toMatchObject({ tipo: 'unico', centavos: 2050, monedaAsumida: false });
  });
  it('5. Monto abonado: Bs 1.250,50 → 1250,50', () => {
    expect(analizarTexto('Monto abonado: Bs 1.250,50')).toMatchObject({ tipo: 'unico', centavos: 125050 });
  });
  it('6. Monto abonado: BOB 1,250.50 → 1250,50', () => {
    expect(analizarTexto('Monto abonado: BOB 1,250.50')).toMatchObject({ tipo: 'unico', centavos: 125050 });
  });
  it('7. Saldo: Bs 500. Monto recibido: Bs 50 → 50,00', () => {
    expect(analizarTexto('Saldo: Bs 500. Monto recibido: Bs 50')).toMatchObject({ tipo: 'unico', centavos: 5000 });
    expect(analizarTexto('Saldo: Bs. 500. Monto recibido: Bs. 50')).toMatchObject({ tipo: 'unico', centavos: 5000 });
  });
  it('8. Operación 123456. Fecha 29/09/2026 → ningún monto', () => {
    expect(analizarTexto('Operación 123456. Fecha 29/09/2026')).toMatchObject({ tipo: 'ninguno' });
  });
  it('9. Transferencia pendiente → advertencia', () => {
    expect(analizarTexto('Transferencia pendiente por Bs 50')).toMatchObject({
      tipo: 'unico',
      centavos: 5000,
      advertencias: ['pendiente'],
    });
  });
  it('10. Transacción rechazada → advertencia', () => {
    expect(analizarTexto('Transacción rechazada. Monto Bs 50')).toMatchObject({
      centavos: 5000,
      advertencias: ['rechazada'],
    });
  });
  it('11. Dos importes igualmente plausibles → selección manual', () => {
    expect(analizarTexto('Recibiste Bs 50. Recibiste Bs 80')).toEqual({
      tipo: 'varios',
      opciones: [5000, 8000],
      advertencias: [],
    });
  });
  it('12. Texto vacío → vacío', () => {
    expect(analizarTexto('   \n ')).toEqual({ tipo: 'vacio', advertencias: [] });
  });
  it('13. Texto de OCR sin montos (imagen sin texto útil) → ninguno', () => {
    expect(analizarTexto('~~ |||  ..')).toMatchObject({ tipo: 'ninguno' });
  });
  it('14. Formato ambiguo → revisión sin adivinar', () => {
    expect(analizarTexto('Monto recibido: Bs 1.250')).toMatchObject({
      tipo: 'revisar',
      opciones: [125000, 125],
    });
  });
});

describe('no confunde montos con otros números', () => {
  it.each([
    ['Hora 10:30. Cel 71234567. Cuenta 1234567890', 'ninguno'],
    ['Nro. de operación: 998877. Referencia 4455', 'ninguno'],
    ['Comisión Bs 2,00', 'ninguno'],
    ['Saldo disponible: Bs 1.500,00', 'ninguno'],
    ['Monto: USD 50', 'ninguno'],
    ['Monto: Bs -50', 'ninguno'],
    ['Monto: -50', 'ninguno'],
    ['Recibiste Bs 0,00', 'ninguno'],
    ['Monto recibido: Bs 999999999', 'ninguno'],
  ])('%j → %s', (entrada, tipo) => {
    expect(analizarTexto(entrada).tipo).toBe(tipo);
  });

  it('ignora la comisión y el saldo en un texto completo', () => {
    const sms =
      'BANCO EJEMPLO (sintético): Recibiste una transferencia de MARIA L.\n' +
      'Monto recibido: Bs 35,50\nComisión: Bs 0,00\nSaldo: Bs 1.220,00\n' +
      'Fecha 29/09/2026 14:05 Nro. operación 123456789';
    expect(analizarTexto(sms)).toMatchObject({ tipo: 'unico', centavos: 3550, advertencias: [] });
  });

  it('unifica montos repetidos', () => {
    expect(analizarTexto('Te enviaron Bs 20,00\nImporte: Bs 20.00')).toMatchObject({ tipo: 'unico', centavos: 2000 });
  });

  it('informa por qué descartó cada candidato', () => {
    const motivos = extraerCandidatosDeMonto('Saldo: Bs 500. Fecha 29/09/2026 Monto recibido: Bs 50')
      .filter((c) => c.descartado)
      .map((c) => c.motivo);
    expect(motivos).toContain('saldo-o-comision');
  });
});

describe('estados adversos', () => {
  it.each([
    ['Transferencia ANULADA', ['anulada']],
    ['La operación no fue realizada', ['no realizada']],
    ['Pago exitoso', []],
  ])('%j', (texto, esperado) => {
    expect(detectarEstadosAdversos(texto)).toEqual(esperado);
  });
});

describe('formato y voz', () => {
  it('formatea en estilo boliviano', () => {
    expect(formatearMonto(125050)).toBe('1.250,50');
    expect(formatearMonto(5000)).toBe('50,00');
    expect(formatearMonto(5)).toBe('0,05');
  });
  it('frase predeterminada', () => {
    expect(crearTextoParaVoz(5000)).toBe('Monto detectado: 50 bolivianos. Revisa el abono en tu banco');
  });
  it('frase con centavos y sin separador de miles', () => {
    expect(crearTextoParaVoz(2050)).toBe(
      'Monto detectado: 20 bolivianos con 50 centavos. Revisa el abono en tu banco',
    );
    expect(crearTextoParaVoz(125050)).toBe(
      'Monto detectado: 1250 bolivianos con 50 centavos. Revisa el abono en tu banco',
    );
    expect(crearTextoParaVoz(101)).toBe('Monto detectado: 1 boliviano con 1 centavo. Revisa el abono en tu banco');
  });
  it('nunca dice "pago recibido" y alerta estados adversos', () => {
    const frase = crearTextoParaVoz(5000, { advertencias: ['pendiente'] });
    expect(frase).toMatch(/^Atención: el texto dice pendiente/);
    expect(frase.toLowerCase()).not.toContain('pago recibido');
  });
});

describe('elegirVozLocal', () => {
  const voz = (lang, localService, name = lang) => ({ lang, localService, name });
  it('prefiere es-BO local', () => {
    expect(elegirVozLocal([voz('es-ES', true), voz('es-BO', true), voz('es-MX', true)]).lang).toBe('es-BO');
  });
  it('usa otra voz local en español como alternativa', () => {
    expect(elegirVozLocal([voz('es-BO', false), voz('es-ES', true)]).lang).toBe('es-ES');
  });
  it('no usa voces remotas ni de otro idioma', () => {
    expect(elegirVozLocal([voz('es-BO', false), voz('en-US', true)])).toBeNull();
  });
});
```

#### `tests/e2e/navegador.e2e.mjs`

```js
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
```

#### `.gitignore`

```gitignore
node_modules/
dist/
# Recursos OCR: se copian desde node_modules con "npm run dev" / "npm run build".
public/ocr/
*.log
.DS_Store
```

## Paso 5. Pruebas

```bash
npm test
```

`tests/parser.test.js`: **72 pruebas**, todas pasan.

### Casos mínimos

| # | Entrada | Resultado esperado | Motivo |
|---|---|---|---|
| 1 | `Recibiste Bs. 50` | 50,00 | Moneda y contexto fuerte («recib») |
| 2 | `Abono recibido: Bs50` | 50,00 | «Bs» pegado al número |
| 3 | `Monto: 100` | 100,00, **moneda asumida** | Solo etiqueta; la pantalla dice «asumida: el texto no indica la moneda» |
| 4 | `Importe: Bs. 20.50` | 20,50 | Un separador + 2 dígitos = decimales |
| 5 | `Monto abonado: Bs 1.250,50` | 1250,50 | Punto de miles, coma decimal |
| 6 | `Monto abonado: BOB 1,250.50` | 1250,50 | Coma de miles, punto decimal |
| 7 | `Saldo: Bs 500. Monto recibido: Bs 50` | 50,00 | «Saldo» descarta 500 |
| 8 | `Operación 123456. Fecha 29/09/2026` | Ningún monto | Sin moneda ni etiqueta; fecha excluida |
| 9 | `Transferencia pendiente por Bs 50` | 50,00 + advertencia «pendiente» | No se presenta como ingreso |
| 10 | `Transacción rechazada. Monto Bs 50` | 50,00 + advertencia «rechazada» | Ídem |
| 11 | `Recibiste Bs 50. Recibiste Bs 80` | Elegir entre 50,00 y 80,00 | Igual de plausibles |
| 12 | Texto vacío | «Pega el texto del SMS antes de pulsar…» | Error junto al campo |
| 13 | Imagen sin texto | «No encontramos texto en la imagen…» | Menos de 6 caracteres reconocidos (probado en navegador) |
| 14 | `Monto recibido: Bs 1.250` | Revisar: 1.250,00 o 1,25 | Formato ambiguo, no se adivina |
| 15 | Sin voz local | Monto visible + «No hay una voz en español instalada…» | Probado en Chromium sin voces |

También cubren: los 11 formatos mínimos, `Bs 5O,00` (corrección OCR), hora, teléfono, cuenta, referencia, comisión, saldo disponible, USD, un SMS completo con saldo y comisión, montos repetidos que se unifican, negativos, cero y valores sobre el límite, estados adversos, formato boliviano, frases de voz (singular y plural, sin «pago recibido») y la selección de voz local, con descarte de voces remotas y de otros idiomas.

### Pruebas ejecutadas realmente: `npm run test:e2e`

Se ejecutaron en **Chromium 141** sin interfaz, con Playwright, contra el build de producción. Resultado: **54 de 54 comprobaciones correctas**. Se repiten en dos perfiles emulados: tamaño de **iPhone SE (320 × 568)** y **Pixel 7**, ambos con pantalla táctil y agente de usuario móvil.

| Área | Comprobación | Resultado |
|---|---|---|
| PWA | Manifest sin errores e instalable según Chromium (`Page.getInstallabilityErrors`) | ✅ |
| Diseño | Sin desplazamiento horizontal a 320 px y a 412 px | ✅ |
| Diseño | Todos los botones visibles miden ≥ 56 px de alto | ✅ |
| Teclado | El primer Tab enfoca «Subir captura» | ✅ |
| Texto | Vacío: error junto al campo (`aria-invalid`, `aria-describedby`) | ✅ |
| Texto | `Saldo: Bs 500. Monto recibido: Bs 50` → Bs 50,00 | ✅ |
| Texto | Dos montos plausibles → selección manual | ✅ |
| Texto | `1.250` → revisar (1.250,00 o 1,25) | ✅ |
| Texto | «pendiente» → advertencia visible | ✅ |
| Voz | Sin voces: el monto sigue visible y aparece un mensaje | ✅ |
| Voz | Voz local simulada: dice exactamente la frase de prueba y la del monto; ignora la voz remota; la prueba no agrega historial | ✅ |
| Portapapeles | Permiso denegado → alternativa de pegar a mano | ✅ |
| Imagen | Archivo que no es imagen, imagen dañada, > 10 MB, 42 MP → mensajes específicos | ✅ |
| OCR | Captura sintética → Bs 35,50 (~1,3 s, incluida la preparación del lector) | ✅ |
| OCR | Mismo archivo otra vez; selecciones rápidas → una sola lectura | ✅ |
| OCR | Imagen en blanco → «No encontramos texto» | ✅ |
| OCR | Captura borrosa → «No encontramos texto en la imagen»; la interfaz sigue usable | ✅ |
| OCR | Cancelar a mitad → «Listo» con controles activos | ✅ |
| Estado | Historial con máximo 3 entradas; recargar lo borra | ✅ |
| Sin conexión | Con el lector preparado: abre, lee texto y hace OCR | ✅ |
| Sin conexión | Sin preparar → «el lector de imágenes todavía no está preparado» | ✅ |
| Errores | Modelo con HTTP 503 → «No se pudo descargar el lector»; el reintento funciona | ✅ |
| PWA | Botón «Preparar lectura sin conexión» → «Lector listo» | ✅ |
| PWA | Versión nueva del service worker → aviso → «Actualizar ahora» → recarga | ✅ |
| Privacidad | Ninguna petición a otros dominios; sin errores en la consola | ✅ |

**No se ejecutaron** pruebas en Chrome para Android ni en Safari para iOS **reales**. La emulación de Chromium no reproduce WebKit, las voces del sistema, el selector de fotos ni la memoria de un teléfono. Hazlas con esta lista:

1. Instalar la app (ver Paso 6) y abrirla desde el icono.
2. Subir una captura real de **tu propia** app bancaria y comparar el monto.
3. Pulsar «Simular prueba» con el volumen alto y luego con el teléfono en silencio.
4. Revisar si la voz automática suena después del OCR. En iOS se espera que a veces no suene y se use «Escuchar monto».
5. Pegar un SMS con pulsación larga → «Pegar». Probar el botón del portapapeles y denegar el permiso.
6. Abrir el teclado: el botón «Leer monto del texto» debe seguir accesible.
7. Pulsar «Preparar lectura de imágenes sin conexión», activar el modo avión, cerrar y abrir la app, leer una captura.
8. Elegir el mismo archivo dos veces seguidas y tocar varias veces el botón de subir.
9. Probar con TalkBack o VoiceOver: estado, errores y resultado se anuncian.
10. Activar «Reducir movimiento» y aumentar el tamaño de letra del sistema.

## Paso 6. Despliegue

La compilación produce **solo archivos estáticos** en `dist/`: `index.html`, `assets/`, `icons/`, `manifest.json`, `sw.js` y `ocr/`. Sirve en cualquier hosting estático con **HTTPS**. El service worker y la instalación exigen un contexto seguro; `localhost` también cuenta.

- Comando de build: `npm run build`
- Directorio de salida: `dist`
- `base: './'`: funciona en la raíz del dominio o en una subcarpeta.
- **No hace falta `vercel.json`.** No hay rutas del lado del cliente que reescribir (es una sola página), ni funciones, ni cabeceras obligatorias. Los navegadores revisan `sw.js` sin usar la caché HTTP, y los archivos de `assets/` llevan hash.

### ¿Vercel Hobby sirve para este caso?

Según la documentación oficial de Vercel ([plan Hobby](https://vercel.com/docs/plans/hobby) y [Fair Use Guidelines](https://vercel.com/docs/limits/fair-use-guidelines)), **Hobby está limitado a uso personal y no comercial**. Todo uso comercial requiere Pro o Enterprise. Vercel define como comercial cualquier despliegue usado para la ganancia económica de cualquier persona que participe en el proyecto, incluido quien cobra por escribir el código.

Una herramienta que se ofrece a comerciantes para su negocio, o por la que alguien cobra (desarrollo, mantenimiento o suscripción), **no es elegible para Hobby**. En ese caso usa **Vercel Pro** (la arquitectura es 100 % compatible: *Framework preset* Vite, build `npm run build`, salida `dist`) o una alternativa estática.

La red del entorno de trabajo bloqueó la descarga directa de esas páginas. La frase textual de la documentación oficial, «Hobby teams are restricted to non-commercial personal use only», se confirmó mediante resultados de búsqueda que indexan esa página. **Vuelve a leer las condiciones vigentes antes de publicar.**

### Alternativa: Cloudflare Pages (plan Free)

Según su [página de límites](https://developers.cloudflare.com/pages/platform/limits/), el plan Free permite 500 builds al mes, 20.000 archivos por sitio y **25 MiB por archivo**. Nuestro archivo más grande pesa 3,9 MB. Su [página de precios](https://developers.cloudflare.com/pages/functions/pricing/) indica que las solicitudes a recursos estáticos son gratuitas e ilimitadas en todos los planes cuando no invocan Functions, y esta app no usa Functions. La documentación de Pages no prohíbe el uso comercial, pero rigen los términos generales y el uso razonable de Cloudflare. **Revísalos antes de publicar; no es gratuidad ilimitada garantizada.**

1. Sube el repositorio a GitHub.
2. Cloudflare → Workers & Pages → Create → Pages → conectar el repositorio.
3. Build command `npm run build`, output directory `dist`, variable `NODE_VERSION=22`.
4. Publica y abre la URL `https://…pages.dev`.

GitHub Pages **no** es buena opción: sus términos no lo permiten como hosting gratuito para negocios o transacciones comerciales.

### Instalar la PWA

La instalación depende del navegador y requiere HTTPS. **El navegador no siempre muestra un aviso automático.**

- **Android (Chrome):** menú ⋮ → «Instalar aplicación» o «Añadir a pantalla de inicio».
- **iPhone/iPad (Safari):** botón Compartir → «Añadir a pantalla de inicio» → «Añadir». En iOS la app instalada tiene su propio almacenamiento: prepara ahí el lector sin conexión.

## Paso 7. Limitaciones reales

- **Sin validación bancaria.** La app nunca sabe si el dinero llegó. Capturas y SMS pueden falsificarse. Confirma siempre en tu banco.
- **Formatos bancarios:** el intérprete es heurístico. Un texto con una estructura rara puede terminar en «elige el monto» o «no encontramos». Nunca inventa uno.
- **Compatibilidad móvil:** requiere un navegador con WebAssembly y Web Workers (Chrome para Android e iOS 15 o más reciente, aproximadamente). Si el teléfono tiene poca memoria, la lectura puede ser lenta o fallar; en ese caso pega el SMS.
- **Descarga inicial del OCR:** unos 6 MB la primera vez, que consumen datos móviles y transferencia del hosting. La lectura tarda más en teléfonos de gama baja.
- **Voces locales:** dependen del sistema. Android suele traer voces en español del motor de Google; iOS trae voces locales. Muchos navegadores de escritorio no marcan voces locales en español y la app lo informa. La app no puede subir el volumen del sistema. La voz automática después del OCR **no está garantizada**, sobre todo en iOS; por eso existe el botón «Escuchar monto».
- **Sin conexión:**
  - Abrir la app funciona después de la primera visita, con el service worker activo.
  - Leer texto pegado funciona siempre.
  - La voz funciona si hay una voz local.
  - El OCR funciona solo después de preparar el lector con conexión, y mientras el navegador conserve la caché (puede borrarla si falta espacio o si el usuario limpia los datos). Si una actualización del navegador cambia la variante SIMD, hay que preparar el lector de nuevo.
- **Historial:** solo en memoria, a propósito. Se pierde al recargar o cerrar.
