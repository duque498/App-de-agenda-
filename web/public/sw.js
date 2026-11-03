// Service Worker — roda em background, mesmo com o app fechado.
// Duas responsabilidades: receber push e abrir o app quando a notificação é tocada.
// (Sem cache offline por enquanto: cache mal feito é a maior fonte de bug em PWA.)

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = { title: "Agenda", body: "", url: "/" };
  try {
    data = { ...data, ...event.data.json() };
  } catch {
    data.body = event.data ? event.data.text() : "";
  }

  // waitUntil: segura o SW vivo até a notificação ser exibida.
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: new URL("icons/icon-192.png", self.registration.scope).href,
      badge: new URL("icons/icon-192.png", self.registration.scope).href,
      data: { url: data.url },
      tag: "agenda-brief", // mesma tag = substitui a anterior em vez de empilhar
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // A função manda "/?dia=..."; resolvemos contra o escopo do SW (que já inclui /App-de-agenda-/)
  // pra não depender de onde o app está hospedado.
  const bruto = event.notification.data?.url || "/";
  const url = new URL(bruto.replace(/^\//, ""), self.registration.scope).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      // Se o app já está aberto, foca e navega; senão abre uma janela nova.
      const aberto = wins.find((w) => "focus" in w);
      if (aberto) {
        aberto.navigate(url);
        return aberto.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
