// Service worker : satisfait la condition d'installation ("installability") de Chrome sur
// Android (install/activate/fetch), et affiche les notifications push reçues.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {}); // laisse passer toutes les requêtes normalement

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch(e) { data = { title:'Dépenses', body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'Dépenses';
  /* Sans icône, Chrome fabrique une pastille grise avec l'initiale du domaine. On retombe
     donc sur les icônes de l'app. Le badge (silhouette de la barre d'état) doit être un PNG
     monochrome à fond transparent : Android n'en garde que le canal alpha, et l'icône
     couleur y deviendrait un carré plein. Les chemins relatifs sont résolus par rapport à
     sw.js, qui est à la racine. */
  const options = {
    body: data.body || '',
    icon: data.icon || './icon-192.png',
    badge: data.badge || './badge-96.png',
    data: { url: data.url || './' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(clients.openWindow(url));
});
