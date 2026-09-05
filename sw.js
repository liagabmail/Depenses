// Service worker minimal : ne fait pas de mise en cache, il sert uniquement
// à satisfaire la condition d'installation ("installability") de Chrome sur Android.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {}); // laisse passer toutes les requêtes normalement
