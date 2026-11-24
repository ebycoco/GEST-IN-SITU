// Service worker GEST-IN-SITU mobile (ecrit a la main, decision Q7).
// Met en cache UNIQUEMENT la coquille statique de l'application (HTML, JS/CSS de /assets/,
// manifeste, icones) servie par la MEME origine.
// JAMAIS : les reponses Supabase (autre origine, non interceptees), les requetes non GET,
// les requetes portant un en-tete Authorization ; aucun backgroundSync, aucune file
// d'attente : une ecriture exige Internet (decision utilisateur).
// Changer VERSION a chaque modification de ce fichier pour purger l'ancien cache.
const VERSION = 'gis-mobile-v3';
const COQUILLE = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-512-maskable.png',
  '/icons/apple-touch-icon-180.png',
  '/icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((c) => c.addAll(COQUILLE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cles) => Promise.all(cles.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase et tout tiers : reseau direct
  if (req.headers.has('Authorization')) return;

  // Navigation : reseau d'abord (version a jour), coquille en secours hors ligne.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/index.html').then((r) => r || Response.error())));
    return;
  }

  // Fichiers de build a nom unique (/assets/...-<empreinte>.js|css) : cache d'abord.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok && res.type === 'basic') {
              const copie = res.clone();
              caches.open(VERSION).then((c) => c.put(req, copie));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Manifeste et icones : cache d'abord ; tout le reste : reseau direct.
  if (COQUILLE.includes(url.pathname)) {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
  }
});
