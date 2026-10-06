'use client';

import { Ban, CheckCircle2, Copy, MessageCircle, PackageCheck, PackageOpen, Pencil, RotateCcw, Truck, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition, type ReactNode } from 'react';
import { ImagePicker } from '@/components/image-picker';
import { Dialog } from '@/components/ui/dialog';
import { Alert, Button, buttonClass, describedBy, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { SubmitButton } from '@/components/ui/submit-button';
import { toLocalInputValue } from '@/lib/dates';
import { centsToInput, formatMoney, parseMoneyInput } from '@/lib/money/money';
import type { OrderStatus } from '@/lib/money/order-math';
import { PAYMENT_METHOD_LABEL, PAYMENT_METHODS } from '@/lib/orders/labels';
import { whatsappUrl } from '@/lib/whatsapp';
import {
  cancelOrder,
  logShareOpened,
  recordPayment,
  recordRefund,
  transitionOrder,
  updateLogistics,
  voidPayment,
  voidRefund,
  type OrderActionResult,
} from './actions';

/** Ejecuta una acción del servidor sin éxito optimista: espera la confirmación y muestra errores. */
function useServerAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<{ message: string; stale: boolean } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  function run(fn: () => Promise<OrderActionResult<unknown>>, onOk?: () => void) {
    setError(null);
    setFieldErrors({});
    start(async () => {
      const r = await fn().catch(() => null);
      if (!r) {
        setError({ message: 'No pudimos guardar los cambios. Revisá tu conexión; tus datos siguen en el formulario.', stale: false });
        return;
      }
      if (!r.ok) {
        const code = 'code' in r ? r.code : undefined;
        setError({ message: r.error, stale: code === 'stale_order' });
        if ('fieldErrors' in r && r.fieldErrors) setFieldErrors(r.fieldErrors);
        return;
      }
      onOk?.();
      router.refresh();
    });
  }
  const errorView = error ? (
    <Alert tone="danger" role="alert">
      {error.message}
      {error.stale ? (
        <div className="mt-2">
          <Button variant="secondary" onClick={() => router.refresh()}>
            Actualizar
          </Button>
        </div>
      ) : null}
    </Alert>
  ) : null;
  return { pending, run, errorView, fieldErrors, setError };
}

export interface OrderActionsProps {
  id: string;
  code: string;
  revision: number;
  status: OrderStatus;
  totalCents: number;
  balanceDueCents: number;
  timezone: string;
}

export function TransitionActions({ id, revision, status, balanceDueCents }: OrderActionsProps) {
  const { pending, run, errorView } = useServerAction();
  const [deliverOpen, setDeliverOpen] = useState(false);
  const go = (to: 'confirmed' | 'preparing' | 'delivered') => run(() => transitionOrder(id, revision, to), () => setDeliverOpen(false));

  const deliverButton = (variant: 'primary' | 'secondary') =>
    balanceDueCents > 0 ? (
      <Dialog
        open={deliverOpen}
        onOpenChange={setDeliverOpen}
        title="Marcar como entregado"
        trigger={
          <Button variant={variant} disabled={pending}>
            <PackageCheck aria-hidden className="size-5" /> Marcar entregado
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <Alert tone="warning" title={`Saldo pendiente: ${formatMoney(balanceDueCents)}`}>
            Podés entregar antes del pago completo. El saldo seguirá apareciendo como «por cobrar».
          </Alert>
          {errorView}
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setDeliverOpen(false)}>Volver</Button>
            <Button className="flex-1" disabled={pending} onClick={() => go('delivered')}>
              {pending ? 'Guardando…' : 'Entregar igualmente'}
            </Button>
          </div>
        </div>
      </Dialog>
    ) : (
      <Button variant={variant} disabled={pending} onClick={() => go('delivered')}>
        <PackageCheck aria-hidden className="size-5" /> Marcar entregado
      </Button>
    );

  return (
    <div className="flex flex-col gap-2">
      {!deliverOpen ? errorView : null}
      <div className="flex flex-wrap gap-2">
        {status === 'new' ? (
          <>
            <Button disabled={pending} onClick={() => go('confirmed')}>
              <CheckCircle2 aria-hidden className="size-5" /> {pending ? 'Confirmando…' : 'Confirmar pedido'}
            </Button>
            <Link href={`/app/orders/${id}/edit`} className={buttonClass('secondary')}>
              <Pencil aria-hidden className="size-4" /> Editar
            </Link>
          </>
        ) : null}
        {status === 'confirmed' ? (
          <>
            <Button disabled={pending} onClick={() => go('preparing')}>
              <PackageOpen aria-hidden className="size-5" /> Marcar preparando
            </Button>
            {deliverButton('secondary')}
          </>
        ) : null}
        {status === 'preparing' ? deliverButton('primary') : null}
      </div>
      {status === 'new' ? <p className="text-sm text-muted">Al confirmar se reserva el stock y se congelan precios y montos.</p> : null}
    </div>
  );
}

