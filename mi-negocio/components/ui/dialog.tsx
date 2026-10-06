'use client';

import { X } from 'lucide-react';
import { Dialog as D } from 'radix-ui';
import type { ReactNode } from 'react';

/** Diálogo accesible (foco atrapado, Escape, título y descripción anunciados). */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  trigger,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  trigger?: ReactNode;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <D.Trigger asChild>{trigger}</D.Trigger> : null}
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-ink/40" />
        <D.Content
          className="fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] overflow-y-auto rounded-t-[var(--radius-card)] bg-surface p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-xl sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[var(--radius-card)]"
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <D.Title className="text-lg font-semibold">{title}</D.Title>
              {description ? <D.Description className="mt-1 text-muted">{description}</D.Description> : null}
            </div>
            <D.Close className="-mr-2 -mt-1 inline-flex size-11 items-center justify-center rounded-full text-muted hover:bg-page" aria-label="Cerrar">
              <X aria-hidden className="size-5" />
            </D.Close>
          </div>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
