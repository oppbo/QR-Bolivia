// Traduce errores de la base de datos a mensajes accionables en español.
// Nunca se muestra el error crudo ni el stack a la persona.

const MESSAGES: Record<string, string> = {
  not_authenticated: 'Tu sesión venció. Iniciá sesión para continuar.',
  no_business: 'Primero creá tu negocio.',
  not_found: 'No encontramos ese registro.',
  invalid_input: 'Revisá los datos ingresados.',
  invalid_number: 'Revisá los números ingresados.',
  text_too_long: 'Uno de los textos es demasiado largo.',
  invalid_phone: 'El número de teléfono no es válido.',
  invalid_date: 'La fecha no es válida.',
  future_date: 'La fecha y hora no pueden estar en el futuro.',
  invalid_file_path: 'El archivo no es válido.',
  invalid_business_name: 'Ingresá el nombre del negocio.',
  invalid_display_name: 'Ingresá tu nombre.',
  invalid_timezone: 'La zona horaria no es válida.',
  stale_record: 'Este registro cambió en otra sesión. Actualizá para continuar.',
  stale_order: 'Este pedido cambió en otra sesión. Actualizá para continuar.',
  invalid_customer_name: 'Ingresá el nombre del cliente.',
  customer_not_found: 'No encontramos ese cliente.',
  customer_archived: 'Ese cliente está archivado. Reactivalo o elegí otro.',
  invalid_product_name: 'Ingresá el nombre del producto.',
  product_needs_variant: 'El producto necesita al menos una variante activa.',
  too_many_variants: 'Demasiadas variantes para un producto.',
  invalid_price: 'El precio debe ser un monto válido, no negativo.',
  invalid_cost: 'El costo debe ser un monto válido, no negativo.',
  invalid_quantity: 'La cantidad debe ser un número entero válido.',
  variant_has_reservations: 'No podés quitar una variante con unidades reservadas en pedidos.',
  tracking_has_reservations: 'No podés desactivar el control de inventario mientras haya unidades reservadas.',
  variant_not_tracked: 'Esta variante no controla inventario.',
  adjustment_below_reserved: 'El ajuste dejaría el stock por debajo de lo reservado en pedidos.',
  reason_required: 'Indicá un motivo.',
  insufficient_stock: 'No hay suficiente stock disponible. Revisá las cantidades.',
  order_needs_items: 'Agregá al menos un producto al pedido.',
  too_many_items: 'Demasiados productos en un solo pedido.',
  variant_not_found: 'Uno de los productos ya no existe.',
  variant_archived: 'Uno de los productos está archivado.',
  invalid_discount: 'El descuento no puede ser negativo.',
  discount_exceeds_subtotal: 'El descuento no puede superar el subtotal de los productos.',
  invalid_delivery_fee: 'El costo de envío no puede ser negativo.',
  invalid_transition: 'Ese cambio de estado no es posible para este pedido.',
  order_not_editable: 'Solo se pueden editar productos y precios de pedidos en estado Nuevo.',
  order_terms_frozen: 'Los montos de un pedido confirmado no se pueden cambiar.',
  return_decision_required: 'Indicá si la mercadería volvió al stock vendible.',
  order_canceled: 'No se pueden registrar pagos en un pedido cancelado.',
  order_not_confirmed: 'Confirmá el pedido antes de registrar un pago.',
  invalid_amount: 'El monto debe ser mayor a cero.',
  order_has_no_charge: 'Este pedido no tiene monto por cobrar.',
  invalid_method: 'Elegí un medio de pago.',
  payment_exceeds_balance: 'El pago supera el saldo pendiente de este pedido.',
  idempotency_conflict: 'Este envío ya fue procesado con otros datos. Actualizá la página.',
  missing_idempotency_key: 'No pudimos procesar el envío. Intentá de nuevo.',
  payment_has_refunds: 'Este pago tiene reembolsos registrados. Anulá primero el reembolso.',
  refund_requires_cancellation: 'Solo se registran reembolsos en pedidos cancelados.',
  payment_voided: 'Ese pago está anulado.',
  refund_exceeds_payment: 'El reembolso supera el monto reembolsable.',
  already_voided: 'Este registro ya estaba anulado.',
  invalid_category: 'Elegí una categoría.',
  financial_entry_immutable: 'Los registros financieros no se editan: anulá y registrá de nuevo.',
};

export const GENERIC_SAVE_ERROR = 'No pudimos guardar los cambios. Tus datos siguen en el formulario.';

export interface DbErrorLike {
  code?: string;
  message?: string;
  details?: string | null;
}

export function dbErrorCode(error: DbErrorLike | null | undefined): string | null {
  if (!error) return null;
  if (error.code === 'P0001' && error.message) return error.message;
  if (error.code === '23505') {
    if (error.message?.includes('product_variants_sku_unique')) return 'duplicate_sku';
    if (error.message?.includes('product_variants_options_unique')) return 'duplicate_variant';
    return 'duplicate';
  }
  if (error.code === 'PGRST301' || error.code === '42501') return 'not_authenticated';
  return null;
}

export function dbErrorMessage(error: DbErrorLike | null | undefined): string {
  const code = dbErrorCode(error);
  if (code === 'duplicate_sku') return 'Ese SKU ya se usa en otro producto de tu negocio.';
  if (code === 'duplicate_variant') return 'Hay dos variantes con la misma talla y color.';
  if (code && MESSAGES[code]) return MESSAGES[code];
  return GENERIC_SAVE_ERROR;
}