export function PaymentDialog({ id, balanceDueCents, timezone, trigger }: OrderActionsProps & { trigger?: ReactNode }) {
  const { pending, run, errorView, fieldErrors } = useServerAction();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(centsToInput(balanceDueCents));
  const [method, setMethod] = useState('');
  const [occurred, setOccurred] = useState(() => toLocalInputValue(new Date(), timezone));
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [receipt, setReceipt] = useState<File | null>(null);
  const key = useRef(crypto.randomUUID());
  const parsed = parseMoneyInput(amount, { allowZero: false });
  const over = parsed.ok && parsed.cents > balanceDueCents;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const fd = new FormData();
    fd.set('order_id', id);
    fd.set('amount', amount);
    fd.set('method', method);
    fd.set('occurred_at', occurred);
    fd.set('reference', reference);
    fd.set('note', note);
    fd.set('idempotency_key', key.current);
    if (receipt) fd.set('receipt', receipt);
    run(
      () => recordPayment(fd),
      () => {
        setOpen(false);
        key.current = crypto.randomUUID();
        setReference('');
        setNote('');
        setReceipt(null);
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setAmount(centsToInput(balanceDueCents));
          setOccurred(toLocalInputValue(new Date(), timezone));
        }
      }}
      title="Registrar pago"
      description={`Saldo pendiente: ${formatMoney(balanceDueCents)}`}
      trigger={
        trigger ?? (
          <Button>
            <Wallet aria-hidden className="size-5" /> Registrar pago
          </Button>
        )
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {errorView}
        <div className="grid grid-cols-2 gap-3">
          <Field id="p-amount" label="Monto (Bs)" error={fieldErrors.amount ?? (over ? 'El pago supera el saldo pendiente de este pedido.' : undefined)}>
            <Input id="p-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={fieldErrors.amount || over ? true : undefined} aria-describedby={describedBy('p-amount', { error: fieldErrors.amount || over })} />
          </Field>
          <Field id="p-method" label="Medio" error={fieldErrors.method}>
            <Select id="p-method" value={method} onChange={(e) => setMethod(e.target.value)} aria-invalid={fieldErrors.method ? true : undefined}>
              <option value="">Elegí…</option>
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</option>)}
            </Select>
          </Field>
        </div>
        <Field id="p-when" label="Fecha y hora del pago" error={fieldErrors.occurred_at}>
          <Input id="p-when" type="datetime-local" value={occurred} max={toLocalInputValue(new Date(), timezone)} onChange={(e) => setOccurred(e.target.value)} />
        </Field>
        <Field id="p-ref" label="Referencia" optional hint="Ej.: últimos dígitos de la transferencia.">
          <Input id="p-ref" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} />
        </Field>
        <Field id="p-note" label="Nota" optional>
          <Input id="p-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </Field>
        <ImagePicker label="Comprobante" compress onChange={(f) => setReceipt(f)} hint="Solo como respaldo: subir una imagen no marca el pedido como pagado." />
        {fieldErrors.receipt ? <p className="text-sm font-medium text-danger">{fieldErrors.receipt}</p> : null}
        <p className="text-sm text-muted">Se guarda como «Registrado manualmente». Revisá en tu banco o billetera que el dinero haya llegado.</p>
        <SubmitButton pending={pending} disabled={over}>Registrar pago</SubmitButton>
      </form>
    </Dialog>
  );
}

