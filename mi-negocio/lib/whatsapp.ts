// Mensajes y enlaces de WhatsApp iniciados por la persona (wa.me "click to chat").
// No se lee ni se envía nada automáticamente: abrir el enlace no prueba que el
// mensaje se haya enviado. Nunca se incluyen notas privadas, costos ni IDs internos.
import { formatDate } from '@/lib/dates';
import { formatMoney } from '@/lib/money/money';
import { whatsappDigits } from '@/lib/phone';

export interface ShareItem {
  quantity: number;
  productName: string;
  variantLabel: string | null;
  lineTotalCents: number;
}

export interface ShareOrder {
  code: string;
  customerName: string | null;
  fulfillmentType: 'pickup' | 'delivery';
  promisedDate: string | null;
  timeWindow: string | null;
  deliveryAddress: string | null;
  discountCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  netPaidCents: number;
  balanceDueCents: number;
  items: ShareItem[];
}

export interface ShareBusiness {
  name: string;
  pickupAddress: string | null;
}

function greeting(name: string | null): string {
  const first = name?.trim();
  return first ? `Hola, ${first}.` : 'Hola.';
}

function whenText(order: ShareOrder): string | null {
  const parts = [order.promisedDate ? formatDate(order.promisedDate) : null, order.timeWindow?.trim() || null].filter(
    Boolean,
  );
  return parts.length ? parts.join(', ') : null;
}

export function buildOrderSummary(order: ShareOrder, business: ShareBusiness): string {
  const lines: string[] = [];
  lines.push(`${greeting(order.customerName)} Este es el resumen de tu pedido ${order.code} en ${business.name}:`);
  lines.push('');
  for (const item of order.items) {
    const label = item.variantLabel ? `${item.productName} — ${item.variantLabel}` : item.productName;
    lines.push(`${item.quantity} × ${label}: ${formatMoney(item.lineTotalCents)}`);
  }
  if (order.discountCents > 0) lines.push(`Descuento: -${formatMoney(order.discountCents)}`);
  if (order.deliveryFeeCents > 0) lines.push(`Envío: ${formatMoney(order.deliveryFeeCents)}`);
  lines.push(`Total: ${formatMoney(order.totalCents)}`);
  if (order.netPaidCents > 0) lines.push(`Pago registrado: ${formatMoney(order.netPaidCents)}`);
  if (order.totalCents > 0) lines.push(`Saldo pendiente: ${formatMoney(order.balanceDueCents)}`);

  const when = whenText(order);
  if (order.fulfillmentType === 'delivery') {
    if (when) lines.push(`Entrega: ${when}.`);
    if (order.deliveryAddress?.trim()) lines.push(`Dirección: ${order.deliveryAddress.trim()}`);
  } else {
    if (when) lines.push(`Retiro: ${when}.`);
    if (business.pickupAddress?.trim()) lines.push(`Lugar de retiro: ${business.pickupAddress.trim()}`);
  }
  lines.push('');
  lines.push('¡Gracias por tu compra!');
  return lines.join('\n');
}

export function buildPaymentReminder(order: Pick<ShareOrder, 'code' | 'customerName' | 'balanceDueCents'>, business: ShareBusiness): string {
  return (
    `${greeting(order.customerName)} Te escribimos de ${business.name} por tu pedido ${order.code}. ` +
    `El saldo pendiente es ${formatMoney(order.balanceDueCents)}. ` +
    'Si ya realizaste el pago, por favor avisanos para revisarlo. ¡Gracias!'
  );
}

/**
 * Enlace "click to chat": https://wa.me/<número internacional sin +>?text=<texto codificado>.
 * Sin número, https://wa.me/?text=... deja elegir el contacto en WhatsApp.
 */
export function whatsappUrl(phoneE164: string | null | undefined, text: string): string {
  const encoded = encodeURIComponent(text);
  return phoneE164 ? `https://wa.me/${whatsappDigits(phoneE164)}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
}

export function whatsappChatUrl(phoneE164: string): string {
  return `https://wa.me/${whatsappDigits(phoneE164)}`;
}
