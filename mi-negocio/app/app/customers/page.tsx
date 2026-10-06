import { Search, Users } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Pagination, parsePage } from '@/components/ui/pagination';
import { Alert, Badge, ButtonLink, buttonClass, cx, EmptyState, Input, PageHeader } from '@/components/ui/primitives';
import { NewCustomerButton } from '@/features/customers/customer-dialogs';
import { requireBusiness } from '@/lib/auth/session';
import { formatMoney } from '@/lib/money/money';
import { formatPhone } from '@/lib/phone';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Clientes' };
const PAGE_SIZE = 25;

export default async function CustomersPage({ searchParams }: PageProps<'/app/customers'>) {
  await requireBusiness('/app/customers');
  const sp = await searchParams;
  const q = typeof sp.q === 'string' ? sp.q.slice(0, 80) : '';
  const view = sp.view === 'archived' ? 'archived' : sp.view === 'balance' ? 'balance' : 'active';
  const page = parsePage(sp.page);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('list_customers', {
    p_search: q || undefined,
    p_archived: view === 'archived',
    p_with_balance: view === 'balance',
    p_limit: PAGE_SIZE,
    p_offset: (page - 1) * PAGE_SIZE,
  });
  const rows = data ?? [];
  const total = rows[0]?.total_count ?? 0;

  const tab = (label: string, v: string) => {
    const s = new URLSearchParams({ ...(q ? { q } : {}), ...(v !== 'active' ? { view: v } : {}) }).toString();
    return (
      <Link href={`/app/customers${s ? `?${s}` : ''}`} aria-current={view === v ? 'true' : undefined} className={cx(buttonClass(view === v ? 'primary' : 'secondary'), 'min-h-10 px-3 text-sm')}>
        {label}
      </Link>
    );
  };

  return (
    <>
      <PageHeader title="Clientes" actions={<NewCustomerButton />} />
      <form className="mb-3 flex gap-2" role="search">
        {view !== 'active' ? <input type="hidden" name="view" value={view} /> : null}
        <label htmlFor="q" className="sr-only">Buscar por nombre o teléfono</label>
        <Input id="q" name="q" type="search" defaultValue={q} placeholder="Buscar por nombre o teléfono" />
        <button className={buttonClass('secondary')} aria-label="Buscar">
          <Search aria-hidden className="size-5" />
        </button>
      </form>
      <div className="mb-4 flex flex-wrap gap-2">
        {tab('Activos', 'active')}
        {tab('Con saldo', 'balance')}
        {tab('Archivados', 'archived')}
      </div>
      {error ? (
        <Alert tone="danger" role="alert">No pudimos cargar los clientes. Actualizá la página.</Alert>
      ) : rows.length === 0 ? (
        q || view !== 'active' ? (
          <EmptyState title="No hay clientes con ese filtro" actions={<ButtonLink variant="secondary" href="/app/customers">Ver todos</ButtonLink>} />
        ) : (
          <EmptyState
            icon={<Users aria-hidden className="size-10" />}
            title="Todavía no tenés clientes"
            description="Podés agregarlos acá o directamente al crear un pedido."
            actions={<NewCustomerButton />}
          />
        )
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((c) => (
            <li key={c.id}>
              <Link href={`/app/customers/${c.id}`} className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 hover:border-line-strong">
                <div className="min-w-0">
                  <p className="font-semibold break-words">{c.name}</p>
                  <p className="text-sm text-muted">
                    {c.phone ? formatPhone(c.phone) : 'Sin teléfono'} · {c.order_count} {c.order_count === 1 ? 'pedido' : 'pedidos'}
                  </p>
                </div>
                {c.balance_due_cents > 0 ? (
                  <Badge tone="warning">Saldo {formatMoney(c.balance_due_cents)}</Badge>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/app/customers" params={{ q: q || undefined, view: view !== 'active' ? view : undefined }} />
    </>
  );
}
