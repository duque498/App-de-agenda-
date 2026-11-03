// Edge Function: assistente
// Recebe o histórico de chat do app, chama a Anthropic API com ferramentas de agenda,
// executa as ferramentas no banco (service role) e devolve a resposta final.
//
// Segurança em duas camadas:
//  1. verify_jwt: true → só chega aqui com um JWT válido do Supabase Auth.
//  2. Conferimos que o e-mail do JWT é o do dono — a mesma regra do RLS.

import { createClient } from "npm:@supabase/supabase-js@2";

const OWNER_EMAIL = "jp2575425@gmail.com";
const MODEL = "claude-sonnet-5-5";
const TZ = "America/Sao_Paulo";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

let apiKey: string | null = null;
async function carregarApiKey() {
  if (apiKey) return apiKey;
  const { data, error } = await admin.rpc("get_app_secrets");
  if (error) throw new Error(`get_app_secrets: ${error.message}`);
  const row = (data as { name: string; value: string }[]).find((r) => r.name === "anthropic_api_key");
  if (!row) throw new Error("anthropic_api_key ausente no Vault");
  apiKey = row.value;
  return apiKey;
}

// ---------- ferramentas ----------

const tools = [
  {
    name: "listar_dia",
    description: "Lista os eventos de um dia (YYYY-MM-DD) com id, título, contexto e horários.",
    input_schema: {
      type: "object",
      properties: { dia: { type: "string", description: "YYYY-MM-DD" } },
      required: ["dia"],
    },
  },
  {
    name: "ler_resumo",
    description: "Lê o resumo das 14h (trabalho, e-mails, curso, sugestão) de um dia. Vazio se ainda não chegou.",
    input_schema: {
      type: "object",
      properties: { dia: { type: "string", description: "YYYY-MM-DD" } },
      required: ["dia"],
    },
  },
  {
    name: "criar_evento",
    description: "Cria um item na agenda: evento (ocupa horário) ou tarefa (algo a fazer no dia; hora opcional — sem hora, use all_day true e starts_at à meia-noite -03:00).",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["evento", "tarefa"], description: "padrão evento" },
        all_day: { type: "boolean" },
        title: { type: "string" },
        context: { type: "string", enum: ["trabalho", "escola", "curso", "pessoal"] },
        starts_at: { type: "string", description: "ISO 8601 com offset, ex: 2026-11-03T14:00:00-03:00" },
        ends_at: { type: "string", description: "ISO 8601 com offset ou null" },
        notes: { type: "string" },
      },
      required: ["title", "context", "starts_at"],
    },
  },
  {
    name: "atualizar_evento",
    description: "Altera título, contexto, horários ou notas de um evento existente.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        context: { type: "string", enum: ["trabalho", "escola", "curso", "pessoal"] },
        starts_at: { type: "string" },
        ends_at: { type: "string" },
        notes: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "criar_serie",
    description: "Cria o mesmo item (evento ou tarefa) em vários dias de uma vez (ex.: escola de segunda a sexta até dezembro; 'revisar PRs' toda sexta). Use isto em vez de criar_evento repetido.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["evento", "tarefa"], description: "padrão evento" },
        title: { type: "string" },
        context: { type: "string", enum: ["trabalho", "escola", "curso", "pessoal"] },
        hora_inicio: { type: "string", description: "HH:MM. Para tarefa sem hora, omita." },
        hora_fim: { type: "string", description: "HH:MM ou null (tarefa não usa)" },
        dias_semana: { type: "array", items: { type: "integer", minimum: 0, maximum: 6 }, description: "0=domingo … 6=sábado. Dias úteis = [1,2,3,4,5]" },
        de: { type: "string", description: "YYYY-MM-DD, primeiro dia" },
        ate: { type: "string", description: "YYYY-MM-DD, último dia (máx. ~90 dias à frente)" },
        notes: { type: "string" },
      },
      required: ["title", "context", "dias_semana", "de", "ate"],
    },
  },
  {
    name: "concluir_tarefa",
    description: "Marca uma tarefa como concluída (done=true) ou reabre (done=false).",
    input_schema: { type: "object", properties: { id: { type: "string" }, done: { type: "boolean" } }, required: ["id", "done"] },
  },
  {
    name: "remover_evento",
    description: "Apaga um evento pelo id.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
];