export function CancelDialog({ id, revision, status, code }: OrderActionsProps) {
  const { pending, run, errorView, fieldErrors } = useServerAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [returned, setReturned] = useState<'' | 'yes' | 'no'>('');
  const delivered = status === 'delivered';
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={`Cancelar ${code}`}
      description={
        delivered
          ? 'Cancelación y devolución del pedido completo. Las devoluciones parciales no están disponibles en esta versión.'
          : status === 'new'
            ? 'El pedido no tiene stock reservado.'
            : 'Se liberan las unidades reservadas. La existencia física no cambia.'
      }
      trigger={
        <Button variant="secondary">
          <Ban aria-hidden className="size-4" /> Cancelar pedido
        </Button>
      }
    >
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          run(() => cancelOrder(id, revision, reason, delivered ? (returned === 'yes' ? true : returned === 'no' ? false : null) : null), () => setOpen(false));
        }}
      >
        {errorView}
        <Field id="cancel-reason" label="Motivo" error={fieldErrors.reason}>
          <Textarea id="cancel-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} aria-invalid={fieldErrors.reason ? true : undefined} />
        </Field>
        {delivered ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 font-medium">¿Toda la mercadería volvió y se puede vender de nuevo?</legend>
            <label className="flex min-h-11 items-center gap-3">
              <input type="radio" name="returned" className="size-5 accent-[var(--color-primary)]" checked={returned === 'yes'} onChange={() => setReturned('yes')} />
              Sí, vuelve al stock vendible
            </label>
            <label className="flex min-h-11 items-center gap-3">
              <input type="radio" name="returned" className="size-5 accent-[var(--color-primary)]" checked={returned === 'no'} onChange={() => setReturned('no')} />
              No, no se repone el stock (dañada, no devuelta, etc.)
            </label>
          </fieldset>
        ) : null}
        <p className="text-sm text-muted">Cancelar no devuelve dinero automáticamente. Si cobraste algo, después registrá el reembolso.</p>
        <SubmitButton pending={pending} variant="danger" disabled={delivered && returned === ''}>
          Cancelar pedido
        </SubmitButton>
      </form>
    </Dialog>
  );
}

export function VoidEntryDialog({ kind, entryId, amountCents }: { kind: 'payment' | 'refund'; entryId: string; amountCents: number }) {
  const { pending, run, errorView, fieldErrors } = useServerAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={`Anular registro de ${kind === 'payment' ? 'pago' : 'reembolso'}`}
      description={`Usalo si el registro de ${formatMoney(amountCents)} fue un error. El registro queda visible como anulado. Esto no mueve dinero.`}
      trigger={<Button variant="ghost" className="min-h-10 px-2 text-sm">Anular registro</Button>}
    >
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          run(() => (kind === 'payment' ? voidPayment(entryId, reason) : voidRefund(entryId, reason)), () => setOpen(false));
        }}
      >
        {errorView}
        <Field id={`void-${entryId}`} label="Motivo" error={fieldErrors.reason}>
          <Input id={`void-${entryId}`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Ej.: monto equivocado" />
        </Field>
        <SubmitButton pending={pending} variant="danger">Anular registro</SubmitButton>
      </form>
    </Dialog>
  );
}

export function RefundDialog({ paymentId, maxCents, timezone }: { paymentId: string; maxCents: number; timezone: string }) {
  const { pending, run, errorView, fieldErrors } = useServerAction();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(centsToInput(maxCents));
  const [method, setMethod] = useState('');
  const [reason, setReason] = useState('');
  const [occurred, setOccurred] = useState(() => toLocalInputValue(new Date(), timezone));
  const key = useRef(crypto.randomUUID());
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setOccurred(toLocalInputValue(new Date(), timezone));
      }}
      title="Registrar reembolso"
      description={`Registrá dinero que ya devolviste al cliente. Máximo para este pago: ${formatMoney(maxCents)}. No mueve dinero en ningún banco.`}
      trigger={
        <Button variant="secondary" className="min-h-10 px-3 text-sm">
          <RotateCcw aria-hidden className="size-4" /> Registrar reembolso
        </Button>
      }
    >
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          run(
            () => recordRefund({ payment_id: paymentId, amount, method, reason, occurred_at: occurred, idempotency_key: key.current }),
            () => {
              setOpen(false);
              key.current = crypto.randomUUID();
            },
          );
        }}
      >
        {errorView}
        <div className="grid grid-cols-2 gap-3">
          <Field id="r-amount" label="Monto (Bs)" error={fieldErrors.amount}>
            <Input id="r-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field id="r-method" label="Medio" error={fieldErrors.method}>
            <Select id="r-method" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="">Elegí…</option>
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</option>)}
            </Select>
          </Field>
        </div>
        <Field id="r-when" label="Fecha y hora" error={fieldErrors.occurred_at}>
          <Input id="r-when" type="datetime-local" value={occurred} onChange={(e) => setOccurred(e.target.value)} />
        </Field>
        <Field id="r-reason" label="Motivo" error={fieldErrors.reason}>
          <Input id="r-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </Field>
        <SubmitButton pending={pending}>Registrar reembolso</SubmitButton>
      </form>
    </Dialog>
  );
}

