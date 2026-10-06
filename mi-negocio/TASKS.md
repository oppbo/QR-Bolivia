# Mi Negocio — lista de tareas

Estado: en progreso. Se actualiza en cada avance.

## Base
- [x] Evaluar repositorio (app previa Alerta QR se conserva en la raíz; Mi Negocio vive en `mi-negocio/`)
- [x] Next.js 16 + TypeScript estricto + Tailwind 4 + Supabase local (CLI + Docker)
- [x] Migraciones: esquema, restricciones, RLS, funciones transaccionales, vistas, storage
- [x] Lógica de dominio: dinero, totales, saldos, ciclo de vida, fechas, teléfonos, WhatsApp
- [x] Pruebas unitarias de dominio
- [x] Pruebas de base de datos: escenarios A–G, carreras, idempotencia, reversión, restricciones, aislamiento y storage

## Interfaz
- [ ] Autenticación (login, registro, recuperación, restablecer) + proxy + onboarding
- [ ] Shell (navegación inferior móvil, barra lateral escritorio), tokens de diseño
- [ ] Inicio
- [ ] Productos (lista, crear/editar, ajuste de stock, archivar)
- [ ] Clientes (lista, detalle, crear/editar, archivar)
- [ ] Pedidos (lista con filtros, crear, editar borrador, detalle con acciones)
- [ ] Pagos, anulaciones, reembolsos, cancelación
- [ ] WhatsApp (vista previa, copiar, abrir)
- [ ] Caja (resumen, por medio, lista, gastos, corrección) + CSV
- [ ] Ajustes (negocio, QR, logo, cuenta)
- [ ] PWA (manifest, iconos, service worker seguro, estado de conexión)

## Entrega
- [ ] Seed de desarrollo determinístico
- [ ] Pruebas de navegador (Playwright)
- [ ] README, nota de arquitectura, .env.example
