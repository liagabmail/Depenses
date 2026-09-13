// Service worker : satisfait la condition d'installation ("installability") de Chrome sur
// Android (install/activate/fetch), et affiche les notifications push reçues.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {}); // laisse passer toutes les requêtes normalement

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch(e) { data = { title:'Dépenses', body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'Dépenses';
  const options = {
    body: data.body || '',
    icon: data.icon || undefined,
    badge: data.badge || undefined,
    data: { url: data.url || './' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(clients.openWindow(url));
});
