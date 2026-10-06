import { ButtonLink } from '@/components/ui/primitives';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-bold">No encontramos esta página</h1>
      <p className="text-muted">Puede que el enlace esté mal o que el registro no pertenezca a tu negocio.</p>
      <ButtonLink href="/app">Ir al inicio</ButtonLink>
    </main>
  );
}
