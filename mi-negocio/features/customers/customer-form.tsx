'use client';

import { useState, useTransition } from 'react';
import { Alert, Button, describedBy, Field, Input, Textarea } from '@/components/ui/primitives';
import { SubmitButton } from '@/components/ui/submit-button';
import { saveCustomer, type SaveCustomerResult } from './actions';

export interface CustomerDraft {
  id?: string;
  revision?: number;
  name: string;
  phone: string;
  address: string;
  delivery_reference: string;
  notes: string;
}

export const emptyCustomer: CustomerDraft = { name: '', phone: '', address: '', delivery_reference: '', notes: '' };

type Saved = Extract<SaveCustomerResult, { ok: true }>['data'];

export function CustomerForm({ initial, onSaved, onCancel }: { initial: CustomerDraft; onSaved: (c: Saved) => void; onCancel?: () => void }) {
  const [d, setD] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [duplicates, setDuplicates] = useState<{ id: string; name: string }[] | null>(null);
  const [pending, start] = useTransition();

  function save(allowDuplicate: boolean) {
    setError(null);
    setFieldErrors({});
    start(async () => {
      const r = await saveCustomer({
        id: d.id,
        expected_revision: d.revision,
        name: d.name,
        phone: d.phone,
        address: d.address,
        delivery_reference: d.delivery_reference,
        notes: d.notes,
        allow_duplicate_phone: allowDuplicate,
      }).catch(() => null);
      if (!r) return setError('No pudimos guardar los cambios. Tus datos siguen en el formulario.');
      if (!r.ok) {
        if ('duplicates' in r) setDuplicates(r.duplicates);
        else {
          setError(r.error);
          setFieldErrors(r.fieldErrors ?? {});
        }
        return;
      }
      setDuplicates(null);
      onSaved(r.data);
    });
  }

  const set = (k: keyof CustomerDraft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setD((x) => ({ ...x, [k]: e.target.value }));
    if (k === 'phone') setDuplicates(null);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        save(false);
      }}
      className="flex flex-col gap-4"
      noValidate
    >
      {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
      <Field id="c-name" label="Nombre" error={fieldErrors.name}>
        <Input id="c-name" value={d.name} onChange={set('name')} maxLength={120} autoComplete="off" aria-invalid={fieldErrors.name ? true : undefined} aria-describedby={describedBy('c-name', { error: fieldErrors.name })} />
      </Field>
      <Field id="c-phone" label="Teléfono / WhatsApp" optional hint="Si es de Bolivia, alcanza con el número." error={fieldErrors.phone}>
        <Input id="c-phone" value={d.phone} onChange={set('phone')} inputMode="tel" autoComplete="off" aria-invalid={fieldErrors.phone ? true : undefined} aria-describedby={describedBy('c-phone', { hint: true, error: fieldErrors.phone })} />
      </Field>
      {duplicates ? (
        <Alert tone="warning" role="alert" title="Este teléfono ya está registrado">
          <p>
            Lo usa: {duplicates.map((x) => x.name).join(', ')}. Puede ser la misma persona o alguien de su familia. No se fusionan registros
            automáticamente.
          </p>
          <div className="mt-2">
            <Button variant="secondary" onClick={() => save(true)} disabled={pending}>
              Guardar igualmente
            </Button>
          </div>
        </Alert>
      ) : null}
      <Field id="c-address" label="Dirección" optional error={fieldErrors.address}>
        <Input id="c-address" value={d.address} onChange={set('address')} maxLength={300} />
      </Field>
      <Field id="c-ref" label="Referencia de entrega" optional error={fieldErrors.delivery_reference}>
        <Input id="c-ref" value={d.delivery_reference} onChange={set('delivery_reference')} maxLength={300} placeholder="Ej.: portón verde, frente a la plaza" />
      </Field>
      <Field id="c-notes" label="Notas privadas" optional hint="Solo para vos. Nunca se incluyen en mensajes de WhatsApp." error={fieldErrors.notes}>
        <Textarea id="c-notes" value={d.notes} onChange={set('notes')} maxLength={2000} rows={3} aria-describedby={describedBy('c-notes', { hint: true })} />
      </Field>
      <div className="flex gap-2">
        {onCancel ? (
          <Button variant="secondary" className="flex-1" onClick={onCancel}>
            Cancelar
          </Button>
        ) : null}
        <SubmitButton pending={pending} className="flex-1">
          {d.id ? 'Guardar cambios' : 'Guardar cliente'}
        </SubmitButton>
      </div>
    </form>
  );
}
