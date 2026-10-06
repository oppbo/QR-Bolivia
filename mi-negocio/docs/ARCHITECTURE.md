# Arquitectura y modelo de datos

## Visión general

Una sola aplicación Next.js (App Router) sobre Supabase. No hay microservicios, colas ni ORM.

```
Navegador ──> Next.js (Server Components + Server Actions, sesión del usuario en cookies)
                 │  @supabase/ssr, siempre con la sesión del usuario (RLS)
                 ▼
            Supabase: Postgres (RLS + funciones transaccionales) · Auth · Storage privado
```

- **Lecturas**: las páginas de servidor consultan tablas y vistas con la sesión del usuario (RLS) o funciones de lectura `SECURITY INVOKER` (`list_orders`, `dashboard_summary`, `cash_summary`…).
- **Escrituras**: los Server Actions validan con Zod (mensajes en español) y llaman a funciones `SECURITY DEFINER` de la base. Cada mutación de dinero o stock es **una** transacción de Postgres.
- **Reglas en dos capas**: la UI valida para dar respuesta inmediata. La base vuelve a validar con filas bloqueadas, que es la fuente de verdad.

## Carpetas

| Carpeta | Contenido |
|---|---|
| `app/` | Rutas: `(auth)/login, signup, forgot-password, reset-password`, `onboarding`, `app/*` (privadas), `auth/callback`, `auth/signout`, exportaciones CSV, `manifest.ts` |
| `features/<dominio>/` | Server Actions y componentes de cliente por dominio: `auth`, `onboarding`, `products`, `customers`, `orders`, `cash`, `settings` |
| `components/ui/` | Primitivas (botones, campos, badges de estado con ícono + texto, diálogo Radix, paginación, aviso de conexión) |
| `components/shell/` | Navegación inferior (móvil), barra lateral (escritorio), barra superior |
| `lib/money/` | Parseo y formato de dinero; **reglas financieras centralizadas** (`order-math.ts`) |
| `lib/dates/` | Día local y rangos en la zona del negocio, formato `dd/mm/aaaa` |
| `lib/orders/` | Transiciones de estado y etiquetas en español |
| `lib/phone.ts`, `lib/whatsapp.ts`, `lib/csv.ts` | Normalización E.164 (+591 por defecto), mensajes y enlaces wa.me, CSV seguro |
| `lib/db/` | Tipos generados, traducción de errores a español, envoltorio de RPC |
| `lib/storage/` | Subida validada (firma del archivo, 5 MB), URLs firmadas |
| `supabase/migrations/` | Esquema, seguridad, funciones, reportes y storage |
| `scripts/` | Seed de desarrollo, generación de íconos |
| `tests/unit`, `tests/db`, `tests/e2e` | Dominio, base de datos real y navegador |

## Modelo de datos

| Tabla | Notas |
|---|---|
| `profiles` | Nombre visible, 1:1 con `auth.users` |
| `businesses` | Nombre, moneda (fija en BOB), zona horaria, WhatsApp, retiro, rutas de logo y QR, `revision` |
| `business_members` | `(business_id, user_id, role)`. Únicos: un negocio por usuario y un dueño por negocio (primera versión) |
| `order_counters` | Último número de pedido por negocio. Se incrementa con bloqueo de fila. No es accesible desde el cliente |
| `customers` | Teléfono E.164 opcional (no único: se advierte, no se fusiona), notas privadas, `archived_at`, `revision` |
| `products` / `product_variants` | Variante: SKU opcional (único por negocio), talla y color (únicos por producto), precio, costo *nullable*, `track_inventory`, `on_hand`, `reserved`, umbral de stock bajo |
| `orders` | Número y código `PED-000123`, instantánea del cliente, estado, tipo de entrega, fecha prometida (`date`), montos, marcas de confirmación, entrega y cancelación, decisión de devolución, clave de idempotencia de creación, `revision` |
| `order_items` | Instantáneas (nombre, opciones, SKU, precio, costo), cantidad, total de línea y `stock_state` |
| `payments` / `refunds` / `expenses` | Solo se agregan filas. Anulación con motivo (`voided_at/by/reason`). Clave de idempotencia única por negocio. El reembolso referencia `(business_id, order_id, payment_id)` |
| `inventory_movements` | Libro de stock: deltas, saldo resultante, motivo, actor y `operation_key` única |
| `activity_events` | Auditoría (actor, entidad, evento, metadatos seguros) |

Vistas: `order_summaries` (pagado neto, saldo, reembolso pendiente, estado de pago, `is_collectible`) y `variant_stock` (disponible, stock bajo, agotado). Ambas son `security_invoker`.

### Invariantes en la base

- Restricciones `CHECK`: montos no negativos, cantidades positivas, `reserved ≤ on_hand`, sin reservas si no se controla stock, `total = subtotal − descuento + envío`, descuento ≤ subtotal, estados válidos, datos de cancelación completos.
- FK compuestas `(business_id, …)` en todas las relaciones entre tablas de negocio.
- Triggers: líneas editables solo en estado Nuevo, montos congelados después de confirmar, pagos, reembolsos y gastos inmutables salvo la anulación (una vez), movimientos y actividad de solo agregado.
- Concurrencia: `SELECT … FOR UPDATE` del pedido antes de calcular saldos y de las variantes en orden de `id` antes de reservar, entregar o reponer. Bloqueos *advisory* para la creación idempotente de negocio, pedido y gasto.

### Funciones (RPC)

Escritura: `create_business`, `update_business`, `set_business_asset`, `update_profile`, `save_customer`, `set_customer_archived`, `save_product`, `set_product_archived`, `adjust_stock`, `create_order` (crear, confirmar opcionalmente y registrar un pago opcional, todo atómico), `update_order_draft`, `update_order_logistics`, `confirm_order`, `mark_order_preparing`, `mark_order_delivered`, `cancel_order`, `record_payment`, `void_payment`, `record_refund`, `void_refund`, `record_expense`, `void_expense`, `correct_expense`, `log_share_opened`.

Lectura: `list_orders`, `list_products`, `search_sellable_variants`, `list_customers`, `customer_totals`, `dashboard_summary`, `cash_summary`, `cash_entries`.

Los errores de dominio se lanzan con un código estable (`insufficient_stock`, `payment_exceeds_balance`, `stale_order`…) que `lib/db/errors.ts` traduce a español. Nunca se muestra el error crudo.

## Diseño

Tokens en `app/globals.css`: fondo `#F6F7F3`, superficies blancas, primario `#166534`, texto `#17221B`, secundario `#4A5A50`. Ámbar, rojo y azul oscuros sobre fondos suaves para advertencia, error e información.

Contrastes calculados (WCAG): texto principal sobre fondo 15.2:1, secundario sobre blanco 7.3:1, blanco sobre primario 7.1:1, ámbar 6.4:1, rojo 5.3:1, azul 5.5:1. Todos superan AA (4.5:1).

Los estados siempre combinan texto, ícono y color. La fuente es del sistema (sin pedidos a terceros) y el texto base mide 16 px. Los objetivos táctiles miden al menos 44 px y el diseño respeta las zonas seguras y `prefers-reduced-motion`.
