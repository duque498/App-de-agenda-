// Edge Function: esforco
// Lê um evento, pede pra IA estimar o esforço (0–100), escrever um brief curto
// e dar recomendações, e grava tudo de volta no evento.
// Saída estruturada: forçamos o modelo a usar a ferramenta `avaliar`, então a
// resposta vem como JSON validado pelo schema em vez de texto livre.

import { createClient } from "npm:@supabase/supabase-js@2";

const OWNER_EMAIL = "jp2575425@gmail.com";
const MODEL = "claude-sonnet-5-5";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

let apiKey: string | null = null;
async function carregarApiKey() {
  if (apiKey) return apiKey;
  const { data, error } = await admin.rpc("get_app_secrets");
  if (error) throw new Error(`get_app_secrets: ${error.message}`);
  const row = (data as { name: string; value: string }[]).find((r) => r.name === "anthropic_api_key");
  if (!row) throw new Error("anthropic_api_key ausente no Vault");
  return (apiKey = row.value);
}

const ferramentaAvaliar = {
  name: "avaliar",
  description: "Registra a avaliação de esforço de um evento da agenda.",
  input_schema: {
    type: "object",
    properties: {
      effort: { type: "integer", minimum: 0, maximum: 100, description: "Esforço estimado em %, considerando duração, carga mental e contexto." },
      brief: { type: "string", description: "Uma ou duas frases: o que é essa tarefa na prática e por que esse nível de esforço." },
      tips: { type: "array", items: { type: "string" }, description: "Recomendações concretas e curtas (quando fazer, como quebrar, o que preparar antes)." },
    },
    required: ["effort", "brief", "tips"],
  },
};

Deno.serve(async (req) => {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });

  const jwt = req.headers.get("authorization")?.replace("Bearer ", "") ?? "";
  const { data: u, error: uErr } = await admin.auth.getUser(jwt);
  if (uErr || u.user?.email !== OWNER_EMAIL) return new Response("Unauthorized", { status: 401, headers: cors });

  const { event_id } = (await req.json()) as { event_id: string };
  const { data: ev, error: evErr } = await admin.from("events").select("*").eq("id", event_id).single();
  if (evErr || !ev) return Response.json({ erro: "Evento não encontrado" }, { status: 404, headers: cors });

  // Contexto do dia: outros eventos ajudam a calibrar ("já tem 6h de Medweb hoje").
  const dia = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(ev.starts_at));
  const { data: outros } = await admin
    .from("events")
    .select("title,context,starts_at,ends_at,effort")
    .gte("starts_at", `${dia}T00:00:00-03:00`)
    .lte("starts_at", `${dia}T23:59:59-03:00`)
    .neq("id", event_id);

  // Contexto do dono: perfil (editável no app), avaliações anteriores (calibração) e resumo do dia.
  const [perfilR, anterioresR, briefR, keyR] = await Promise.allSettled([
    admin.from("perfil").select("texto").eq("id", 1).maybeSingle(),
    admin.from("events").select("title,context,effort,ai_brief").not("effort", "is", null).neq("id", event_id)
      .order("ai_evaluated_at", { ascending: false }).limit(12),
    admin.from("daily_briefs").select("suggestion,github,course").eq("brief_date", dia).maybeSingle(),
    carregarApiKey(),
  ]);
  if (keyR.status === "rejected") return Response.json({ erro: String(keyR.reason?.message ?? keyR.reason) }, { status: 500, headers: cors });
  const key = keyR.value;
  const perfil = perfilR.status === "fulfilled" ? perfilR.value.data?.texto ?? "" : "";
  const anteriores = anterioresR.status === "fulfilled" ? anterioresR.value.data ?? [] : [];
  const brief = briefR.status === "fulfilled" ? briefR.value.data : null;

  const system = `Você avalia o esforço de tarefas da agenda do Duque.

SOBRE ELE (escrito por ele mesmo; use pra calibrar):
${perfil || "(sem perfil)"}

Escala de esforço (%):
- 0–20: rotina, quase automático (responder mensagem, ler e-mail).
- 21–45: exige atenção mas é conhecido (aula, revisar PR pequena, módulo do curso).
- 46–70: trabalho de verdade (implementar feature, prova, estudar algo novo).
- 71–100: pesado — longo, difícil ou com pressão (entrega com prazo, debug complicado, prova decisiva).
Considere a duração, o contexto (trabalho/escola/curso/pessoal), o que mais tem no dia e o horário.
Brief e recomendações em português do Brasil, diretos, sem motivação barata. Recomendações devem ser acionáveis: quando fazer, como dividir, o que preparar antes, o que evitar.`;

  const descricao = {
    titulo: ev.title,
    contexto: ev.context,
    inicio: ev.starts_at,
    fim: ev.ends_at,
    dia_inteiro: ev.all_day,
    notas: ev.notes,
    outros_eventos_do_dia: outros ?? [],
    resumo_do_dia: brief ? { sugestao: brief.suggestion, github: brief.github, curso: brief.course } : null,
    // Avaliações que você já fez: mantenha coerência com elas (mesma tarefa ≈ mesmo esforço).
    avaliacoes_anteriores: anteriores,
  };

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 600,
      system,
      tools: [ferramentaAvaliar],
      tool_choice: { type: "tool", name: "avaliar" }, // obriga a resposta estruturada
      messages: [{ role: "user", content: `Avalie este evento:\n${JSON.stringify(descricao, null, 2)}` }],
    }),
  });
  if (!resp.ok) {
    const corpo = await resp.text();
    console.error("anthropic", resp.status, corpo);
    return Response.json({ erro: `Anthropic ${resp.status}: ${corpo}` }, { status: 502, headers: cors });
  }

  const data = await resp.json();
  const uso = (data.content as { type: string; input?: { effort: number; brief: string; tips: string[] } }[]).find((b) => b.type === "tool_use");
  if (!uso?.input) return Response.json({ erro: "Modelo não devolveu avaliação" }, { status: 502, headers: cors });

  const effort = Math.max(0, Math.min(100, Math.round(Number(uso.input.effort))));
  const briefTexto = String(uso.input.brief ?? "");
  const tips = (Array.isArray(uso.input.tips) ? uso.input.tips : []).slice(0, 4).map(String);
  const { data: salvo, error: upErr } = await admin
    .from("events")
    .update({ effort, ai_brief: briefTexto, ai_tips: tips, ai_evaluated_at: new Date().toISOString() })
    .eq("id", event_id)
    .select()
    .single();
  if (upErr) return Response.json({ erro: upErr.message }, { status: 500, headers: cors });

  return Response.json({ evento: salvo }, { headers: cors });
});
