import { AlertTriangle, Pencil } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alert, Badge, ButtonLink, Card, PageHeader, SectionTitle } from '@/components/ui/primitives';
import { ProductArchiveButton } from '@/features/products/archive-button';
import { StockAdjustButton } from '@/features/products/stock-adjust';
import { requireBusiness } from '@/lib/auth/session';
import { formatDateTime } from '@/lib/dates';
import { formatMoney } from '@/lib/money/money';
import { signedImageUrl } from '@/lib/storage/images';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Producto' };

const MOVEMENT_LABEL: Record<string, string> = {
  initial: 'Stock inicial',
  adjustment: 'Ajuste manual',
  reserve: 'Reservado por pedido',
  release: 'Reserva liberada (pedido cancelado)',
  deliver: 'Entregado',
  return: 'Devuelto al stock',
};

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

export default async function ProductPage({ params }: PageProps<'/app/products/[id]'>) {
  const { id } = await params;
  const { timezone } = await requireBusiness(`/app/products/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const [{ data: product }, { data: variants }] = await Promise.all([
    supabase.from('products').select('*').eq('id', id).maybeSingle(),
    supabase.from('variant_stock').select('*').eq('product_id', id).is('archived_at', null).order('position').order('created_at'),
  ]);
  if (!product) notFound();
  const variantIds = (variants ?? []).map((v) => v.id!);
  const [{ data: movements }, imageUrl] = await Promise.all([
    variantIds.length
      ? supabase
          .from('inventory_movements')
          .select('id, variant_id, order_id, movement_type, on_hand_delta, reserved_delta, on_hand_after, reserved_after, reason, created_at')
          .in('variant_id', variantIds)
          .order('created_at', { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [] as never[] }),
    signedImageUrl(supabase, product.image_path),
  ]);
  const label = (v: { size: string | null; color: string | null }) => [v.size, v.color].filter(Boolean).join(' / ') || 'Única';
  const variantLabel = new Map((variants ?? []).map((v) => [v.id, label(v)]));

  return (
    <>
      <PageHeader
        title={product.name}
        description={[product.category, product.archived_at ? 'Archivado' : null].filter(Boolean).join(' · ') || undefined}
        back={<Link href="/app/products" className="mb-1 inline-block text-primary underline">Productos</Link>}
        actions={
          <>
            <ButtonLink variant="secondary" href={`/app/products/${id}/edit`}>
              <Pencil aria-hidden className="size-4" /> Editar
            </ButtonLink>
            <ProductArchiveButton productId={id} archived={Boolean(product.archived_at)} />
          </>
        }
      />
      {product.archived_at ? (
        <div className="mb-4">
          <Alert tone="warning">Este producto está archivado: no aparece al crear pedidos. Los pedidos anteriores conservan sus datos.</Alert>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div className="flex flex-col gap-4">
          <Card>
            <SectionTitle>Variantes y stock</SectionTitle>
            <dl className="mb-4 grid gap-1 text-sm text-muted sm:grid-cols-3">
              <div><dt className="inline font-semibold text-ink">En existencia:</dt> <dd className="inline">unidades físicas que tenés.</dd></div>
              <div><dt className="inline font-semibold text-ink">Reservado:</dt> <dd className="inline">apartadas para pedidos confirmados.</dd></div>
              <div><dt className="inline font-semibold text-ink">Disponible:</dt> <dd className="inline">lo que podés vender (existencia − reservado).</dd></div>
            </dl>
            <ul className="flex flex-col divide-y divide-line">
              {(variants ?? []).map((v) => (
                <li key={v.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{label(v)}</p>
                    <p className="tabular text-muted">
                      {formatMoney(v.price_cents!)}
                      {v.sku ? ` · SKU ${v.sku}` : ''}
                      {v.cost_cents != null ? ` · Costo ${formatMoney(v.cost_cents)}` : ' · Costo desconocido'}
                    </p>
                  </div>
                  {v.track_inventory ? (
                    <>
                      <dl className="tabular grid grid-cols-3 gap-3 text-center">
                        <div><dt className="text-xs text-muted">Disponible</dt><dd className="text-lg font-bold">{v.available}</dd></div>
                        <div><dt className="text-xs text-muted">Reservado</dt><dd className="text-lg font-semibold">{v.reserved}</dd></div>
                        <div><dt className="text-xs text-muted">En existencia</dt><dd className="text-lg font-semibold">{v.on_hand}</dd></div>
                      </dl>
                      <div className="flex flex-wrap items-center gap-2">
                        {v.is_out_of_stock ? (
                          <Badge tone="danger" icon={<AlertTriangle aria-hidden className="size-3.5" />}>Agotado</Badge>
                        ) : v.is_low_stock ? (
                          <Badge tone="warning" icon={<AlertTriangle aria-hidden className="size-3.5" />}>Stock bajo</Badge>
                        ) : null}
                        <StockAdjustButton variantId={v.id!} label={`${product.name} — ${label(v)}`} onHand={v.on_hand!} reserved={v.reserved!} />
                      </div>
                    </>
                  ) : (
                    <Badge>Sin control de stock</Badge>
                  )}
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <SectionTitle>Movimientos de inventario</SectionTitle>
            {movements && movements.length > 0 ? (
              <ul className="flex flex-col divide-y divide-line">
                {movements.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {MOVEMENT_LABEL[m.movement_type] ?? m.movement_type} · {variantLabel.get(m.variant_id)}
                      </p>
                      <p className="text-sm text-muted">
                        {formatDateTime(m.created_at, timezone)}
                        {m.reason ? ` · ${m.reason}` : ''}
                        {m.order_id ? (
                          <>
                            {' · '}
                            <Link className="text-primary underline" href={`/app/orders/${m.order_id}`}>Ver pedido</Link>
                          </>
                        ) : null}
                      </p>
                    </div>
                    <p className="tabular text-sm">
                      {m.on_hand_delta !== 0 ? `Existencia ${signed(m.on_hand_delta)} → ${m.on_hand_after}` : null}
                      {m.on_hand_delta !== 0 && m.reserved_delta !== 0 ? ' · ' : null}
                      {m.reserved_delta !== 0 ? `Reservado ${signed(m.reserved_delta)} → ${m.reserved_after}` : null}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted">Sin movimientos todavía.</p>
            )}
          </Card>
        </div>
        <aside className="flex flex-col gap-4">
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl} alt={`Foto de ${product.name}`} className="w-full rounded-[var(--radius-card)] border border-line bg-surface object-contain" />
          ) : null}
          {product.description ? (
            <Card>
              <h2 className="mb-1 font-semibold">Descripción</h2>
              <p className="whitespace-pre-line text-muted">{product.description}</p>
            </Card>
          ) : null}
        </aside>
      </div>
    </>
  );
}
