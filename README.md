> **Nuevo en este repositorio: [Mi Negocio](mi-negocio/README.md)**, una app de pedidos, stock, saldos y caja para negocios que venden por WhatsApp (Next.js + Supabase), en la carpeta `mi-negocio/`. Es independiente de Alerta QR, que se documenta a continuación.

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
