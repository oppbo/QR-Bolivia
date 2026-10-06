'use client';

import { Home, Package, Plus, ReceiptText, Settings, Store, Users, Wallet } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cx } from '@/components/ui/primitives';

const ITEMS = [
  { href: '/app', label: 'Inicio', icon: Home, exact: true },
  { href: '/app/orders', label: 'Pedidos', icon: ReceiptText },
  { href: '/app/products', label: 'Productos', icon: Package },
  { href: '/app/customers', label: 'Clientes', icon: Users },
  { href: '/app/cash', label: 'Caja', icon: Wallet },
];

function isActive(pathname: string, href: string, exact?: boolean) {
  return exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Principal" className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface lg:hidden">
      <ul className="mx-auto grid max-w-xl grid-cols-5">
        {ITEMS.map(({ href, label, icon: Icon, exact }) => {
          const active = isActive(pathname, href, exact);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium',
                  active ? 'text-primary' : 'text-muted',
                )}
              >
                <Icon aria-hidden className={cx('size-6', active && 'stroke-[2.5]')} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function Sidebar({ businessName }: { businessName: string }) {
  const pathname = usePathname();
  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-line bg-surface p-4 lg:flex">
      <div className="mb-6 flex items-center gap-2 px-2 text-primary">
        <Store aria-hidden className="size-6 shrink-0" />
        <span className="truncate text-lg font-bold" title={businessName}>
          {businessName}
        </span>
      </div>
      <Link
        href="/app/orders/new"
        className="mb-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-field)] bg-primary px-4 font-semibold text-white hover:bg-primary-hover"
      >
        <Plus aria-hidden className="size-5" /> Nuevo pedido
      </Link>
      <nav aria-label="Principal">
        <ul className="flex flex-col gap-1">
          {ITEMS.map(({ href, label, icon: Icon, exact }) => {
            const active = isActive(pathname, href, exact);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={cx(
                    'flex min-h-11 items-center gap-3 rounded-[var(--radius-field)] px-3 font-medium',
                    active ? 'bg-primary-soft text-primary' : 'text-ink hover:bg-page',
                  )}
                >
                  <Icon aria-hidden className="size-5" />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="mt-auto">
        <Link
          href="/app/settings"
          aria-current={isActive(pathname, '/app/settings') ? 'page' : undefined}
          className={cx(
            'flex min-h-11 items-center gap-3 rounded-[var(--radius-field)] px-3 font-medium',
            isActive(pathname, '/app/settings') ? 'bg-primary-soft text-primary' : 'text-ink hover:bg-page',
          )}
        >
          <Settings aria-hidden className="size-5" /> Ajustes
        </Link>
      </div>
    </aside>
  );
}

export function MobileTopBar({ businessName }: { businessName: string }) {
  const pathname = usePathname();
  const onNewOrder = pathname === '/app/orders/new';
  return (
    <header className="sticky top-0 z-20 flex min-h-14 items-center gap-2 border-b border-line bg-surface/95 px-4 backdrop-blur lg:hidden">
      <span className="min-w-0 flex-1 truncate font-bold text-primary">{businessName}</span>
      {!onNewOrder ? (
        <Link
          href="/app/orders/new"
          className="inline-flex min-h-11 items-center gap-1 rounded-[var(--radius-field)] bg-primary px-3 text-sm font-semibold text-white"
        >
          <Plus aria-hidden className="size-4" /> Nuevo pedido
        </Link>
      ) : null}
      <Link
        href="/app/settings"
        className="inline-flex size-11 items-center justify-center rounded-full text-muted hover:bg-page"
        aria-label="Ajustes y cuenta"
      >
        <Settings aria-hidden className="size-6" />
      </Link>
    </header>
  );
}
