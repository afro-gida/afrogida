/* Afrogida Service Worker — Web Push Alıcısı */
self.addEventListener('push', function (event) {
  if (!event.data) return;
  var d;
  try { d = event.data.json(); } catch (e) { d = { title: 'Afro Gıda', body: event.data.text() }; }
  var title   = d.title  || 'Afro Gıda';
  var options = {
    body:    d.body    || '',
    icon:    d.icon    || '/afro-logo.png',
    badge:   d.badge   || '/afro-logo.png',
    data:    d.data    || {},
    vibrate: [200, 100, 200],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (cs) {
    for (var i = 0; i < cs.length; i++) {
      if (cs[i].url.includes(self.location.origin)) { cs[i].focus(); return; }
    }
    return clients.openWindow(url);
  }));
});

self.addEventListener('install',  function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(clients.claim()); });
