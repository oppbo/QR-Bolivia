'use client';

import { useEffect } from 'react';

/** Advierte antes de cerrar o recargar la página si hay cambios sin guardar. */
export function useUnsavedChangesWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
}

/** Confirmación para enlaces internos ("Cancelar", "Volver") cuando hay cambios. */
export function confirmDiscard(dirty: boolean) {
  return !dirty || window.confirm('Tenés cambios sin guardar. ¿Salir sin guardar?');
}
