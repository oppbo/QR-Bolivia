'use client';

import { WifiOff } from 'lucide-react';
import { useSyncExternalStore } from 'react';

function subscribe(cb: () => void) {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}

/** true si el navegador reporta conexión. En el servidor se asume en línea. */
export function useOnline() {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}

export function ConnectionBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div role="status" className="sticky top-0 z-30 flex items-center gap-2 bg-warning-soft px-4 py-2 text-warning">
      <WifiOff aria-hidden className="size-5 shrink-0" />
      <p className="text-sm font-medium">
        Sin conexión. Podés seguir viendo esta pantalla, pero guardar requiere conexión. Lo que escribiste se mantiene mientras no cierres la página.
      </p>
    </div>
  );
}
