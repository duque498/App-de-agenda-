import { supabase } from "./supabase";

// A chave pública VAPID vem em base64url; a API PushManager quer Uint8Array.
function base64UrlToUint8Array(b64: string) {
  const padding = "=".repeat((4 - (b64.length % 4)) % 4);
  const base64 = (b64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

// iOS só libera Push se o site foi adicionado à Tela de Início.
export function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // @ts-expect-error propriedade só existe no Safari iOS
    window.navigator.standalone === true
  );
}

export function pushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export async function registerSW() {
  if (!("serviceWorker" in navigator)) return null;
  const reg = await navigator.serviceWorker.register(import.meta.env.BASE_URL + "sw.js");
  // Procura versão nova do SW a cada abertura; o novo assume na próxima recarga.
  reg.update().catch(() => {});
  return reg;
}

export async function currentSubscription() {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

// Fluxo completo: pede permissão → cria a subscription no navegador → salva no Supabase.
export async function subscribeToPush(): Promise<"ok" | "negado" | "sem-suporte"> {
  if (!pushSupported()) return "sem-suporte";

  const permissao = await Notification.requestPermission();
  if (permissao !== "granted") return "negado";

  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true, // obrigatório: todo push precisa virar notificação visível
      applicationServerKey: base64UrlToUint8Array(import.meta.env.VITE_VAPID_PUBLIC_KEY),
    }));

  const json = sub.toJSON();
  // upsert por endpoint: reinstalou o app = endpoint novo, linha nova; mesmo app = atualiza.
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      endpoint: sub.endpoint,
      p256dh: json.keys!.p256dh,
      auth: json.keys!.auth,
      user_agent: navigator.userAgent,
    },
    { onConflict: "endpoint" },
  );
  if (error) throw error;
  return "ok";
}

export async function unsubscribeFromPush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
  await sub.unsubscribe();
}
