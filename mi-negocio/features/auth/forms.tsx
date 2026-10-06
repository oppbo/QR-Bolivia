'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Alert, describedBy, Field, Input } from '@/components/ui/primitives';
import { SubmitButton } from '@/components/ui/submit-button';
import { initialFormState } from '@/lib/validation/forms';
import { requestPasswordReset, resetPassword, signIn, signUp } from './actions';

function TextField(props: {
  id: string;
  label: string;
  type?: string;
  autoComplete?: string;
  defaultValue?: string;
  error?: string;
  hint?: string;
}) {
  const { id, label, type = 'text', autoComplete, defaultValue, error, hint } = props;
  return (
    <Field id={id} label={label} error={error} hint={hint}>
      <Input
        id={id}
        name={id}
        type={type}
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        required
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, { error, hint })}
      />
    </Field>
  );
}

export function LoginForm({ next, notice }: { next: string; notice?: string }) {
  const [state, action, pending] = useActionState(signIn, initialFormState);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <h1 className="text-xl font-bold">Iniciar sesión</h1>
      {notice ? <Alert tone="info" role="status">{notice}</Alert> : null}
      {state.error ? <Alert tone="danger" role="alert">{state.error}</Alert> : null}
      <input type="hidden" name="next" value={next} />
      <TextField id="email" label="Correo electrónico" type="email" autoComplete="email" defaultValue={state.values?.email} error={state.fieldErrors?.email} />
      <TextField id="password" label="Contraseña" type="password" autoComplete="current-password" error={state.fieldErrors?.password} />
      <SubmitButton pending={pending} pendingText="Ingresando…">Ingresar</SubmitButton>
      <div className="flex flex-col gap-2 text-center">
        <Link href="/forgot-password" className="py-2 text-primary underline">¿Olvidaste tu contraseña?</Link>
        <p className="text-muted">
          ¿No tenés cuenta? <Link href="/signup" className="text-primary underline">Crear cuenta</Link>
        </p>
      </div>
    </form>
  );
}

export function SignupForm() {
  const [state, action, pending] = useActionState(signUp, initialFormState);
  if (state.ok) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-bold">Revisá tu correo</h1>
        <Alert tone="info" role="status">{state.message}</Alert>
        <Link href="/login" className="text-primary underline">Ir a iniciar sesión</Link>
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <h1 className="text-xl font-bold">Crear cuenta</h1>
      {state.error ? <Alert tone="danger" role="alert">{state.error}</Alert> : null}
      <TextField id="email" label="Correo electrónico" type="email" autoComplete="email" defaultValue={state.values?.email} error={state.fieldErrors?.email} />
      <TextField id="password" label="Contraseña" type="password" autoComplete="new-password" hint="Mínimo 8 caracteres." error={state.fieldErrors?.password} />
      <TextField id="confirm" label="Repetí la contraseña" type="password" autoComplete="new-password" error={state.fieldErrors?.confirm} />
      <SubmitButton pending={pending} pendingText="Creando cuenta…">Crear cuenta</SubmitButton>
      <p className="text-center text-muted">
        ¿Ya tenés cuenta? <Link href="/login" className="text-primary underline">Iniciar sesión</Link>
      </p>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, initialFormState);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <h1 className="text-xl font-bold">Recuperar contraseña</h1>
      <p className="text-muted">Te enviaremos un enlace para crear una nueva contraseña.</p>
      {state.ok ? <Alert tone="info" role="status">{state.message}</Alert> : null}
      <TextField id="email" label="Correo electrónico" type="email" autoComplete="email" defaultValue={state.values?.email} error={state.fieldErrors?.email} />
      <SubmitButton pending={pending} pendingText="Enviando…">Enviar enlace</SubmitButton>
      <Link href="/login" className="py-2 text-center text-primary underline">Volver a iniciar sesión</Link>
    </form>
  );
}

export function ResetPasswordForm() {
  const [state, action, pending] = useActionState(resetPassword, initialFormState);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <h1 className="text-xl font-bold">Nueva contraseña</h1>
      {state.error ? (
        <Alert tone="danger" role="alert">
          {state.error} <Link href="/forgot-password" className="underline">Pedir otro enlace</Link>
        </Alert>
      ) : null}
      <TextField id="password" label="Nueva contraseña" type="password" autoComplete="new-password" hint="Mínimo 8 caracteres." error={state.fieldErrors?.password} />
      <TextField id="confirm" label="Repetí la contraseña" type="password" autoComplete="new-password" error={state.fieldErrors?.confirm} />
      <SubmitButton pending={pending}>Guardar contraseña</SubmitButton>
    </form>
  );
}
