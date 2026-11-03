// Edge Function: send-push
// Recebe o webhook do banco (INSERT em daily_briefs) ou uma chamada manual
// e manda Web Push pra todos os celulares inscritos em push_subscriptions.

import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:jp2575425@gmail.com";

// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já vêm injetadas em toda Edge Function.
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// Segredos vivem no Vault do Postgres e chegam pela RPC get_app_secrets(),
// que só a service role pode chamar. Carrega uma vez por worker e guarda em memória.
type Segredos = { webhook_secret: string; vapid_public_key: string; vapid_private_key: string };
let segredos: Segredos | null = null;

async function carregarSegredos(): Promise<Segredos> {
  if (segredos) return segredos;
  const { data, error } = await supabase.rpc("get_app_secrets");
  if (error) throw new Error(`get_app_secrets: ${error.message}`);
  const mapa = Object.fromEntries((data as { name: string; value: string }[]).map((r) => [r.name, r.value]));
  const faltando = ["webhook_secret", "vapid_public_key", "vapid_private_key"].filter((k) => !mapa[k]);
  if (faltando.length) throw new Error(`Segredos ausentes no Vault: ${faltando.join(", ")}`);
  segredos = mapa as Segredos;
  webpush.setVapidDetails(VAPID_SUBJECT, segredos.vapid_public_key, segredos.vapid_private_key);
  return segredos;
}

type Brief = {
  id: string;
  brief_date: string;
  suggestion: string;
  github: Record<string, unknown[]>;
  course: { dias_parado?: number; proximo_modulo?: string };
};

function montarNotificacao(body: Record<string, unknown>) {
  // Chamada manual: { title, body, url }
  if (typeof body.title === "string") {
    return {
      title: body.title as string,
      body: (body.body as string) ?? "",
      url: (body.url as string) ?? "/",
    };
  }
  // Webhook do Supabase: { type: "INSERT", table, record }
  const b = body.record as Brief;
  const prs = (b.github?.prs_abertas?.length ?? 0) + (b.github?.reviews_pendentes?.length ?? 0);
  const partes: string[] = [];
  if (prs) partes.push(`${prs} PR${prs > 1 ? "s" : ""} pendente${prs > 1 ? "s" : ""}`);
  if (b.course?.dias_parado && b.course.dias_parado > 3) partes.push(`${b.course.dias_parado}d sem curso`);
  return {
    title: partes.length ? partes.join(" · ") : "Resumo das 14h",
    body: b.suggestion || "Abre pra ver o resumo do dia.",
    url: `/?dia=${b.brief_date}`,
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let s: Segredos;
  try {
    s = await carregarSegredos();
  } catch (e) {
    return new Response((e as Error).message, { status: 500 });
  }

  if (req.headers.get("x-webhook-secret") !== s.webhook_secret) {
    return new Response("Unauthorized", { status: 401 });
  }

  const payload = await req.json();
  const notif = montarNotificacao(payload);

  const { data: subs, error } = await supabase.from("push_subscriptions").select("*");
  if (error) return new Response(error.message, { status: 500 });

  let enviados = 0;
  const mortas: string[] = [];

  await Promise.all(
    (subs ?? []).map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(notif),
        );
        enviados++;
      } catch (e) {
        // 404/410 = inscrição expirada (app desinstalado, permissão revogada). Limpa.
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) mortas.push(s.endpoint);
        else console.error("push falhou", s.endpoint, e);
      }
    }),
  );

  if (mortas.length) {
    await supabase.from("push_subscriptions").delete().in("endpoint", mortas);
  }

  return Response.json({ enviados, removidas: mortas.length, notif });
});
