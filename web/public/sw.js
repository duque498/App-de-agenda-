// Service Worker — push, clique na notificação e cache do app shell.
//
// Estratégia de cache (simples de propósito):
//  - /assets/*  → cache-first. O Vite põe hash no nome; conteúdo novo = nome novo. Nunca fica velho.
//  - index.html → network-first com fallback ao cache. Abre offline e pega versão nova quando há rede.
//  - resto (ícones, manifest, fontes) → stale-while-revalidate.
// Chamadas ao Supabase nunca passam por aqui (outro domínio): dado é sempre da rede.

const VERSAO = "v3";
const SHELL = `shell-${VERSAO}`;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((chaves) => Promise.all(chaves.filter((c) => c !== SHELL).map((c) => caches.delete(c))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin && !url.hostname.endsWith("gstatic.com") && !url.hostname.endsWith("googleapis.com")) return;

  // navegação (index.html): rede primeiro
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).then((r) => { const c = r.clone(); caches.open(SHELL).then((cache) => cache.put(req, c)); return r; })
        .catch(() => caches.match(req).then((r) => r || caches.match(new URL(self.registration.scope).pathname))),
    );
    return;
  }

  // assets com hash: cache primeiro
  if (url.pathname.includes("/assets/")) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((r) => { const c = r.clone(); caches.open(SHELL).then((cache) => cache.put(req, c)); return r; })),
    );
    return;
  }

  // demais estáticos: devolve o cache e atualiza por trás
  event.respondWith(
    caches.match(req).then((hit) => {
      const rede = fetch(req).then((r) => { if (r.ok) { const c = r.clone(); caches.open(SHELL).then((cache) => cache.put(req, c)); } return r; }).catch(() => hit);
      return hit || rede;
    }),
  );
});

self.addEventListener("push", (event) => {
  let data = { title: "Agenda", body: "", url: "/" };
  try { data = { ...data, ...event.data.json() }; } catch { data.body = event.data ? event.data.text() : ""; }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: new URL("icons/icon-192.png", self.registration.scope).href,
      badge: new URL("icons/icon-192.png", self.registration.scope).href,
      data: { url: data.url },
      tag: "agenda-brief",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const bruto = event.notification.data?.url || "/";
  const url = new URL(bruto.replace(/^\//, ""), self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const aberto = wins.find((w) => "focus" in w);
      if (aberto) { aberto.navigate(url); return aberto.focus(); }
      return self.clients.openWindow(url);
    }),
  );
});
