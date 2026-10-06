'use client';

import { Alert, Button } from '@/components/ui/primitives';

export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <Alert tone="danger" role="alert" title="No pudimos cargar esta pantalla">
        Revisá tu conexión e intentá de nuevo. Si tu sesión venció, volvé a iniciar sesión.
      </Alert>
      <div>
        <Button onClick={() => reset()}>Reintentar</Button>
      </div>
    </div>
  );
}
