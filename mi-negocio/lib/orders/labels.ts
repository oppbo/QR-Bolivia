import type { OrderStatus, PaymentState } from '@/lib/money/order-math';

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  new: 'Nuevo',
  confirmed: 'Confirmado',
  preparing: 'Preparando',
  delivered: 'Entregado',
  canceled: 'Cancelado',
};

export const PAYMENT_STATE_LABEL: Record<PaymentState, string> = {
  pending: 'Pendiente',
  partial: 'Parcial',
  paid: 'Pagado',
  no_charge: 'Sin cobro',
  refund_pending: 'Reembolso pendiente',
  canceled_settled: 'Cancelado sin saldo',
};

export type PaymentMethod = 'cash' | 'qr' | 'transfer' | 'other';
export const PAYMENT_METHODS: PaymentMethod[] = ['cash', 'qr', 'transfer', 'other'];
export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Efectivo',
  qr: 'QR',
  transfer: 'Transferencia',
  other: 'Otro',
};

export type FulfillmentType = 'pickup' | 'delivery';
export const FULFILLMENT_LABEL: Record<FulfillmentType, string> = {
  pickup: 'Retiro',
  delivery: 'Envío',
};

export type ExpenseCategory = 'transport' | 'rent' | 'utilities' | 'packaging' | 'marketing' | 'other';
export const EXPENSE_CATEGORIES: ExpenseCategory[] = ['transport', 'rent', 'utilities', 'packaging', 'marketing', 'other'];
export const EXPENSE_CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  transport: 'Transporte',
  rent: 'Alquiler',
  utilities: 'Servicios',
  packaging: 'Empaque',
  marketing: 'Marketing',
  other: 'Otros',
};

export const ACTIVITY_LABEL: Record<string, string> = {
  business_created: 'Negocio creado',
  settings_updated: 'Ajustes actualizados',
  asset_updated: 'Imagen actualizada',
  asset_removed: 'Imagen eliminada',
  customer_created: 'Cliente creado',
  customer_updated: 'Cliente actualizado',
  customer_archived: 'Cliente archivado',
  customer_restored: 'Cliente reactivado',
  product_created: 'Producto creado',
  product_updated: 'Producto actualizado',
  product_archived: 'Producto archivado',
  product_restored: 'Producto reactivado',
  stock_adjusted: 'Ajuste de stock',
  order_created: 'Pedido creado',
  order_updated: 'Pedido editado',
  logistics_updated: 'Datos de entrega actualizados',
  order_confirmed: 'Pedido confirmado',
  order_preparing: 'En preparación',
  order_delivered: 'Pedido entregado',
  order_canceled: 'Pedido cancelado',
  payment_recorded: 'Pago registrado',
  payment_voided: 'Pago anulado',
  refund_recorded: 'Reembolso registrado',
  refund_voided: 'Reembolso anulado',
  expense_recorded: 'Gasto registrado',
  expense_voided: 'Gasto anulado',
  whatsapp_summary_opened: 'Se abrió WhatsApp con el resumen',
  whatsapp_reminder_opened: 'Se abrió WhatsApp con el recordatorio',
};
