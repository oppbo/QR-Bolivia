// Tipos y estado inicial del formulario de pedidos (usable desde el servidor).
import type { CustomerOption } from './actions';

export interface LineDraft {
  key: string;
  variant_id: string;
  product_name: string;
  label: string | null;
  track_inventory: boolean;
  available: number | null;
  quantity: string;
  unit_price: string;
  list_price_cents: number;
}

export interface OrderDraft {
  customer: CustomerOption | null;
  walkIn: boolean;
  customer_name: string;
  customer_phone: string;
  fulfillment_type: 'pickup' | 'delivery';
  promised_date: string;
  time_window: string;
  delivery_address: string;
  delivery_reference: string;
  notes: string;
  discount: string;
  delivery_fee: string;
  lines: LineDraft[];
}

export const emptyOrderDraft = (customer: CustomerOption | null = null): OrderDraft => ({
  customer,
  walkIn: false,
  customer_name: '',
  customer_phone: '',
  fulfillment_type: 'pickup',
  promised_date: '',
  time_window: '',
  delivery_address: customer?.address ?? '',
  delivery_reference: customer?.delivery_reference ?? '',
  notes: '',
  discount: '',
  delivery_fee: '',
  lines: [],
});
