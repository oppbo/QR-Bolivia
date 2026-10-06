'use client';

import { Minus, Package, Plus, Search, Trash2, UserPlus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { confirmDiscard, useUnsavedChangesWarning } from '@/components/use-unsaved';
import { Dialog } from '@/components/ui/dialog';
import { Alert, Badge, Button, Card, cx, describedBy, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { SubmitButton } from '@/components/ui/submit-button';
import { CustomerForm, emptyCustomer } from '@/features/customers/customer-form';
import { centsToInput, formatMoney, parseMoneyInput } from '@/lib/money/money';
import { computeOrderTotals } from '@/lib/money/order-math';
import { PAYMENT_METHOD_LABEL, PAYMENT_METHODS } from '@/lib/orders/labels';
import { formatPhone } from '@/lib/phone';
import { createOrder, searchCustomers, searchVariants, updateOrderDraft, type CustomerOption, type VariantOption } from './actions';

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

let seq = 0;
const lineKey = () => `l${Date.now()}-${seq++}`;

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function money(raw: string): number | null {
  if (raw.trim() === '') return 0;
  const r = parseMoneyInput(raw);
  return r.ok ? r.cents : null;
}

export function OrderForm({
  initial,
  mode,
  orderId,
  revision,
  today,
}: {
  initial: OrderDraft;
  mode: 'create' | 'edit';
  orderId?: string;
  revision?: number;
  today: string;
}) {
  const router = useRouter();
  const [d, setD] = useState<OrderDraft>(initial);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const [withPayment, setWithPayment] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('');
  // Una clave por formulario: reintentos del mismo envío nunca duplican el pedido.
  const idempotencyKey = useRef<string>('');
  if (!idempotencyKey.current && typeof crypto !== 'undefined') idempotencyKey.current = crypto.randomUUID();
  useUnsavedChangesWarning(dirty && !pending);

  const patch = (p: Partial<OrderDraft>) => {
    setD((x) => ({ ...x, ...p }));
    setDirty(true);
  };
  const patchLine = (key: string, p: Partial<LineDraft>) => {
    setD((x) => ({ ...x, lines: x.lines.map((l) => (l.key === key ? { ...l, ...p } : l)) }));
    setDirty(true);
  };

  const totals = useMemo(() => {
    const lines = d.lines.map((l) => ({ quantity: Number(l.quantity), unitPriceCents: money(l.unit_price) ?? -1 }));
    const discount = money(d.discount);
    const fee = d.fulfillment_type === 'delivery' ? money(d.delivery_fee) : 0;
    if (discount == null || fee == null || lines.some((l) => !Number.isInteger(l.quantity) || l.quantity < 1 || l.unitPriceCents < 0)) {
      return null;
    }
    const r = computeOrderTotals(lines, discount, fee);
    return r;
  }, [d]);

  function addVariant(v: VariantOption) {
    const existing = d.lines.find((l) => l.variant_id === v.variant_id);
    if (existing) {
      patchLine(existing.key, { quantity: String((Number(existing.quantity) || 0) + 1) });
      return;
    }
    patch({
      lines: [
        ...d.lines,
        {
          key: lineKey(),
          variant_id: v.variant_id,
          product_name: v.product_name,
          label: v.label,
          track_inventory: v.track_inventory,
          available: v.track_inventory ? v.available : null,
          quantity: '1',
          unit_price: centsToInput(v.price_cents),
          list_price_cents: v.price_cents,
        },
      ],
    });
  }

  function selectCustomer(c: CustomerOption | null) {
    patch({
      customer: c,
      walkIn: false,
      delivery_address: c?.address ?? d.delivery_address,
      delivery_reference: c?.delivery_reference ?? d.delivery_reference,
    });
  }

  function submit(confirm: boolean) {
    setError(null);
    setFieldErrors({});
    if (!d.customer && !d.walkIn) {
      setFieldErrors({ customer: 'Elegí un cliente o marcá «Venta sin cliente registrado».' });
      setError('Revisá los campos marcados.');
      return;
    }
    const order = {
      customer_id: d.walkIn ? null : (d.customer?.id ?? null),
      customer_name: d.walkIn ? d.customer_name : '',
      customer_phone: d.walkIn ? d.customer_phone : '',
      fulfillment_type: d.fulfillment_type,
      promised_date: d.promised_date,
      time_window: d.time_window,
      delivery_address: d.delivery_address,
      delivery_reference: d.delivery_reference,
      notes: d.notes,
      discount: d.discount.trim() === '' ? '0' : d.discount,
      delivery_fee: d.delivery_fee.trim() === '' ? '0' : d.delivery_fee,
      items: d.lines.map((l) => ({ variant_id: l.variant_id, quantity: l.quantity.trim(), unit_price: l.unit_price })),
    };
    start(async () => {
      const r =
        mode === 'create'
          ? await createOrder({
              order,
              confirm,
              payment: confirm && withPayment ? { amount: payAmount, method: payMethod } : null,
              idempotencyKey: idempotencyKey.current,
            }).catch(() => null)
          : await updateOrderDraft(orderId!, revision!, order).catch(() => null);
      if (!r) {
        setError('No pudimos guardar los cambios. Tus datos siguen en el formulario.');
        return;
      }
      if (!r.ok) {
        setError(r.error);
        setFieldErrors(('fieldErrors' in r && r.fieldErrors) || {});
        return;
      }
      setDirty(false);
      router.push(`/app/orders/${r.data.id}${mode === 'create' ? '?created=1' : ''}`);
      router.refresh();
    });
  }

  const lineErr = (key: string, f: string) => fieldErrors[`items.${d.lines.findIndex((l) => l.key === key)}.${f}`];
  const total = totals?.ok ? totals.totals.totalCents : null;

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit(mode === 'create');
      }}
      className="flex flex-col gap-4 pb-28"
    >
      {error ? (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      ) : null}

      {/* 1. Cliente */}
      <Card className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">1. Cliente</h2>
        <CustomerPicker value={d.customer} walkIn={d.walkIn} onSelect={selectCustomer} error={fieldErrors.customer} />
        <label className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            className="size-5 accent-[var(--color-primary)]"
            checked={d.walkIn}
            onChange={(e) => patch({ walkIn: e.target.checked, customer: e.target.checked ? null : d.customer })}
          />
          Venta sin cliente registrado
        </label>
        {d.walkIn ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="walk-name" label="Nombre" optional error={fieldErrors.customer_name}>
              <Input id="walk-name" value={d.customer_name} onChange={(e) => patch({ customer_name: e.target.value })} maxLength={120} />
            </Field>
            <Field id="walk-phone" label="Teléfono" optional error={fieldErrors.customer_phone}>
              <Input id="walk-phone" inputMode="tel" value={d.customer_phone} onChange={(e) => patch({ customer_phone: e.target.value })} />
            </Field>
          </div>
        ) : null}
      </Card>

      {/* 2. Productos */}
      <Card className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">2. Productos</h2>
        <VariantPicker onPick={addVariant} />
        {fieldErrors.items ? <p className="text-sm font-medium text-danger">{fieldErrors.items}</p> : null}
        {d.lines.length === 0 ? (
          <p className="rounded-[var(--radius-field)] bg-page p-3 text-muted">Buscá y tocá un producto para agregarlo.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {d.lines.map((l) => {
              const qty = Number(l.quantity);
              const over = l.track_inventory && l.available != null && Number.isInteger(qty) && qty > l.available;
              const price = money(l.unit_price);
              const overridden = price != null && price !== l.list_price_cents;
              return (
                <li key={l.key} className="flex flex-col gap-2 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold break-words">{l.product_name}</p>
                      <p className="text-sm text-muted">
                        {l.label ?? 'Única'}
                        {l.track_inventory && l.available != null ? ` · Disponible: ${l.available}` : ' · Sin control de stock'}
                      </p>
                    </div>
                    <Button variant="ghost" aria-label={`Quitar ${l.product_name}`} onClick={() => patch({ lines: d.lines.filter((x) => x.key !== l.key) })}>
                      <Trash2 aria-hidden className="size-5" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-[auto_1fr] items-end gap-3 sm:grid-cols-[auto_200px_1fr]">
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor={`${l.key}-q`} className="text-sm font-medium">Cantidad</label>
                      <div className="flex items-center">
                        <button type="button" aria-label="Restar uno" className="inline-flex size-11 items-center justify-center rounded-l-[var(--radius-field)] border border-line-strong bg-surface" onClick={() => patchLine(l.key, { quantity: String(Math.max(1, (Number(l.quantity) || 1) - 1)) })}>
                          <Minus aria-hidden className="size-4" />
                        </button>
                        <input
                          id={`${l.key}-q`}
                          inputMode="numeric"
                          className="tabular h-11 w-14 border-y border-line-strong bg-surface text-center text-base"
                          value={l.quantity}
                          onChange={(e) => patchLine(l.key, { quantity: e.target.value })}
                          aria-invalid={lineErr(l.key, 'quantity') ? true : undefined}
                        />
                        <button type="button" aria-label="Sumar uno" className="inline-flex size-11 items-center justify-center rounded-r-[var(--radius-field)] border border-line-strong bg-surface" onClick={() => patchLine(l.key, { quantity: String((Number(l.quantity) || 0) + 1) })}>
                          <Plus aria-hidden className="size-4" />
                        </button>
                      </div>
                    </div>
                    <Field id={`${l.key}-p`} label="Precio unitario (Bs)" error={lineErr(l.key, 'unit_price')}>
                      <Input id={`${l.key}-p`} inputMode="decimal" value={l.unit_price} onChange={(e) => patchLine(l.key, { unit_price: e.target.value })} />
                    </Field>
                    <p className="tabular col-span-2 text-right font-semibold sm:col-span-1 sm:pb-2">
                      {price != null && Number.isInteger(qty) && qty > 0 ? formatMoney(qty * price) : '—'}
                    </p>
                  </div>
                  {lineErr(l.key, 'quantity') ? <p className="text-sm font-medium text-danger">{lineErr(l.key, 'quantity')}</p> : null}
                  {overridden ? <p className="text-sm text-muted">Precio de lista: {formatMoney(l.list_price_cents)}. Este pedido guarda el precio que pongas.</p> : null}
                  {over ? (
                    <Alert tone="warning">Pediste más de lo disponible ({l.available}). No se podrá confirmar hasta ajustar la cantidad o el stock.</Alert>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* 3. Entrega */}
      <Card className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">3. Entrega</h2>
        <fieldset>
          <legend className="mb-1.5 font-medium">¿Cómo se entrega?</legend>
          <div className="grid grid-cols-2 gap-2">
            {(['pickup', 'delivery'] as const).map((t) => (
              <label
                key={t}
                className={cx(
                  'flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-[var(--radius-field)] border px-3 font-semibold has-focus-visible:outline-3 has-focus-visible:outline-blue-600',
                  d.fulfillment_type === t ? 'border-primary bg-primary-soft text-primary' : 'border-line-strong bg-surface',
                )}
              >
                <input type="radio" name="fulfillment" className="sr-only" checked={d.fulfillment_type === t} onChange={() => patch({ fulfillment_type: t })} />
                {t === 'pickup' ? 'Retira en tienda' : 'Envío a domicilio'}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="promised" label="Fecha de entrega" optional error={fieldErrors.promised_date}>
            <Input id="promised" type="date" min={mode === 'create' ? today : undefined} value={d.promised_date} onChange={(e) => patch({ promised_date: e.target.value })} />
          </Field>
          <Field id="window" label="Horario" optional>
            <Input id="window" value={d.time_window} onChange={(e) => patch({ time_window: e.target.value })} maxLength={60} placeholder="Ej.: por la tarde" />
          </Field>
        </div>
        {d.fulfillment_type === 'delivery' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="address" label="Dirección de entrega" optional error={fieldErrors.delivery_address}>
              <Input id="address" value={d.delivery_address} onChange={(e) => patch({ delivery_address: e.target.value })} maxLength={300} />
            </Field>
            <Field id="reference" label="Referencia" optional>
              <Input id="reference" value={d.delivery_reference} onChange={(e) => patch({ delivery_reference: e.target.value })} maxLength={300} />
            </Field>
          </div>
        ) : null}
        <Field id="notes" label="Notas privadas" optional hint="Solo para vos; no se comparten con el cliente.">
          <Textarea id="notes" rows={2} value={d.notes} onChange={(e) => patch({ notes: e.target.value })} maxLength={2000} aria-describedby={describedBy('notes', { hint: true })} />
        </Field>
      </Card>

      {/* 4. Resumen */}
      <Card className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">4. Resumen</h2>
        <div className="grid grid-cols-2 gap-3">
          <Field id="discount" label="Descuento (Bs)" optional hint="Monto fijo sobre el pedido." error={fieldErrors.discount}>
            <Input id="discount" inputMode="decimal" value={d.discount} onChange={(e) => patch({ discount: e.target.value })} placeholder="0.00" aria-invalid={fieldErrors.discount ? true : undefined} aria-describedby={describedBy('discount', { hint: true, error: fieldErrors.discount })} />
          </Field>
          {d.fulfillment_type === 'delivery' ? (
            <Field id="fee" label="Costo de envío (Bs)" optional error={fieldErrors.delivery_fee}>
              <Input id="fee" inputMode="decimal" value={d.delivery_fee} onChange={(e) => patch({ delivery_fee: e.target.value })} placeholder="0.00" />
            </Field>
          ) : null}
        </div>
        {totals && !totals.ok ? <Alert tone="warning">{totals.error}</Alert> : null}
        {!totals ? <p className="text-sm text-muted">Revisá cantidades y montos para ver el total.</p> : null}
        {totals?.ok ? (
          <dl className="tabular flex flex-col gap-1">
            <div className="flex justify-between"><dt>Subtotal productos</dt><dd>{formatMoney(totals.totals.subtotalCents)}</dd></div>
            {totals.totals.discountCents > 0 ? <div className="flex justify-between"><dt>Descuento</dt><dd>-{formatMoney(totals.totals.discountCents)}</dd></div> : null}
            {totals.totals.deliveryFeeCents > 0 ? <div className="flex justify-between"><dt>Envío</dt><dd>{formatMoney(totals.totals.deliveryFeeCents)}</dd></div> : null}
            <div className="mt-1 flex justify-between border-t border-line pt-2 text-lg font-bold"><dt>Total</dt><dd>{formatMoney(totals.totals.totalCents)}</dd></div>
          </dl>
        ) : null}

        {mode === 'create' ? (
          <div className="flex flex-col gap-3 border-t border-line pt-3">
            <label className="flex min-h-11 items-center gap-3">
              <input type="checkbox" className="size-5 accent-[var(--color-primary)]" checked={withPayment} disabled={total === 0} onChange={(e) => setWithPayment(e.target.checked)} />
              Registrar un pago al confirmar (anticipo o pago total)
            </label>
            {withPayment ? (
              <div className="grid grid-cols-2 gap-3">
                <Field id="pay-amount" label="Monto (Bs)" error={fieldErrors.payment_amount}>
                  <Input id="pay-amount" inputMode="decimal" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder={total ? centsToInput(total) : ''} />
                </Field>
                <Field id="pay-method" label="Medio" error={fieldErrors.payment_method}>
                  <Select id="pay-method" value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                    <option value="">Elegí…</option>
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</option>
                    ))}
                  </Select>
                </Field>
                <p className="col-span-2 text-sm text-muted">Se guarda como «Registrado manualmente». Mi Negocio no verifica pagos con el banco.</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </Card>

      <div className="pb-safe fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur lg:static lg:border-0 lg:bg-transparent lg:p-0">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 lg:justify-end">
          {total != null && d.lines.length > 0 ? (
            <p className="tabular mr-auto font-bold lg:hidden" aria-live="polite">
              Total {formatMoney(total)}
            </p>
          ) : null}
          <Button variant="secondary" className="hidden sm:inline-flex" onClick={() => confirmDiscard(dirty) && router.back()}>
            Cancelar
          </Button>
          {mode === 'create' ? (
            <>
              <Button variant="secondary" disabled={pending} onClick={() => submit(false)}>
                Guardar como Nuevo
              </Button>
              <SubmitButton pending={pending} pendingText="Confirmando…">
                Confirmar pedido
              </SubmitButton>
            </>
          ) : (
            <SubmitButton pending={pending}>Guardar cambios</SubmitButton>
          )}
        </div>
      </div>
    </form>
  );
}

function CustomerPicker({
  value,
  walkIn,
  onSelect,
  error,
}: {
  value: CustomerOption | null;
  walkIn: boolean;
  onSelect: (c: CustomerOption | null) => void;
  error?: string;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<CustomerOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const debounced = useDebounced(q, 250);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    searchCustomers(debounced)
      .then((r) => alive && setResults(r))
      .catch(() => alive && setResults([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [debounced, open]);

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-[var(--radius-field)] border border-primary/40 bg-primary-soft p-3">
        <div className="min-w-0">
          <p className="font-semibold break-words">{value.name}</p>
          <p className="text-sm text-muted">{value.phone ? formatPhone(value.phone) : 'Sin teléfono'}</p>
        </div>
        <Button variant="ghost" onClick={() => onSelect(null)} aria-label="Cambiar cliente">
          <X aria-hidden className="size-5" /> Cambiar
        </Button>
      </div>
    );
  }
  if (walkIn) return null;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="customer-search" className="font-medium">Buscar cliente</label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted" />
          <Input
            id="customer-search"
            className="pl-10"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => setOpen(true)}
            placeholder="Nombre o teléfono"
            autoComplete="off"
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy('customer-search', { error })}
          />
        </div>
        <Dialog
          open={creating}
          onOpenChange={setCreating}
          title="Nuevo cliente"
          description="Se guarda y queda elegido para este pedido. Lo que ya cargaste no se pierde."
          trigger={
            <Button variant="secondary" aria-label="Nuevo cliente">
              <UserPlus aria-hidden className="size-5" /> <span className="hidden sm:inline">Nuevo</span>
            </Button>
          }
        >
          <CustomerForm
            initial={{ ...emptyCustomer, name: /\d/.test(q) ? '' : q, phone: /\d/.test(q) ? q : '' }}
            onCancel={() => setCreating(false)}
            onSaved={(c) => {
              setCreating(false);
              onSelect(c);
            }}
          />
        </Dialog>
      </div>
      {error ? <p id="customer-search-error" className="text-sm font-medium text-danger">{error}</p> : null}
      {open ? (
        <ul className="flex max-h-64 flex-col overflow-y-auto rounded-[var(--radius-field)] border border-line" aria-label="Clientes encontrados" aria-busy={loading}>
          {results.length === 0 ? (
            <li className="p-3 text-muted">{loading ? 'Buscando…' : 'Sin resultados. Podés crear un cliente nuevo.'}</li>
          ) : (
            results.map((c) => (
              <li key={c.id}>
                <button type="button" className="flex min-h-11 w-full flex-col items-start px-3 py-2 text-left hover:bg-page" onClick={() => onSelect(c)}>
                  <span className="font-medium">{c.name}</span>
                  <span className="text-sm text-muted">{c.phone ? formatPhone(c.phone) : 'Sin teléfono'}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}

function VariantPicker({ onPick }: { onPick: (v: VariantOption) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<VariantOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounced = useDebounced(q, 250);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    searchVariants(debounced)
      .then((r) => alive && setResults(r))
      .catch(() => alive && setResults([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [debounced, open]);

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="variant-search" className="font-medium">Agregar producto</label>
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted" />
        <Input id="variant-search" className="pl-10" value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => setOpen(true)} placeholder="Nombre o SKU" autoComplete="off" />
      </div>
      {open ? (
        <ul className="flex max-h-72 flex-col overflow-y-auto rounded-[var(--radius-field)] border border-line" aria-label="Productos encontrados" aria-busy={loading}>
          {results.length === 0 ? (
            <li className="flex items-center gap-2 p-3 text-muted">
              <Package aria-hidden className="size-5" />
              {loading ? 'Buscando…' : 'Sin resultados. Revisá que el producto esté cargado y activo.'}
            </li>
          ) : (
            results.map((v) => (
              <li key={v.variant_id}>
                <button
                  type="button"
                  className="flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-page"
                  onClick={() => onPick(v)}
                >
                  <span className="min-w-0">
                    <span className="block font-medium break-words">{v.product_name}</span>
                    <span className="block text-sm text-muted">
                      {v.label ?? 'Única'} · {formatMoney(v.price_cents)}
                    </span>
                  </span>
                  {v.track_inventory ? (
                    <Badge tone={v.available === 0 ? 'danger' : 'neutral'}>{v.available === 0 ? 'Agotado' : `Disponible: ${v.available}`}</Badge>
                  ) : (
                    <Badge>Sin control</Badge>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
