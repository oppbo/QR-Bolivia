'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Alert, Button, describedBy, Field, Input } from '@/components/ui/primitives';
import { SubmitButton } from '@/components/ui/submit-button';
import { adjustStock } from './actions';

export function StockAdjustButton({ variantId, label, onHand, reserved }: { variantId: string; label: string; onHand: number; reserved: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [pending, start] = useTransition();
  const n = Number(delta);
  const preview = /^-?\d+$/.test(delta.trim()) ? onHand + n : null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    start(async () => {
      const r = await adjustStock({ variant_id: variantId, delta: delta.trim(), reason, operation_key: key }).catch(() => null);
      if (!r) return setError('No pudimos guardar el ajuste. Tus datos siguen en el formulario.');
      if (!r.ok) {
        setError(r.error);
        setFieldErrors(r.fieldErrors ?? {});
        return;
      }
      setOpen(false);
      setDelta('');
      setReason('');
      setKey(crypto.randomUUID());
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="Ajustar stock"
      description={label}
      trigger={<Button variant="secondary">Ajustar stock</Button>}
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
        <p className="text-muted">
          En existencia: <strong className="text-ink">{onHand}</strong> · Reservado: <strong className="text-ink">{reserved}</strong>
        </p>
        <Field id="delta" label="Cantidad a sumar o restar" hint="Ej.: 5 si llegó mercadería, -1 si se dañó una unidad." error={fieldErrors.delta}>
          <Input
            id="delta"
            inputMode="numeric"
            value={delta}
            onChange={(e) => setDelta(e.target.value)}
            aria-describedby={describedBy('delta', { hint: true, error: fieldErrors.delta })}
            aria-invalid={fieldErrors.delta ? true : undefined}
          />
        </Field>
        {preview != null ? (
          <p className={preview < reserved ? 'font-medium text-danger' : 'text-muted'} aria-live="polite">
            Quedaría en existencia: {preview}
            {preview < reserved ? ` (menos que las ${reserved} reservadas; no se permite)` : ''}
          </p>
        ) : null}
        <Field id="reason" label="Motivo" error={fieldErrors.reason}>
          <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Conteo, mercadería nueva, daño…" />
        </Field>
        <SubmitButton pending={pending}>Guardar ajuste</SubmitButton>
      </form>
    </Dialog>
  );
}
