'use client';

import { Pencil, UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Alert, Button } from '@/components/ui/primitives';
import { setCustomerArchived } from './actions';
import { CustomerForm, emptyCustomer, type CustomerDraft } from './customer-form';

export function NewCustomerButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="Nuevo cliente"
      trigger={
        <Button>
          <UserPlus aria-hidden className="size-5" /> Nuevo cliente
        </Button>
      }
    >
      <CustomerForm
        initial={emptyCustomer}
        onCancel={() => setOpen(false)}
        onSaved={(c) => {
          setOpen(false);
          router.push(`/app/customers/${c.id}`);
        }}
      />
    </Dialog>
  );
}

export function EditCustomerButton({ initial }: { initial: CustomerDraft }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="Editar cliente"
      trigger={
        <Button variant="secondary">
          <Pencil aria-hidden className="size-4" /> Editar
        </Button>
      }
    >
      <CustomerForm
        initial={initial}
        onCancel={() => setOpen(false)}
        onSaved={() => {
          setOpen(false);
          router.refresh();
        }}
      />
    </Dialog>
  );
}

export function CustomerArchiveButton({ customerId, archived }: { customerId: string; archived: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() => {
          if (!archived && !window.confirm('¿Archivar este cliente? Su historial de pedidos y pagos se conserva.')) return;
          start(async () => {
            const r = await setCustomerArchived(customerId, !archived).catch(() => null);
            if (!r || !r.ok) setError(r?.error ?? 'No pudimos guardar los cambios.');
            else router.refresh();
          });
        }}
      >
        {archived ? 'Reactivar' : 'Archivar'}
      </Button>
      {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
    </>
  );
}
