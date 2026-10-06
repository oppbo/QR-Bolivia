'use client';

import { Loader2 } from 'lucide-react';
import type { ComponentProps } from 'react';
import { useOnline } from './connection';
import { buttonClass } from './primitives';

/** Botón de envío: se deshabilita mientras procesa y cuando no hay conexión. */
export function SubmitButton({
  pending,
  pendingText = 'Guardando…',
  variant = 'primary',
  className,
  children,
  disabled,
  ...props
}: ComponentProps<'button'> & { pending: boolean; pendingText?: string; variant?: 'primary' | 'secondary' | 'danger' }) {
  const online = useOnline();
  return (
    <button
      type="submit"
      className={buttonClass(variant, className)}
      disabled={pending || !online || disabled}
      aria-disabled={pending || !online || disabled}
      {...props}
    >
      {pending ? (
        <>
          <Loader2 aria-hidden className="size-4 animate-spin" />
          {pendingText}
        </>
      ) : (
        children
      )}
    </button>
  );
}
