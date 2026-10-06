import type { Metadata, Viewport } from 'next';
import { ServiceWorkerRegistration } from '@/components/sw-register';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Mi Negocio', template: '%s · Mi Negocio' },
  description: 'Sabé qué vendiste, quién te debe y qué tenés que entregar hoy.',
  applicationName: 'Mi Negocio',
  appleWebApp: { capable: true, title: 'Mi Negocio', statusBarStyle: 'default' },
  icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' },
};

export const viewport: Viewport = {
  themeColor: '#166534',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-BO">
      <body className="min-h-dvh antialiased">
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
