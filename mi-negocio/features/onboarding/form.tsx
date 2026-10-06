'use client';

import { useActionState } from 'react';
import { Alert, describedBy, Field, Input } from '@/components/ui/primitives';
import { SubmitButton } from '@/components/ui/submit-button';
import { initialFormState } from '@/lib/validation/forms';
import { createBusiness } from './actions';

export function OnboardingForm({ defaultName }: { defaultName?: string }) {
  const [state, action, pending] = useActionState(createBusiness, initialFormState);
  const fe = state.fieldErrors ?? {};
  const v = state.values ?? {};
  const field = (id: string, label: string, opts: { hint?: string; optional?: boolean; autoComplete?: string; inputMode?: 'tel'; placeholder?: string; defaultValue?: string } = {}) => (
    <Field id={id} label={label} hint={opts.hint} error={fe[id]} optional={opts.optional}>
      <Input
        id={id}
        name={id}
        autoComplete={opts.autoComplete}
        inputMode={opts.inputMode}
        placeholder={opts.placeholder}
        defaultValue={v[id] ?? opts.defaultValue}
        required={!opts.optional}
        aria-invalid={fe[id] ? true : undefined}
        aria-describedby={describedBy(id, { hint: opts.hint, error: fe[id] })}
      />
    </Field>
  );
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {state.error ? <Alert tone="danger" role="alert">{state.error}</Alert> : null}
      {field('business_name', 'Nombre del negocio', { autoComplete: 'organization', placeholder: 'Ej.: Luna Boutique' })}
      {field('display_name', '¿Cómo te llamamos?', { autoComplete: 'given-name', defaultValue: defaultName })}
      {field('whatsapp', 'WhatsApp del negocio', { inputMode: 'tel', autoComplete: 'tel', hint: 'Si es de Bolivia, alcanza con el número (ej.: 71234567).' })}
      {field('pickup_address', 'Dirección o referencia para retiros', { optional: true, hint: 'Se muestra a tus clientes cuando retiran en tienda.' })}
      <SubmitButton pending={pending} pendingText="Creando…">Crear mi negocio</SubmitButton>
    </form>
  );
}
