import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Registro del service worker (solo en producción: en desarrollo Vite sirve
// archivos que cambian constantemente y una caché estorbaría).
// Cuando hay una versión nueva en espera se avisa a la app con un evento; la
// persona decide cuándo actualizar (no recargamos en medio de una lectura).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  const habiaControlador = Boolean(navigator.serviceWorker.controller);
  let recargando = false;

  const avisarActualizacion = (worker) => {
    window.__alertaQrSwEnEspera = worker;
    window.dispatchEvent(new CustomEvent('alerta-qr:actualizacion'));
  };

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js', { scope: './' })
      .then((registro) => {
        if (registro.waiting && navigator.serviceWorker.controller) {
          avisarActualizacion(registro.waiting);
        }
        registro.addEventListener('updatefound', () => {
          const nuevo = registro.installing;
          if (!nuevo) return;
          nuevo.addEventListener('statechange', () => {
            if (nuevo.state === 'installed' && navigator.serviceWorker.controller) {
              avisarActualizacion(nuevo);
            }
          });
        });
      })
      .catch(() => {
        // Sin service worker la app sigue funcionando en línea.
      });
  });

  // Tras pulsar "Actualizar" (o si otra pestaña activó la versión nueva), el
  // worker nuevo toma el control y recargamos una sola vez. En la primera
  // instalación (clients.claim sin versión anterior) no recargamos.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (recargando) return;
    if (!habiaControlador && !window.__alertaQrActualizacionPedida) return;
    recargando = true;
    window.location.reload();
  });
}
