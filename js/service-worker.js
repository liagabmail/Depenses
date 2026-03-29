self.addEventListener('message', event => {
  // Version: 2026-03-28 - force update
});
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", () => {
  clients.claim();
});
