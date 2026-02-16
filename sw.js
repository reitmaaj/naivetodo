self.addEventListener('install', (event) => {
  // No-op
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Claim clients immediately
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Pass through
  event.respondWith(fetch(event.request));
});
