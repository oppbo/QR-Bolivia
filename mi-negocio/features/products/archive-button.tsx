'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Alert, Button } from '@/components/ui/primitives';
import { setProductArchived } from './actions';

export function ProductArchiveButton({ productId, archived }: { productId: string; archived: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() => {
          if (!archived && !window.confirm('¿Archivar este producto? Deja de aparecer al crear pedidos; los pedidos anteriores no cambian.')) return;
          start(async () => {
            const r = await setProductArchived(productId, !archived).catch(() => null);
            if (!r || !r.ok) setError(r?.error ?? 'No pudimos guardar los cambios.');
            else router.refresh();
          });
        }}
      >
        {archived ? 'Reactivar producto' : 'Archivar'}
      </Button>
      {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
    </div>
  );
}
