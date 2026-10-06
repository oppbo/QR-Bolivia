import clsx from 'clsx';
import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

export const cx = clsx;

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const variantClass: Record<Variant, string> = {
  primary: 'bg-primary text-white hover:bg-primary-hover disabled:bg-primary/60',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-page disabled:text-muted',
  danger: 'bg-danger text-white hover:bg-danger-hover disabled:bg-danger/60',
  ghost: 'text-primary hover:bg-primary-soft disabled:text-muted',
};

export function buttonClass(variant: Variant = 'primary', extra?: string) {
  return cx(
    'inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-field)] px-4 py-2 text-base font-semibold transition-colors disabled:cursor-not-allowed',
    variantClass[variant],
    extra,
  );
}

export function Button({ variant = 'primary', className, ...props }: ComponentProps<'button'> & { variant?: Variant }) {
  return <button type="button" className={buttonClass(variant, className)} {...props} />;
}

export function ButtonLink({ variant = 'primary', className, ...props }: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={buttonClass(variant, className)} {...props} />;
}

export function Card({ className, ...props }: ComponentProps<'section'>) {
  return <section className={cx('rounded-[var(--radius-card)] border border-line bg-surface p-4 sm:p-5', className)} {...props} />;
}

export function PageHeader({ title, description, actions, back }: { title: string; description?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back}
        <h1 className="text-2xl font-bold tracking-tight break-words">{title}</h1>
        {description ? <p className="mt-1 text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

const inputBase =
  'block w-full min-h-11 rounded-[var(--radius-field)] border border-line-strong bg-surface px-3 py-2 text-base text-ink placeholder:text-muted/80 aria-[invalid=true]:border-danger';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cx(inputBase, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cx(inputBase, 'min-h-20', className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cx(inputBase, 'pr-8', className)} {...props} />;
}

/** Campo con etiqueta, ayuda y error accesible (aria-describedby). */
export function Field({
  id,
  label,
  hint,
  error,
  optional,
  children,
  className,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string | null;
  optional?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="font-medium">
        {label}
        {optional ? <span className="font-normal text-muted"> (opcional)</span> : null}
      </label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function describedBy(id: string, opts: { hint?: unknown; error?: unknown }) {
  return [opts.hint ? `${id}-hint` : null, opts.error ? `${id}-error` : null].filter(Boolean).join(' ') || undefined;
}

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'primary';
const toneClass: Record<Tone, string> = {
  neutral: 'bg-page text-ink border-line-strong',
  success: 'bg-success-soft text-primary-hover border-primary/30',
  warning: 'bg-warning-soft text-warning border-warning/30',
  danger: 'bg-danger-soft text-danger border-danger/30',
  info: 'bg-info-soft text-info border-info/30',
  primary: 'bg-primary-soft text-primary border-primary/30',
};

export function Badge({ tone = 'neutral', icon, children }: { tone?: Tone; icon?: ReactNode; children: ReactNode }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-sm font-medium whitespace-nowrap', toneClass[tone])}>
      {icon}
      {children}
    </span>
  );
}

export function Alert({ tone = 'info', title, children, role }: { tone?: Tone; title?: string; children?: ReactNode; role?: 'alert' | 'status' }) {
  return (
    <div role={role} className={cx('rounded-[var(--radius-field)] border px-4 py-3', toneClass[tone])}>
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={cx(title && 'mt-1', 'text-[0.95rem]')}>{children}</div> : null}
    </div>
  );
}

export function EmptyState({ title, description, actions, icon }: { title: string; description?: ReactNode; actions?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface px-6 py-10 text-center">
      {icon ? <div className="mb-3 text-primary">{icon}</div> : null}
      <h2 className="text-lg font-semibold">{title}</h2>
      {description ? <p className="mt-1 max-w-md text-muted">{description}</p> : null}
      {actions ? <div className="mt-5 flex flex-wrap justify-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Stat({ label, value, help, tone }: { label: string; value: ReactNode; help?: ReactNode; tone?: 'warning' }) {
  return (
    <div className={cx('rounded-[var(--radius-card)] border bg-surface p-4', tone === 'warning' ? 'border-warning/40' : 'border-line')}>
      <p className="text-sm font-medium text-muted">{label}</p>
      <p className="tabular mt-1 text-2xl font-bold">{value}</p>
      {help ? <p className="mt-1 text-sm text-muted">{help}</p> : null}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-lg font-semibold">{children}</h2>
      {action}
    </div>
  );
}
