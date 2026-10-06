import { AlertTriangle, Package, Plus, Search } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Pagination, parsePage } from '@/components/ui/pagination';
import { Alert, Badge, ButtonLink, buttonClass, cx, EmptyState, Input, PageHeader } from '@/components/ui/primitives';
import { requireBusiness } from '@/lib/auth/session';
import { formatMoney } from '@/lib/money/money';
import { signedImageUrls } from '@/lib/storage/images';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Productos' };
const PAGE_SIZE = 25;

interface VariantJson {
  id: string;
  size: string | null;
  color: string | null;
  sku: string | null;
  price_cents: number;
  track_inventory: boolean;
  on_hand: number;
  reserved: number;
  available: number;
  is_low_stock: boolean;
  is_out_of_stock: boolean;
}

export default async function ProductsPage({ searchParams }: PageProps<'/app/products'>) {
  await requireBusiness('/app/products');
  const sp = await searchParams;
  const q = typeof sp.q === 'string' ? sp.q.slice(0, 80) : '';
  const view = sp.view === 'archived' ? 'archived' : 'active';
  const low = sp.low === '1';
  const page = parsePage(sp.page);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('list_products', {
    p_search: q || undefined,
    p_archived: view === 'archived',
    p_low_stock: low,
    p_limit: PAGE_SIZE,
    p_offset: (page - 1) * PAGE_SIZE,
  });
  const rows = data ?? [];
  const total = rows[0]?.total_count ?? 0;
  const images = await signedImageUrls(supabase, rows.map((r) => r.image_path));
  const filtered = Boolean(q) || low || view === 'archived';

  const tab = (label: string, params: Record<string, string>, active: boolean) => {
    const s = new URLSearchParams(params).toString();
    return (
      <Link href={`/app/products${s ? `?${s}` : ''}`} aria-current={active ? 'true' : undefined} className={cx(buttonClass(active ? 'primary' : 'secondary'), 'min-h-10 px-3 text-sm')}>
        {label}
      </Link>
    );
  };

  return (
    <>
      <PageHeader
        title="Productos"
        description="Disponible = en existencia − reservado en pedidos confirmados."
        actions={
          <ButtonLink href="/app/products/new">
            <Plus aria-hidden className="size-5" /> Agregar producto
          </ButtonLink>
        }
      />
      <form className="mb-3 flex gap-2" role="search">
        {view === 'archived' ? <input type="hidden" name="view" value="archived" /> : null}
        {low ? <input type="hidden" name="low" value="1" /> : null}
        <label htmlFor="q" className="sr-only">Buscar por nombre o SKU</label>
        <Input id="q" name="q" defaultValue={q} placeholder="Buscar por nombre o SKU" type="search" />
        <button className={buttonClass('secondary')} aria-label="Buscar">
          <Search aria-hidden className="size-5" />
        </button>
      </form>
      <div className="mb-4 flex flex-wrap gap-2">
        {tab('Activos', q ? { q } : {}, view === 'active' && !low)}
        {tab('Stock bajo', { ...(q ? { q } : {}), low: '1' }, low)}
        {tab('Archivados', { ...(q ? { q } : {}), view: 'archived' }, view === 'archived')}
      </div>

      {error ? (
        <Alert tone="danger" role="alert">No pudimos cargar los productos. Actualizá la página.</Alert>
      ) : rows.length === 0 ? (
        filtered ? (
          <EmptyState title="No hay productos con ese filtro" description="Probá con otra búsqueda o quitá los filtros." actions={<ButtonLink variant="secondary" href="/app/products">Ver todos</ButtonLink>} />
        ) : (
          <EmptyState
            icon={<Package className="size-10" aria-hidden />}
            title="Todavía no cargaste productos"
            description="Agregá tu primer producto con sus tallas, colores, precio y stock."
            actions={<ButtonLink href="/app/products/new">Agregar primer producto</ButtonLink>}
          />
        )
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {rows.map((p) => {
            const variants = (p.variants as unknown as VariantJson[]) ?? [];
            const prices = variants.map((v) => v.price_cents);
            const min = Math.min(...prices);
            const max = Math.max(...prices);
            const tracked = variants.filter((v) => v.track_inventory);
            const available = tracked.reduce((s, v) => s + v.available, 0);
            const lowCount = variants.filter((v) => v.is_low_stock).length;
            const outCount = variants.filter((v) => v.is_out_of_stock).length;
            const img = p.image_path ? images.get(p.image_path) : null;
            return (
              <li key={p.id}>
                <Link href={`/app/products/${p.id}`} className="flex gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-3 hover:border-line-strong">
                  {img ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={img} alt="" loading="lazy" className="size-16 shrink-0 rounded-[var(--radius-field)] bg-page object-cover" />
                  ) : (
                    <div className="flex size-16 shrink-0 items-center justify-center rounded-[var(--radius-field)] bg-page text-muted">
                      <Package aria-hidden className="size-7" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold break-words">{p.name}</p>
                    <p className="tabular text-muted">
                      {min === max ? formatMoney(min) : `${formatMoney(min)} – ${formatMoney(max)}`} · {variants.length}{' '}
                      {variants.length === 1 ? 'variante' : 'variantes'}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {tracked.length > 0 ? <Badge>Disponible: {available}</Badge> : <Badge>Sin control de stock</Badge>}
                      {outCount > 0 ? (
                        <Badge tone="danger" icon={<AlertTriangle aria-hidden className="size-3.5" />}>
                          Agotado: {outCount}
                        </Badge>
                      ) : lowCount > 0 ? (
                        <Badge tone="warning" icon={<AlertTriangle aria-hidden className="size-3.5" />}>
                          Stock bajo: {lowCount}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/app/products" params={{ q: q || undefined, view: view === 'archived' ? 'archived' : undefined, low: low ? '1' : undefined }} />
    </>
  );
}