async function executar(nome: string, input: Record<string, unknown>) {
  switch (nome) {
    case "listar_dia": {
      const dia = input.dia as string;
      const { data, error } = await admin
        .from("events")
        .select("id,kind,done,title,context,starts_at,ends_at,all_day,notes,effort")
        .gte("starts_at", `${dia}T00:00:00-03:00`)
        .lte("starts_at", `${dia}T23:59:59-03:00`)
        .order("starts_at");
      return error ? { erro: error.message } : { eventos: data };
    }
    case "ler_resumo": {
      const { data, error } = await admin.from("daily_briefs").select("*").eq("brief_date", input.dia).maybeSingle();
      return error ? { erro: error.message } : { resumo: data };
    }
    case "criar_evento": {
      const { data, error } = await admin
        .from("events")
        .insert({ ...input, source: "ia" })
        .select("id,title,starts_at,ends_at,context")
        .single();
      return error ? { erro: error.message } : { criado: data };
    }
    case "atualizar_evento": {
      const { id, ...campos } = input;
      const { data, error } = await admin.from("events").update(campos).eq("id", id).select().single();
      return error ? { erro: error.message } : { atualizado: data };
    }
    case "criar_serie": {
      const { kind = "evento", title, context, hora_inicio, hora_fim, dias_semana, de, ate, notes } = input as {
        kind?: string; title: string; context: string; hora_inicio?: string | null; hora_fim?: string | null;
        dias_semana: number[]; de: string; ate: string; notes?: string;
      };
      const tarefa = kind === "tarefa";
      // Evento precisa de hora; tarefa sem hora vira "dia inteiro" (meia-noite de SP).
      if (!tarefa && !hora_inicio) return { erro: "Evento precisa de hora_inicio." };
      const semHora = !hora_inicio;
      const linhas: Record<string, unknown>[] = [];
      const [y, m, d] = de.split("-").map(Number);
      const fim = new Date(`${ate}T12:00:00Z`);
      for (let cur = new Date(Date.UTC(y, m - 1, d)); cur <= fim && linhas.length < 120; cur.setUTCDate(cur.getUTCDate() + 1)) {
        if (!dias_semana.includes(cur.getUTCDay())) continue;
        const iso = cur.toISOString().slice(0, 10);
        linhas.push({
          kind, title, context, notes: notes ?? null, source: "ia", all_day: semHora,
          starts_at: semHora ? `${iso}T00:00:00-03:00` : `${iso}T${hora_inicio}:00-03:00`,
          ends_at: !tarefa && hora_fim ? `${iso}T${hora_fim}:00-03:00` : null,
        });
      }
      if (!linhas.length) return { erro: "Nenhum dia bate com os critérios." };
      const { error } = await admin.from("events").insert(linhas);
      return error ? { erro: error.message } : { criados: linhas.length, primeiro: linhas[0].starts_at, ultimo: linhas[linhas.length - 1].starts_at };
    }
    case "concluir_tarefa": {
      const { data, error } = await admin.from("events").update({ done: input.done }).eq("id", input.id).select("id,title,done").single();
      return error ? { erro: error.message } : { atualizado: data };
    }
    case "remover_evento": {
      const { error } = await admin.from("events").delete().eq("id", input.id);
      return error ? { erro: error.message } : { removido: input.id };
    }
    default:
      return { erro: `ferramenta desconhecida: ${nome}` };
  }
}

// ---------- handler ----------

