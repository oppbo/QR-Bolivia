import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/primitives';
import { emptyOrderDraft, OrderForm } from '@/features/orders/order-form';
import { requireBusiness } from '@/lib/auth/session';
import { todayInTimezone } from '@/lib/dates';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Nuevo pedido' };

export default async function NewOrderPage({ searchParams }: PageProps<'/app/orders/new'>) {
  const { timezone } = await requireBusiness('/app/orders/new');
  const sp = await searchParams;
  const customerId = typeof sp.customer === 'string' && /^[0-9a-f-]{36}$/i.test(sp.customer) ? sp.customer : null;
  let customer = null;
  if (customerId) {
    const supabase = await createClient();
    const { data } = await supabase
      .from('customers')
      .select('id, name, phone, address, delivery_reference')
      .eq('id', customerId)
      .is('archived_at', null)
      .maybeSingle();
    customer = data;
  }
  return (
    <>
      <PageHeader title="Nuevo pedido" back={<Link href="/app/orders" className="mb-1 inline-block text-primary underline">Pedidos</Link>} />
      <OrderForm mode="create" initial={emptyOrderDraft(customer)} today={todayInTimezone(timezone)} />
    </>
  );
}
