# Mi Negocio

> «Sabé qué vendiste, quién te debe y qué tenés que entregar hoy.»

Aplicación web *mobile-first* para negocios chicos de Santa Cruz de la Sierra que venden por WhatsApp. Sirve para registrar pedidos con tallas y colores, reservar stock, anotar anticipos y pagos, ver saldos, compartir resúmenes por WhatsApp y llevar una caja simple.

El público inicial (tiendas de ropa y accesorios atendidas por su dueño o dueña) es una **hipótesis de producto, no un estudio de mercado**. La app no incluye testimonios, estadísticas de adopción ni alianzas bancarias.

**Estado:** primera versión funcional verificada en local (ver [Qué se probó](#qué-se-probó)). No está desplegada ni revisada para producción. Publicarla es un paso aparte.

---

## Requisitos (versiones usadas y probadas)

| Herramienta | Versión |
|---|---|
| Node.js | 22.22 (mínimo 20.9, requerido por Next.js 16) |
| npm | 10.9 |
| Docker | 29.6 (para Supabase local) |
| Supabase CLI | 2.119 (dependencia de desarrollo, `npx supabase`) |
| Next.js / React | 16.3.8 / 19.2.8 (App Router, Turbopack) |
| TypeScript | 5.9 (modo estricto) |
| Tailwind CSS | 4.3 |
| @supabase/supabase-js / @supabase/ssr | 2.117 / 0.12 |
| Zod | 4.6 |
| Vitest / Playwright | 5.0 / 1.56.1 |

La interfaz usa componentes propios con Tailwind y Radix (`radix-ui`) para los diálogos accesibles. No se agregó ORM: el acceso a datos usa el cliente de Supabase, migraciones SQL y tipos generados (`lib/db/database.types.ts`).

## Instalación y desarrollo local (con Docker)

```bash
cd mi-negocio
npm install
npm run db:start          # levanta Supabase local (Postgres, Auth, Storage, correo de prueba)
cp .env.example .env.local
npx supabase status       # copiá API URL, Publishable key y Secret key a .env.local
npm run db:reset          # aplica las migraciones desde cero
npm run db:seed           # datos ficticios de desarrollo (Luna Boutique)
npm run dev               # http://localhost:3000
```

Cuenta de demostración que crea el seed: `demo@luna-boutique.test` / `demo-luna-2026`.

Si tu red bloquea el registro de imágenes de AWS (`public.ecr.aws`) que usa la CLI, podés descargar las mismas imágenes desde Docker Hub:

```bash
SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io npm run db:start
```

`supabase/config.toml` desactiva servicios que la app no usa (Studio, Realtime, Edge Functions, Analytics) para que el entorno local sea más liviano. Los correos de confirmación y recuperación se ven en Mailpit: http://127.0.0.1:54324.

### Proyecto alojado de desarrollo (sin Docker)

1. Creá un proyecto de **desarrollo** en supabase.com (no uses datos reales).
2. `npx supabase link --project-ref <ref>` y después `npx supabase db push` para aplicar `supabase/migrations/` (incluye RLS, funciones, el bucket privado y sus políticas). No hace falta ningún cambio manual en el panel.
3. Completá `.env.local` con la URL y la clave publicable del proyecto.
4. En **Authentication → URL Configuration**: *Site URL* = la URL de tu app y, en *Redirect URLs*, agregá `<tu-url>/auth/callback`.
5. Seed opcional: `ALLOW_REMOTE_SEED=1 npm run db:seed`. Necesita `SUPABASE_SECRET_KEY` y `TEST_DATABASE_URL` (cadena de conexión de Postgres) en tu máquina. Por defecto el seed se niega a correr contra un proyecto que no sea local.

### Autenticación y correos

- Registro e inicio de sesión con correo y contraseña (Supabase Auth). Hay recuperación de contraseña.
- Los enlaces de los correos vuelven a `/auth/callback`, que acepta el flujo PKCE (`?code=`) y el de `token_hash`. Después redirige solo a rutas internas.
- Localmente la confirmación de correo está **desactivada** (`enable_confirmations = false`), así que el registro inicia sesión de inmediato. Si la activás (recomendado en un proyecto alojado), la app muestra «Revisá tu correo» y no da la cuenta por verificada hasta que se abra el enlace.
- En un proyecto alojado hay que configurar SMTP propio para enviar correos reales. No se configuró ninguno en este repositorio.

### Variables de entorno

| Variable | ¿Navegador? | Uso |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Sí (pública) | URL del proyecto Supabase |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Sí (pública) | Clave publicable o *anon*; RLS protege los datos |
| `NEXT_PUBLIC_SITE_URL` | Sí (pública) | Base de los enlaces de confirmación y recuperación |
| `SUPABASE_SECRET_KEY` | **No** | Solo `scripts/seed.ts` (desarrollo). La app nunca la lee. |
| `TEST_DATABASE_URL` | **No** | Seed y pruebas de base de datos (Postgres local) |

La app no usa claves de servicio en el navegador ni en los request handlers. Todo acceso a datos usa la sesión del usuario.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` / `npm start` | Build de producción y servidor |
| `npm run lint` | ESLint |
| `npm run typecheck` | Genera tipos de rutas (`next typegen`) y corre `tsc --noEmit` |
| `npm test` | Pruebas unitarias de dominio (Vitest, sin base de datos) |
| `npm run test:db` | Pruebas contra el Postgres local real: RLS, carreras, idempotencia, storage |
| `npm run test:e2e` | Recorridos en navegador (Playwright). Ejecuta el seed y usa `npm run dev` (o reutiliza uno abierto). |
| `npm run db:start` / `db:stop` | Levanta o detiene Supabase local |
| `npm run db:reset` | Recrea la base local aplicando las migraciones |
| `npm run db:seed` | Seed de desarrollo determinístico (se puede repetir) |
| `npm run db:types` | Regenera `lib/db/database.types.ts` |

Playwright usa su Chromium. Si no lo tenés: `npx playwright install chromium`, o definí `CHROMIUM_PATH`.

### Pruebas sin datos de producción ni mensajes reales

- Todas las pruebas corren contra Supabase **local**. `test:db` crea usuarios y negocios descartables en cada ejecución.
- `test:e2e` usa el seed ficticio y cuentas nuevas `@test.local`.
- Las pruebas de navegador **interceptan** `https://wa.me/**`, así que nunca se abre WhatsApp ni se envía un mensaje.
- Los clientes del seed no tienen teléfono, para que nadie comparta por accidente a una persona real.

## Cómo funciona

### Dinero

- Montos en **centavos enteros** (`bigint`): Bs 125.50 se guarda como `12550`. Se muestran como `Bs 1,234.50` con un único formateador (`lib/money/money.ts`).
- La entrada acepta un solo separador decimal (`.` o `,`) con hasta dos decimales. Se rechazan formas ambiguas como `1.234`, `1,234.50` o `1 234` en vez de adivinar.
- Fórmulas (una sola implementación en `lib/money/order-math.ts`, replicada en la vista SQL `order_summaries`; una prueba verifica que ambas coincidan):
  - `subtotal = Σ cantidad × precio_unitario`
  - `total = subtotal − descuento_fijo + envío` (el descuento no puede superar el subtotal)
  - `pagado_neto = pagos válidos − reembolsos válidos`
  - No cancelado: `saldo = max(total − pagado_neto, 0)`. Cancelado: el saldo a cobrar es 0 y el `reembolso pendiente` es lo pagado neto.
  - Estado de pago derivado (no editable): Pendiente, Parcial, Pagado, Sin cobro (total 0), Reembolso pendiente, Cancelado sin saldo.
- **«Saldo por cobrar»** (Inicio, clientes y filtro «Con saldo») suma solo pedidos Confirmados, En preparación o Entregados. Un pedido **Nuevo** todavía no es un compromiso: muestra su total, pero no cuenta como deuda.

### Fechas y zona horaria

- Los instantes se guardan en UTC. «Hoy» y los rangos de Caja se calculan con la zona del negocio (por defecto `America/La_Paz`, UTC−4). Un pago a las 23:30 hora local cuenta en ese día aunque en UTC ya sea el siguiente.
- La fecha de entrega prometida es una fecha de calendario (`date`) y nunca se desplaza por la zona horaria. Formato visible: `dd/mm/aaaa`.
- No se permiten pagos, reembolsos ni gastos con fecha futura.

### Inventario

- Cada variante tiene **En existencia** (`on_hand`), **Reservado** (`reserved`) y **Disponible** (`on_hand − reserved`). La base de datos garantiza `0 ≤ reservado ≤ existencia`.

| Acción | Existencia | Reservado |
|---|---|---|
| Crear pedido Nuevo | = | = |
| Confirmar | = | + cantidad (bloquea variantes y verifica disponible) |
| Preparando | = | = |
| Entregar | − cantidad | − cantidad |
| Cancelar Confirmado o Preparando | = | − cantidad (libera) |
| Cancelar Nuevo | = | = |
| Cancelar Entregado, «sí volvió al stock» | + cantidad (una sola vez) | = |
| Cancelar Entregado, «no volvió» | = | = |

- Cada cambio queda en `inventory_movements` con una clave de operación única, y cada línea del pedido guarda su `stock_state`. Repetir una entrega o una cancelación nunca descuenta ni repone dos veces.
- Si dos pedidos compiten por la última unidad, solo uno se confirma. El otro recibe «No hay suficiente stock disponible» y queda en Nuevo.
- Los ajustes manuales piden motivo y no pueden dejar la existencia por debajo de lo reservado. No se puede desactivar el control de stock mientras haya reservas.
- Las líneas del pedido guardan **instantáneas** de nombre, opciones, SKU, precio y costo. Cambiar o archivar el producto no altera pedidos anteriores.

### Pedidos, cancelaciones y reembolsos

- Estados: Nuevo → Confirmado → Preparando → Entregado. Se puede cancelar desde cualquiera. Cancelado es definitivo. Las transiciones se validan en la base de datos.
- Hasta la confirmación se pueden editar productos, precios, descuento y envío. Después quedan congelados (un trigger lo impide). Solo se editan datos de entrega y notas privadas. Para corregir montos de un pedido confirmado: cancelar y crear otro.
- Los números `PED-000123` se asignan con un contador por negocio bloqueado dentro de la transacción (no con `MAX + 1`).
- Se puede **entregar antes del pago completo**, con una advertencia que muestra el saldo.
- **Cancelar** y **reembolsar** son acciones separadas. Un reembolso no repone stock.
- Solo se reembolsan pedidos cancelados. Cada reembolso apunta a un pago y no puede superar lo reembolsable de ese pago.
- **Anular registro** corrige un pago o reembolso cargado por error: queda visible y con motivo. No se puede anular un pago que tiene reembolsos. **Registrar reembolso** anota dinero que efectivamente devolviste.
- Todo envío financiero lleva una **clave de idempotencia**. Un doble clic o un reintento tras un corte no duplica pagos. Además, el pedido se bloquea antes de calcular el saldo, así que dos pagos simultáneos nunca superan el total.
- Ediciones con **revisión**: si el pedido cambió en otra sesión, la app avisa «Este pedido cambió en otra sesión. Actualizá para continuar.» y no sobrescribe.

### Pagos manuales y QR

- Los pagos son **registros manuales** de la persona dueña («Registrado manualmente»). Mi Negocio no se conecta a bancos ni billeteras y no puede comprobar que un pago exista. Por eso nunca dice «verificado».
- En Ajustes se sube el **QR que ya entrega tu banco**. Se muestra sin recortes ni compresión y se descarga con una URL firmada para adjuntarlo en WhatsApp. La app **no genera** QR bancarios y no afirma que el QR sea válido ni que indique un monto.
- Comprobantes opcionales (JPG, PNG o WebP, hasta 5 MB): son solo respaldo y nunca marcan un pedido como pagado.

### WhatsApp

- Enlaces `https://wa.me/<número sin +>?text=<mensaje codificado>` que abre la persona. Sin número se usa `https://wa.me/?text=...` y WhatsApp deja elegir el contacto. La sintaxis sigue la documentación pública de «click to chat». La página oficial no se pudo consultar desde el entorno de desarrollo (red restringida); conviene revisarla antes de publicar.
- Siempre hay vista previa y botón «Copiar mensaje». El recordatorio se deshabilita si no hay saldo o si el pedido está cancelado.
- Los mensajes nunca incluyen notas privadas, costos ni IDs internos. El historial registra «Se abrió WhatsApp», no «enviado».

### Caja

- Para el rango de fechas elegido (por defecto, hoy en la zona del negocio) muestra: cobrado (pagos válidos), reembolsos, gastos y **movimiento neto registrado** = cobrado − reembolsos − gastos. **No es ganancia ni saldo bancario.**
- Incluye un desglose por medio y una lista cronológica con anulados visibles.
- Los envíos ya forman parte de los pagos. Un pedido solo cuenta cuando registrás su pago. El costo de la mercadería no se descuenta automáticamente.
- Los gastos se corrigen anulando el original y registrando el reemplazo en una sola transacción.
- Exportación CSV de Caja y de pedidos (con los filtros actuales). Respeta la sesión y RLS, y neutraliza fórmulas de hoja de cálculo.

### Seguridad y aislamiento

- Todas las tablas tienen RLS. Los usuarios autenticados **solo leen** filas de su negocio. Las escrituras pasan por funciones `SECURITY DEFINER` con `search_path` fijo que toman el negocio de la membresía del usuario, nunca de un argumento del navegador.
- Las FK compuestas `(business_id, id)` impiden referenciar clientes, variantes o pagos de otro negocio aunque se conozca el UUID.
- Storage: bucket privado `business-files`, rutas `<negocio>/<carpeta>/<aleatorio>.<ext>`, solo JPG, PNG o WebP de hasta 5 MB (se validan tipo real y tamaño en el servidor) y URLs firmadas de 5 minutos.
- Las rutas privadas se protegen en `proxy.ts` y otra vez en cada página. Los redirects internos se validan, las respuestas privadas llevan `Cache-Control: no-store` y al cerrar sesión se pide borrar la caché del sitio.

### Sin conexión (PWA)

- Tiene manifest, íconos y un service worker que **solo** guarda recursos estáticos (`/_next/static`, `/icons`). No guarda páginas autenticadas, datos de clientes, QR, comprobantes ni escrituras.
- Sin conexión aparece un aviso y se deshabilitan los envíos. Lo escrito se conserva mientras la página siga abierta. No hay cola oculta de envíos: nada se guarda hasta que el servidor lo confirma.

## Fuera de esta versión (diferido a propósito)

Lectura automática de chats de WhatsApp, bots, envíos masivos, asistentes de IA, APIs bancarias, conciliación o verificación automática de QR y comprobantes, facturación fiscal o impuestos, sueldos, compras a proveedores, múltiples depósitos, suscripciones o cobro del servicio, conversión de moneda, marketplace, rutas o couriers, invitación de personal y roles (la tabla de membresías existe para el futuro), sincronización completa sin conexión.

También: **devoluciones parciales**, cambios, descuentos por línea, entregas parciales, notas de crédito y saldo a favor del cliente. La versión actual solo admite la cancelación o devolución del **pedido completo**, decidiendo si la mercadería vuelve al stock vendible.

## Datos de demostración

`npm run db:seed` (solo desarrollo; se puede repetir). Borra y recrea únicamente las dos cuentas de demostración, usando las mismas funciones transaccionales de la app:

- **Luna Boutique** (Santa Cruz de la Sierra, dirección ficticia): 8 productos, 17 variantes (una agotada y varias con stock bajo), 8 clientes sin teléfono, 12 pedidos (impagos, parciales, pagados, uno de total cero, cancelados con reembolso pendiente y saldado, uno devuelto al stock, uno atrasado y varios para hoy) y 5 gastos.
- **Tienda Prueba B**: negocio aislado para verificar que sus datos no aparecen en Luna Boutique.
- **Ancla de fechas**: `SEED_ANCHOR_DATE=AAAA-MM-DD` (por defecto, hoy en America/La_Paz). Entregas y pagos se calculan relativos a esa fecha, sin superar la hora actual. Para que el panel tenga historia, el seed ajusta solo marcas de tiempo (creación, confirmación y entrega). Montos y stock salen de las funciones reales.
- No hay imágenes de QR ni comprobantes reales. Los productos usan un ícono local como foto.

## Qué se probó

Ejecutado en este entorno (Supabase local con Docker, Chromium de Playwright):

- `npm run lint`, `npm run typecheck` y `npm run build`: sin errores.
- `npm test`: 58 pruebas de dominio (dinero, totales, saldos, transiciones, día local alrededor de la medianoche UTC, teléfonos, mensajes de WhatsApp, CSV).
- `npm run test:db`: 41 pruebas contra Postgres real (escenarios A–G con aritmética exacta, carrera por la última unidad, pagos simultáneos, idempotencia de confirmación, entrega, cancelación, pago y reembolso, reversión de transacción, restricciones, aislamiento de lecturas, escrituras, funciones y storage vía la API real).
- `npm run test:e2e`: 12 recorridos en navegador (registro, onboarding, producto, cliente, pedido con anticipo, entrega y pago final; cancelación y reembolso; totales Inicio = Caja = detalle; filtros en URL; WhatsApp interceptado; validaciones y fallo simulado sin perder datos; sesión y cierre; QR; sin conexión; diálogos con teclado; sin desbordamiento a 360 px y en escritorio).

No probado: envío real de correos con un SMTP alojado, instalación de la PWA en un teléfono físico y lectores de pantalla reales.

Más detalle técnico: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Estado de tareas: [TASKS.md](TASKS.md).
