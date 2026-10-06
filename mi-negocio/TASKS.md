# Mi Negocio — lista de tareas

Estado: primera versión funcional, verificada en local. Última actualización: 2026-10-06.

## Hecho
- [x] Evaluar el repositorio: la app previa (Alerta QR, Vite) se conserva en la raíz; Mi Negocio vive en `mi-negocio/`
- [x] Next.js 16 + TypeScript estricto + Tailwind 4 + Supabase local (CLI + Docker)
- [x] Migraciones: esquema, restricciones, FK compuestas por negocio, RLS, funciones transaccionales, vistas, storage privado
- [x] Dominio centralizado: dinero, totales, saldos, ciclo de vida, fechas por zona horaria, teléfonos, WhatsApp, CSV
- [x] Autenticación (login, registro, recuperación, nueva contraseña, callback), proxy y protección en servidor
- [x] Onboarding atómico e idempotente
- [x] Shell responsive: navegación inferior móvil, barra lateral de escritorio, Ajustes, «Nuevo pedido» visible
- [x] Inicio con cifras reales y estado vacío
- [x] Productos: variantes, stock (disponible/reservado/existencia), ajuste con motivo, libro de movimientos, archivo, foto
- [x] Clientes: alta en el pedido sin perder el borrador, aviso de teléfono duplicado, saldos, historial, notas privadas, archivo
- [x] Pedidos: lista con búsqueda, filtros y paginación en URL; crear (con anticipo atómico); editar borrador; detalle con transiciones, pagos, anulaciones, reembolsos, cancelación con decisión de devolución, edición de entrega, historial
- [x] WhatsApp: resumen y recordatorio con vista previa, copiar y abrir (registra «se abrió»)
- [x] Caja: rango local, totales, desglose por medio, lista unificada con anulados, gastos con anulación y corrección, CSV
- [x] Exportación CSV de pedidos con los filtros actuales
- [x] Ajustes: negocio, zona horaria, QR de cobro (sin recorte, descarga firmada), logo, perfil, contraseña, cerrar sesión
- [x] PWA: manifest, íconos, service worker solo para estáticos, aviso sin conexión y envíos deshabilitados
- [x] Seed de desarrollo determinístico y repetible (Luna Boutique + negocio aislado B)
- [x] Pruebas: 58 unitarias, 41 de base de datos real, 12 en navegador; lint, typecheck y build sin errores
- [x] README, nota de arquitectura, .env.example

## Pendiente / siguientes pasos sugeridos
- [ ] Configurar SMTP y URLs de redirección en un proyecto Supabase alojado y probar correos reales
- [ ] Probar la instalación de la PWA en Android físico y con lectores de pantalla (TalkBack)
- [ ] Revisar la documentación oficial de WhatsApp «click to chat» (no accesible desde el entorno de desarrollo)
- [ ] Fotos de productos en el seed (hoy se muestra un ícono local)
- [ ] Despliegue público (acción separada, no realizada)

## Cómo retomar
```bash
cd mi-negocio
npm install
SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io npm run db:start   # o npm run db:start
npm run db:reset && npm run db:seed
npm run dev
npm test && npm run test:db && npm run test:e2e
```
