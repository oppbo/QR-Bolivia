import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Mi Negocio',
    short_name: 'Mi Negocio',
    description: 'Sabé qué vendiste, quién te debe y qué tenés que entregar hoy.',
    lang: 'es-BO',
    start_url: '/app',
    scope: '/',
    display: 'standalone',
    background_color: '#f6f7f3',
    theme_color: '#166534',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
