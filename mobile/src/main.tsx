import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const racine = document.getElementById('root');
if (racine) {
  createRoot(racine).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

// Service worker (public/sw.js, ecrit a la main) : coquille statique seulement, en
// production uniquement (en developpement, il masquerait les changements de Vite).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // Sans service worker, l'appli fonctionne (simplement pas installable hors ligne).
    });
  });
}
