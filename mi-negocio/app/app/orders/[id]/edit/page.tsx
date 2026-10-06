import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui/primitives';
import type { OrderDraft } from '@/features/orders/draft';
import { OrderForm } from '@/features/orders/order-form';
import { requireBusiness } from '@/lib/auth/session';
import { todayInTimezone } from '@/lib/dates';
import { centsToInput } from '@/lib/money/money';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Editar pedido' };

export default async function EditOrderPage({ params }: PageProps<'/app/orders/[id]/edit'>) {
  const { id } = await params;
  const { timezone } = await requireBusiness(`/app/orders/${id}/edit`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const [{ data: o }, { data: items }] = await Promise.all([
    supabase.from('orders').select('*').eq('id', id).maybeSingle(),
    supabase.from('order_items').select('*').eq('order_id', id).order('position'),
  ]);
  if (!o) notFound();
  if (o.status !== 'new') redirect(`/app/orders/${id}`);

  const variantIds = (items ?? []).map((i) => i.variant_id);
  const [{ data: stock }, { data: customer }] = await Promise.all([
    variantIds.length ? supabase.from('variant_stock').select('id, price_cents, track_inventory, available').in('id', variantIds) : Promise.resolve({ data: [] as never[] }),
    o.customer_id
      ? supabase.from('customers').select('id, name, phone, address, delivery_reference').eq('id', o.customer_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const byId = new Map((stock ?? []).map((s) => [s.id, s]));

  const initial: OrderDraft = {
    customer: customer ?? null,
    walkIn: !o.customer_id,
    customer_name: o.customer_id ? '' : (o.customer_name ?? ''),
    customer_phone: o.customer_id ? '' : (o.customer_phone ?? ''),
    fulfillment_type: o.fulfillment_type as 'pickup' | 'delivery',
    promised_date: o.promised_date ?? '',
    time_window: o.time_window ?? '',
    delivery_address: o.delivery_address ?? '',
    delivery_reference: o.delivery_reference ?? '',
    notes: o.notes ?? '',
    discount: o.discount_cents ? centsToInput(o.discount_cents) : '',
    delivery_fee: o.delivery_fee_cents ? centsToInput(o.delivery_fee_cents) : '',
    lines: (items ?? []).map((i) => {
      const s = byId.get(i.variant_id);
      return {
        key: i.id,
        variant_id: i.variant_id,
        product_name: i.product_name,
        label: i.variant_label,
        track_inventory: s?.track_inventory ?? false,
        available: s?.track_inventory ? (s.available ?? 0) : null,
        quantity: String(i.quantity),
        unit_price: centsToInput(i.unit_price_cents),
        list_price_cents: s?.price_cents ?? i.unit_price_cents,
      };
    }),
  };
  return (
    <>
      <PageHeader title={`Editar ${o.code}`} back={<Link href={`/app/orders/${id}`} className="mb-1 inline-block text-primary underline">{o.code}</Link>} />
      <OrderForm mode="edit" orderId={id} revision={o.revision} initial={initial} today={todayInTimezone(timezone)} />
    </>
  );
}