type Msg = { role: "user" | "assistant"; content: unknown };

Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });

  // Camada 2: quem é o usuário desse JWT?
  const jwt = req.headers.get("authorization")?.replace("Bearer ", "") ?? "";
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || userData.user?.email !== OWNER_EMAIL) {
    return new Response("Unauthorized", { status: 401, headers: cors });
  }

  let key: string;
  try {
    key = await carregarApiKey();
  } catch (e) {
    return Response.json({ erro: (e as Error).message }, { status: 500, headers: cors });
  }

  const { messages } = (await req.json()) as { messages: Msg[] };
  const { data: perfilRow } = await admin.from("perfil").select("texto").eq("id", 1).maybeSingle();
  const perfil = perfilRow?.texto ?? "";
  const agora = new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ, dateStyle: "full", timeStyle: "short",
  }).format(new Date());
  const hojeISO = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());

  const system = `Você administra a agenda pessoal do Duque.

SOBRE ELE (escrito por ele; use pra decidir contexto, horários e prioridades):
${perfil || "(sem perfil)"}

Agora é ${agora} (fuso ${TZ}). Hoje é ${hojeISO}.
Contextos possíveis: trabalho (Medweb), escola, curso (web.dev), pessoal.
Dois tipos de item: evento (reunião, aula, bloco de trabalho — ocupa horário) e tarefa (algo a fazer no dia, ex. "responder o Kazu", "terminar issue 333" — hora opcional, pode ser concluída). "Lembra de", "preciso fazer", "tarefa" → tarefa.
Regras:
- Fale em português do Brasil, direto e curto. Sem floreio, sem sermão.
- Antes de criar ou mover algo, use listar_dia pra não sobrepor blocos sem avisar.
- Horários sempre em ISO com offset -03:00. "Amanhã", "sexta" etc. você resolve a partir de hoje.
- Se a pessoa pedir pra "organizar o dia", leia ler_resumo e listar_dia primeiro e proponha blocos concretos; só crie depois de ela confirmar, a não ser que ela já tenha mandado criar.
- Depois de agir, confirme em uma linha o que mudou. Não repita a lista inteira.
- Se faltar informação essencial (que horas?), pergunte em uma frase.
- Pra algo que se repete (aula toda semana, escola em dias úteis, tarefa toda sexta) use criar_serie, com kind "tarefa" quando for tarefa. Se a pessoa não disser até quando, use até o fim do mês seguinte e diga isso na resposta.`;

  const historico: Msg[] = [...messages].slice(-20);
  const acoes: string[] = [];

  for (let rodada = 0; rodada < 8; rodada++) {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 1024, system, tools, messages: historico }),
    });
    if (!resp.ok) {
      return Response.json({ erro: `Anthropic ${resp.status}: ${await resp.text()}` }, { status: 502, headers: cors });
    }
    const data = await resp.json();
    historico.push({ role: "assistant", content: data.content });

    if (data.stop_reason !== "tool_use") {
      const texto = (data.content as { type: string; text?: string }[])
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      return Response.json({ resposta: texto, acoes, historico }, { headers: cors });
    }

    // Executa cada tool_use e devolve os resultados numa única mensagem de usuário.
    const resultados = [];
    for (const bloco of data.content as { type: string; id: string; name: string; input: Record<string, unknown> }[]) {
      if (bloco.type !== "tool_use") continue;
      const r = await executar(bloco.name, bloco.input);
      if (["criar_evento", "criar_serie", "atualizar_evento", "remover_evento", "concluir_tarefa"].includes(bloco.name) && !("erro" in r)) acoes.push(bloco.name);
      resultados.push({ type: "tool_result", tool_use_id: bloco.id, content: JSON.stringify(r) });
    }
    historico.push({ role: "user", content: resultados });
  }

  return Response.json({ erro: "Muitas rodadas de ferramenta sem resposta final." }, { status: 500, headers: cors });
});
