import { BottomNav, MobileTopBar, Sidebar } from '@/components/shell/nav';
import { ConnectionBanner } from '@/components/ui/connection';
import { requireBusiness } from '@/lib/auth/session';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { business } = await requireBusiness();
  return (
    <div className="flex min-h-dvh">
      <Sidebar businessName={business.name} />
      <div className="flex min-w-0 flex-1 flex-col">
        <ConnectionBanner />
        <MobileTopBar businessName={business.name} />
        <main id="contenido" className="mx-auto w-full max-w-5xl flex-1 px-4 pt-5 pb-28 sm:px-6 lg:pb-10">
          {children}
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
