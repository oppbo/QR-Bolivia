'use client';

import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { ImagePicker } from '@/components/image-picker';
import { Dialog } from '@/components/ui/dialog';
import { Alert, Button, Field, Input, Select } from '@/components/ui/primitives';
import { SubmitButton } from '@/components/ui/submit-button';
import { toLocalInputValue } from '@/lib/dates';
import { centsToInput, formatMoney } from '@/lib/money/money';
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABEL, PAYMENT_METHOD_LABEL, PAYMENT_METHODS } from '@/lib/orders/labels';
import { saveExpense, voidExpense } from './actions';

export interface ExpenseEntry {
  id: string;
  amount_cents: number;
  category: string;
  method: string;
  occurred_at: string;
  description: string | null;
}

export function ExpenseDialog({ timezone, correcting }: { timezone: string; correcting?: ExpenseEntry }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  const init = () => ({
    amount: correcting ? centsToInput(correcting.amount_cents) : '',
    category: correcting?.category ?? '',
    method: correcting?.method ?? '',
    occurred_at: toLocalInputValue(correcting ? new Date(correcting.occurred_at) : new Date(), timezone),
    description: correcting?.description ?? '',
    reason: '',
  });
  const [d, setD] = useState(init);
  const [receipt, setReceipt] = useState<File | null>(null);
  const key = useRef(crypto.randomUUID());
  const set = (k: keyof ReturnType<typeof init>) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setD((x) => ({ ...x, [k]: e.target.value }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFe({});
    const fd = new FormData();
    Object.entries(d).forEach(([k, v]) => fd.set(k, v));
    fd.set('idempotency_key', key.current);
    if (correcting) fd.set('replaces_id', correcting.id);
    if (receipt) fd.set('receipt', receipt);
    start(async () => {
      const r = await saveExpense(fd).catch(() => null);
      if (!r) return setError('No pudimos guardar los cambios. Tus datos siguen en el formulario.');
      if (!r.ok) {
        setError(r.error);
        setFe(r.fieldErrors ?? {});
        return;
      }
      key.current = crypto.randomUUID();
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setD(init());
          setError(null);
          setFe({});
        }
      }}
      title={correcting ? 'Corregir gasto' : 'Registrar gasto'}
      description={correcting ? 'El gasto original queda anulado y visible; se registra uno nuevo con los datos corregidos.' : 'Gastos operativos del negocio. El costo de la mercadería no se descuenta automáticamente.'}
      trigger={
        correcting ? (
          <Button variant="ghost" className="min-h-10 px-2 text-sm">Corregir</Button>
        ) : (
          <Button>
            <Plus aria-hidden className="size-5" /> Registrar gasto
          </Button>
        )
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
        <div className="grid grid-cols-2 gap-3">
          <Field id="e-amount" label="Monto (Bs)" error={fe.amount}>
            <Input id="e-amount" inputMode="decimal" value={d.amount} onChange={set('amount')} aria-invalid={fe.amount ? true : undefined} />
          </Field>
          <Field id="e-cat" label="Categoría" error={fe.category}>
            <Select id="e-cat" value={d.category} onChange={set('category')}>
              <option value="">Elegí…</option>
              {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{EXPENSE_CATEGORY_LABEL[c]}</option>)}
            </Select>
          </Field>
          <Field id="e-method" label="Pagado con" error={fe.method}>
            <Select id="e-method" value={d.method} onChange={set('method')}>
              <option value="">Elegí…</option>
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</option>)}
            </Select>
          </Field>
          <Field id="e-when" label="Fecha y hora" error={fe.occurred_at}>
            <Input id="e-when" type="datetime-local" value={d.occurred_at} onChange={set('occurred_at')} />
          </Field>
        </div>
        <Field id="e-desc" label="Descripción" optional>
          <Input id="e-desc" value={d.description} onChange={set('description')} maxLength={300} />
        </Field>
        {correcting ? (
          <Field id="e-reason" label="Motivo de la corrección" error={fe.reason}>
            <Input id="e-reason" value={d.reason} onChange={set('reason')} maxLength={500} />
          </Field>
        ) : (
          <ImagePicker label="Comprobante" onChange={(f) => setReceipt(f)} />
        )}
        {fe.receipt ? <p className="text-sm font-medium text-danger">{fe.receipt}</p> : null}
        <SubmitButton pending={pending}>{correcting ? 'Guardar corrección' : 'Registrar gasto'}</SubmitButton>
      </form>
    </Dialog>
  );
}

export function VoidExpenseDialog({ id, amountCents }: { id: string; amountCents: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="Anular gasto"
      description={`El registro de ${formatMoney(amountCents)} queda visible como anulado y deja de sumar en los totales.`}
      trigger={<Button variant="ghost" className="min-h-10 px-2 text-sm">Anular</Button>}
    >
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          start(async () => {
            const r = await voidExpense(id, reason).catch(() => null);
            if (!r || !r.ok) return setError(r?.error ?? 'No pudimos guardar los cambios.');
            setOpen(false);
            router.refresh();
          });
        }}
      >
        {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
        <Field id={`ve-${id}`} label="Motivo">
          <Input id={`ve-${id}`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </Field>
        <SubmitButton pending={pending} variant="danger">Anular gasto</SubmitButton>
      </form>
    </Dialog>
  );
}
