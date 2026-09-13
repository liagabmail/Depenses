/* Service worker minimal : uniquement responsable d'afficher les notifications push reçues
   et d'ouvrir l'app quand on clique dessus. Aucune mise en cache, aucun mode hors-ligne :
   ce n'est pas l'objectif ici. */

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