export function ShareDialog({
  orderId,
  kind,
  text,
  phone,
  customerId,
  disabledReason,
}: {
  orderId: string;
  kind: 'summary' | 'reminder';
  text: string;
  phone: string | null;
  customerId: string | null;
  disabledReason?: string;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<'ok' | 'error' | null>(null);
  const label = kind === 'summary' ? 'Compartir resumen' : 'Recordar saldo';
  if (disabledReason) {
    return (
      <Button variant="secondary" disabled title={disabledReason}>
        <MessageCircle aria-hidden className="size-4" /> {label}
      </Button>
    );
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        setCopied(null);
      }}
      title={kind === 'summary' ? 'Resumen del pedido' : 'Recordatorio de saldo'}
      description="Revisá el mensaje. Se abre WhatsApp y vos decidís si enviarlo."
      trigger={
        <Button variant="secondary">
          <MessageCircle aria-hidden className="size-4" /> {label}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <pre className="max-h-72 overflow-y-auto rounded-[var(--radius-field)] bg-page p-3 font-sans text-[0.95rem] whitespace-pre-wrap break-words" aria-label="Vista previa del mensaje">
          {text}
        </pre>
        {!phone ? (
          <Alert tone="info">
            Este pedido no tiene teléfono. Podés copiar el mensaje, abrir WhatsApp y elegir el contacto
            {customerId ? (
              <>
                , o <Link className="underline" href={`/app/customers/${customerId}`}>agregar el teléfono al cliente</Link>
              </>
            ) : null}
            .
          </Alert>
        ) : null}
        {copied === 'ok' ? <p role="status" className="text-sm font-medium text-primary">Mensaje copiado.</p> : null}
        {copied === 'error' ? <p role="alert" className="text-sm font-medium text-danger">No pudimos copiar. Seleccioná el texto y copialo manualmente.</p> : null}
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(text);
                setCopied('ok');
              } catch {
                setCopied('error');
              }
            }}
          >
            <Copy aria-hidden className="size-4" /> Copiar mensaje
          </Button>
          <a
            href={whatsappUrl(phone, text)}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClass('primary')}
            onClick={() => {
              void logShareOpened(orderId, kind).catch(() => undefined);
            }}
          >
            <MessageCircle aria-hidden className="size-4" /> Abrir WhatsApp
          </a>
        </div>
        <p className="text-sm text-muted">Abrir WhatsApp no confirma que el mensaje se haya enviado.</p>
      </div>
    </Dialog>
  );
}

export function LogisticsDialog({
  id,
  revision,
  initial,
}: {
  id: string;
  revision: number;
  initial: { fulfillment_type: 'pickup' | 'delivery'; promised_date: string; time_window: string; delivery_address: string; delivery_reference: string; notes: string };
}) {
  const { pending, run, errorView, fieldErrors } = useServerAction();
  const [open, setOpen] = useState(false);
  const [d, setD] = useState(initial);
  const set = (k: keyof typeof initial) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setD((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setD(initial);
      }}
      title="Datos de entrega y notas"
      description="Los montos y productos no cambian."
      trigger={
        <Button variant="ghost" className="min-h-10 px-2 text-sm">
          <Truck aria-hidden className="size-4" /> Editar entrega
        </Button>
      }
    >
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          run(() => updateLogistics(id, revision, d), () => setOpen(false));
        }}
      >
        {errorView}
        <Field id="l-type" label="Tipo de entrega">
          <Select id="l-type" value={d.fulfillment_type} onChange={set('fulfillment_type')}>
            <option value="pickup">Retira en tienda</option>
            <option value="delivery">Envío a domicilio</option>
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="l-date" label="Fecha" optional error={fieldErrors.promised_date}>
            <Input id="l-date" type="date" value={d.promised_date} onChange={set('promised_date')} />
          </Field>
          <Field id="l-window" label="Horario" optional>
            <Input id="l-window" value={d.time_window} onChange={set('time_window')} maxLength={60} />
          </Field>
        </div>
        {d.fulfillment_type === 'delivery' ? (
          <>
            <Field id="l-address" label="Dirección" optional>
              <Input id="l-address" value={d.delivery_address} onChange={set('delivery_address')} maxLength={300} />
            </Field>
            <Field id="l-ref" label="Referencia" optional>
              <Input id="l-ref" value={d.delivery_reference} onChange={set('delivery_reference')} maxLength={300} />
            </Field>
          </>
        ) : null}
        <Field id="l-notes" label="Notas privadas" optional>
          <Textarea id="l-notes" rows={2} value={d.notes} onChange={set('notes')} maxLength={2000} />
        </Field>
        <SubmitButton pending={pending}>Guardar</SubmitButton>
      </form>
    </Dialog>
  );
}
