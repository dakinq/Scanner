const CACHE = 'stock-scanner-v1';

self.addEventListener('install', e => {
  self.skipWaiting(); // Sofort aktivieren, kein Caching das blockieren könnte
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

// URLs die der Service Worker NIEMALS anfassen darf
const BYPASS_URLS = [
  'accounts.google.com',
  'googleapis.com',
  'gstatic.com',
  'firebaseapp.com',
  'firebase.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
];

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Google Auth & Firebase: immer direkt ans Netz, nie cachen/intercepten
  if (BYPASS_URLS.some(domain => url.includes(domain))) {
    e.respondWith(fetch(e.request));
    return;
  }

  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});

// ── Push Notifications (Preisalarme) ─────────────────────────────────────────
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) { data = { title: 'Stock Scanner', body: e.data ? e.data.text() : '' }; }

  const title = data.title || 'Preisalarm ausgelöst';
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: data.url || '/' },
    tag: data.tag || undefined,
  };

  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientsArr => {
      const existing = clientsArr.find(c => c.url.includes(self.registration.scope));
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    })
  );
});
