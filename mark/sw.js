// Service worker di Mark: serve solo per le notifiche dei promemoria.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let d = { titolo: "Mark", corpo: "" };
  try { d = { ...d, ...e.data.json() }; } catch { if (e.data) d.corpo = e.data.text(); }
  e.waitUntil(self.registration.showNotification(d.titolo, {
    body: d.corpo,
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    tag: `mark-${Date.now()}`,
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const tutte = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (tutte.length) return tutte[0].focus();
    return self.clients.openWindow("./");
  })());
});
