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

// ---------- esforço automático ----------
// Reusa a função esforco (mesma lógica, mesmo perfil, mesma calibração) em vez de duplicar.
// Precisa do JWT do dono porque esforco confere o e-mail. Falha ali não derruba a criação.
let jwtAtual = "";
async function avaliar(eventId: string) {
  try {
    const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/esforco`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${jwtAtual}`, apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "" },
      body: JSON.stringify({ event_id: eventId }),
    });
    if (!r.ok) { console.warn("esforco falhou", r.status, await r.text()); return null; }
    const { evento } = await r.json();
    return evento as { effort: number; ai_brief: string; ai_tips: string[] } | undefined;
  } catch (e) {
    console.warn("esforco erro", e);
    return null;
  }
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
    name: "ler_resumos_recentes",
    description: "Os últimos resumos diários de trabalho (PRs abertas, reviews pedidos, issues, e-mails que exigem ação, estado do curso). É a visão do que está pendente na Medweb e no curso.",
    input_schema: { type: "object", properties: { dias: { type: "integer", description: "quantos dias pra trás (padrão 3)" } } },
  },
  {
    name: "listar_periodo",
    description: "Lista eventos e tarefas entre duas datas (YYYY-MM-DD), inclusive. Útil pra semana/mês.",
    input_schema: { type: "object", properties: { de: { type: "string" }, ate: { type: "string" } }, required: ["de", "ate"] },
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
    name: "lembrete",
    description: "Agenda um push (notificação no celular) num horário. Pode ser avulso ('me lembra às 16h de ligar pro dentista') ou ligado a um evento/tarefa (event_id) tipo '30 min antes'.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "o que aparece na notificação" },
        body: { type: "string" },
        remind_at: { type: "string", description: "ISO 8601 com offset -03:00, no futuro" },
        event_id: { type: "string", description: "opcional: id do evento/tarefa relacionado" },
      },
      required: ["title", "remind_at"],
    },
  },
  {
    name: "cancelar_lembrete",
    description: "Cancela um lembrete pendente pelo id.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "listar_lembretes",
    description: "Lista lembretes pendentes (ainda não enviados).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "lembrar",
    description: "Guarda um fato durável sobre o Duque na memória compartilhada (ex.: 'treina seg/qua/sex às 18h', 'prova de física dia 20'). O Claude do claude.ai também lê isso. Não guarde coisa passageira.",
    input_schema: { type: "object", properties: { texto: { type: "string" } }, required: ["texto"] },
  },
  {
    name: "esquecer",
    description: "Remove uma memória pelo id (ver lista no contexto).",
    input_schema: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
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
  // ---- Antifofista Squad (treino e dieta) ----
  {
    name: "treino",
    description: "Devolve o treino do plano Antifofista: qual sessão é a próxima na rotação (A peito/tríceps, B costas/bíceps, C ombro/trapézio, D pernas), semana da periodização, lista de exercícios com séries×reps da semana atual, e as últimas cargas registradas de cada exercício. Pode pedir uma sessão específica.",
    input_schema: { type: "object", properties: { sessao: { type: "string", description: "A, B, C ou D. Omitir = a próxima na rotação." } } },
  },
  {
    name: "registrar_treino",
    description: "Registra que um treino foi feito (avança a rotação). Opcionalmente com as cargas por exercício e o id do evento de academia da agenda.",
    input_schema: {
      type: "object",
      properties: {
        dia: { type: "string", description: "YYYY-MM-DD" },
        sessao: { type: "string", description: "A, B, C ou D" },
        event_id: { type: "string" },
        registros: {
          type: "array",
          description: "Cargas por exercício.",
          items: {
            type: "object",
            properties: {
              exercicio: { type: "string" },
              series: { type: "array", items: { type: "object", properties: { kg: { type: "number" }, reps: { type: "integer" } } } },
            },
            required: ["exercicio"],
          },
        },
        obs: { type: "string" },
      },
      required: ["dia", "sessao"],
    },
  },
  {
    name: "dieta",
    description: "Devolve o plano alimentar completo da Antifofista: objetivo, macros, água, as 5 refeições com itens e gramas, suplementos e horários, trocas equivalentes e regras (refeição livre, pós-treino).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "checkin",
    description: "Registra ou consulta o check-in quinzenal (terça, fotos em jejum) com o treinador: peso, se foi enviado, relato.",
    input_schema: {
      type: "object",
      properties: {
        dia: { type: "string", description: "YYYY-MM-DD. Omitir = listar os últimos." },
        peso_kg: { type: "number" },
        enviado: { type: "boolean" },
        relato: { type: "string" },
      },
    },
  },
];

// Resumo curto do treino pra entrar no contexto do sistema (sem gastar tool call pra saber o básico).
async function resumoTreino() {
  const { data: t } = await admin.from("treino_hoje").select("*").maybeSingle();
  if (!t) return "(sem plano de treino ativo)";
  const { data: p } = await admin.from("planos").select("regras,dieta").eq("id", t.plano_id).single();
  const sessoes = (p?.regras as Record<string, Record<string, string>>)?.sessoes ?? {};
  const presc = (p?.regras as Record<string, Record<string, string>>)?.periodizacao?.[String(t.semana)] ?? "";
  const ult = t.ultimo_treino ? `último: ${t.ultima_sessao} em ${t.ultimo_treino}` : "nenhum treino registrado ainda";
  return `${t.nome}. Semana ${t.semana}/6 (prescrição ${presc}). Próximo treino na rotação: ${t.proxima_sessao} (${sessoes[t.proxima_sessao] ?? ""}); ${ult}. Sempre com abdominal + 20 min cardio. Dieta: ${(p?.dieta as Record<string, unknown>)?.objetivo ?? ""}, 5 refeições (café, pré-treino, almoço, pós-treino, jantar), água ~4,65 L. Detalhes via ferramentas treino e dieta.`;
}

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
    case "ler_resumos_recentes": {
      const n = Math.min(14, Math.max(1, Number(input.dias ?? 3)));
      const { data, error } = await admin.from("daily_briefs").select("brief_date,github,gmail,course,suggestion")
        .order("brief_date", { ascending: false }).limit(n);
      return error ? { erro: error.message } : { resumos: data };
    }
    case "listar_periodo": {
      const { data, error } = await admin.from("events")
        .select("id,kind,done,title,context,starts_at,ends_at,all_day,effort")
        .gte("starts_at", `${input.de}T00:00:00-03:00`).lte("starts_at", `${input.ate}T23:59:59-03:00`)
        .order("starts_at").limit(200);
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
      if (error) return { erro: error.message };
      const av = await avaliar(data.id);
      return { criado: data, esforco: av ? av.effort : "não avaliado" };
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
      const { data: criados, error } = await admin.from("events").insert(linhas).select("id");
      if (error) return { erro: error.message };
      // Avalia só o primeiro e copia: é o mesmo item repetido, a avaliação é a mesma.
      let esforco: number | string = "não avaliado";
      const av = criados?.length ? await avaliar(criados[0].id) : null;
      if (av && criados) {
        esforco = av.effort;
        await admin.from("events")
          .update({ effort: av.effort, ai_brief: av.ai_brief, ai_tips: av.ai_tips, ai_evaluated_at: new Date().toISOString() })
          .in("id", criados.slice(1).map((c) => c.id));
      }
      return { criados: linhas.length, primeiro: linhas[0].starts_at, ultimo: linhas[linhas.length - 1].starts_at, esforco };
    }
    case "lembrete": {
      const quando = new Date(String(input.remind_at));
      if (isNaN(quando.getTime())) return { erro: "remind_at inválido" };
      if (quando.getTime() <= Date.now()) return { erro: "Esse horário já passou." };
      const { data, error } = await admin.from("reminders")
        .insert({ title: String(input.title), body: input.body ? String(input.body) : null, remind_at: quando.toISOString(), event_id: input.event_id ?? null })
        .select("id,title,remind_at").single();
      return error ? { erro: error.message } : { agendado: data };
    }
    case "cancelar_lembrete": {
      const { error } = await admin.from("reminders").delete().eq("id", input.id).is("sent_at", null);
      return error ? { erro: error.message } : { cancelado: input.id };
    }
    case "listar_lembretes": {
      const { data, error } = await admin.from("reminders").select("id,title,remind_at,event_id").is("sent_at", null).order("remind_at").limit(50);
      return error ? { erro: error.message } : { lembretes: data };
    }
    case "lembrar": {
      const { data, error } = await admin.from("memorias").insert({ texto: String(input.texto), origem: "tobias" }).select("id,texto").single();
      return error ? { erro: error.message } : { guardado: data };
    }
    case "esquecer": {
      const { error } = await admin.from("memorias").delete().eq("id", input.id);
      return error ? { erro: error.message } : { removido: input.id };
    }
    case "concluir_tarefa": {
      const { data, error } = await admin.from("events").update({ done: input.done }).eq("id", input.id).select("id,title,done").single();
      return error ? { erro: error.message } : { atualizado: data };
    }
    case "remover_evento": {
      const { error } = await admin.from("events").delete().eq("id", input.id);
      return error ? { erro: error.message } : { removido: input.id };
    }
    case "treino": {
      const { data: t } = await admin.from("treino_hoje").select("*").maybeSingle();
      if (!t) return { erro: "Nenhum plano de treino ativo." };
      const sessao = String(input.sessao ?? t.proxima_sessao).toUpperCase();
      const { data: p } = await admin.from("planos").select("regras").eq("id", t.plano_id).single();
      const [{ data: exs }, { data: feitos }] = await Promise.all([
        admin.from("plano_exercicios").select("sessao,ordem,exercicio,prescricao,obs").eq("plano_id", t.plano_id).in("sessao", [sessao, "ABD", "CARDIO"]).order("sessao").order("ordem"),
        admin.from("treinos_feitos").select("dia,registros").eq("sessao", sessao).order("dia", { ascending: false }).limit(3),
      ]);
      // Última carga de cada exercício, do registro mais recente que o tenha.
      const ultimas: Record<string, unknown> = {};
      for (const f of feitos ?? []) {
        for (const r of (f.registros as { exercicio: string; series?: unknown[] }[]) ?? []) {
          if (!ultimas[r.exercicio]) ultimas[r.exercicio] = { dia: f.dia, series: r.series };
        }
      }
      const sem = String(t.semana);
      return {
        plano: t.nome, semana: t.semana, sessao, proxima_na_rotacao: t.proxima_sessao, ultimo_treino: t.ultimo_treino,
        regras: p?.regras,
        exercicios: (exs ?? []).map((e) => ({
          bloco: e.sessao, ordem: e.ordem, exercicio: e.exercicio, prescricao: (e.prescricao as Record<string, string>)[sem], obs: e.obs,
          ultima_carga: ultimas[e.exercicio] ?? null,
        })),
      };
    }
    case "registrar_treino": {
      const { data: t } = await admin.from("treino_hoje").select("plano_id,semana").maybeSingle();
      const { data, error } = await admin.from("treinos_feitos").insert({
        plano_id: t?.plano_id ?? null, semana: t?.semana ?? null,
        dia: String(input.dia), sessao: String(input.sessao).toUpperCase(),
        event_id: input.event_id ?? null, registros: input.registros ?? [], obs: input.obs ?? null,
      }).select("id,dia,sessao").single();
      return error ? { erro: error.message } : { registrado: data };
    }
    case "dieta": {
      const { data: p } = await admin.from("planos").select("dieta").eq("ativo", true).order("inicio", { ascending: false }).limit(1).maybeSingle();
      return p ? { dieta: p.dieta } : { erro: "Nenhum plano ativo." };
    }
    case "checkin": {
      if (!input.dia) {
        const { data, error } = await admin.from("checkins").select("*").order("dia", { ascending: false }).limit(10);
        return error ? { erro: error.message } : { checkins: data };
      }
      const linha: Record<string, unknown> = { dia: input.dia };
      if (input.peso_kg != null) linha.peso_kg = input.peso_kg;
      if (input.enviado != null) linha.enviado = input.enviado;
      if (input.relato != null) linha.relato = input.relato;
      const { data, error } = await admin.from("checkins").upsert(linha, { onConflict: "dia" }).select().single();
      return error ? { erro: error.message } : { checkin: data };
    }
    default:
      return { erro: `ferramenta desconhecida: ${nome}` };
  }
}

// ---------- handler ----------

type Msg = { role: "user" | "assistant"; content: unknown };
type BlocoConteudo = { type: string; id?: string; tool_use_id?: string };

// A API exige: todo tool_use numa mensagem do assistente tem que ter tool_result na mensagem
// seguinte. Se o histórico foi cortado (slice) ou veio quebrado de um erro anterior, isso falha.
// Aqui a gente remove blocos tool_use órfãos e tool_result sem par, e garante que o histórico
// comece numa mensagem de usuário com texto.
function limparHistorico(msgs: Msg[]): Msg[] {
  const out: Msg[] = [];
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.role === "assistant" && Array.isArray(m.content)) {
      const blocos = m.content as BlocoConteudo[];
      const usos = blocos.filter((b) => b.type === "tool_use").map((b) => b.id);
      const prox = msgs[i + 1];
      const resultados = prox?.role === "user" && Array.isArray(prox.content)
        ? new Set((prox.content as BlocoConteudo[]).filter((b) => b.type === "tool_result").map((b) => b.tool_use_id))
        : new Set<string | undefined>();
      const semResposta = usos.some((id) => !resultados.has(id));
      if (semResposta) {
        // Mantém só o texto; descarta os tool_use órfãos.
        const soTexto = blocos.filter((b) => b.type === "text");
        if (soTexto.length) out.push({ role: "assistant", content: soTexto });
        continue;
      }
    }
    if (m.role === "user" && Array.isArray(m.content)) {
      // tool_result só faz sentido logo após um assistant com tool_use que sobreviveu.
      const ant = out[out.length - 1];
      const temUso = ant?.role === "assistant" && Array.isArray(ant.content) &&
        (ant.content as BlocoConteudo[]).some((b) => b.type === "tool_use");
      if (!temUso) continue;
    }
    out.push(m);
  }
  // Começa sempre num user com texto; mensagens consecutivas do mesmo papel se fundem no texto.
  while (out.length && (out[0].role !== "user" || Array.isArray(out[0].content))) out.shift();
  const fundido: Msg[] = [];
  for (const m of out) {
    const ult = fundido[fundido.length - 1];
    if (ult && ult.role === m.role && typeof ult.content === "string" && typeof m.content === "string") {
      ult.content = `${ult.content}\n${m.content}`;
    } else fundido.push(m);
  }
  return fundido;
}

Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });

  // Camada 2: quem é o usuário desse JWT?
  const jwt = req.headers.get("authorization")?.replace("Bearer ", "") ?? "";
  jwtAtual = jwt;
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

  const corpo = (await req.json()) as { texto?: string; limpar?: boolean };

  // /limpar: zera a conversa.
  if (corpo.limpar) {
    await admin.from("chat_messages").delete().gt("id", 0);
    return Response.json({ ok: true }, { headers: cors });
  }

  // Histórico vem do banco (persistente), não do app. O app manda só o texto novo.
  const { data: salvas } = await admin.from("chat_messages").select("role,content").order("id", { ascending: true }).limit(60);
  const anteriores: Msg[] = (salvas ?? []).map((r) => ({ role: r.role as Msg["role"], content: r.content }));
  const textoNovo = (corpo.texto ?? "").trim();
  if (!textoNovo) return Response.json({ erro: "Mensagem vazia." }, { status: 400, headers: cors });
  const messages: Msg[] = [...anteriores, { role: "user", content: textoNovo }];
  const [{ data: perfilRow }, { data: memRows }, treinoResumo] = await Promise.all([
    admin.from("perfil").select("texto").eq("id", 1).maybeSingle(),
    admin.from("memorias").select("id,texto,origem,created_at").order("id").limit(80),
    resumoTreino().catch(() => "(treino indisponível)"),
  ]);
  const perfil = perfilRow?.texto ?? "";
  const memorias = (memRows ?? []).map((m) => `[${m.id}] ${m.texto} (${m.origem}, ${String(m.created_at).slice(0, 10)})`).join("\n");
  const agora = new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ, dateStyle: "full", timeStyle: "short",
  }).format(new Date());
  const hojeISO = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());

  const system = `Você é o T.O.B.I.A.S., assistente pessoal do Duque. Administra a agenda dele, acompanha o trabalho na Medweb e o curso, e conversa sobre o que ele precisar organizar.
Personalidade: direto, seco no bom sentido, competente, com humor fino e raro. Nunca bajula. Chama ele de Duque. Trata a agenda dele como coisa séria, mas sem drama.

SOBRE ELE (escrito por ele; use pra decidir contexto, horários e prioridades):
${perfil || "(sem perfil)"}

MEMÓRIA COMPARTILHADA (fatos duráveis; você e o Claude do claude.ai gravam aqui; use a ferramenta lembrar quando ele contar algo que vale guardar):
${memorias || "(vazia)"}

TREINO E DIETA (consultoria Antifofista Squad; você acompanha):
${treinoResumo}

Agora é ${agora} (fuso ${TZ}). Hoje é ${hojeISO}.
Contextos possíveis: trabalho (Medweb), escola, curso (web.dev), pessoal (academia e refeições entram aqui).
Dois tipos de item: evento (reunião, aula, bloco de trabalho — ocupa horário) e tarefa (algo a fazer no dia, ex. "responder o Kazu", "terminar issue 333" — hora opcional, pode ser concluída). "Lembra de", "preciso fazer", "tarefa" → tarefa.
Fontes: a agenda (listar_dia, listar_periodo) e os resumos diários de trabalho (ler_resumos_recentes) que chegam às 14h com PRs, reviews, issues, e-mails e estado do curso. Você não acessa GitHub/Gmail ao vivo; se perguntarem algo que exige isso, diga que o dado é do último resumo e a data dele.
Regras:
- Fale em português do Brasil, direto e curto. Sem floreio, sem sermão. Markdown leve quando ajudar (lista, negrito).
- Antes de criar ou mover algo, use listar_dia pra não sobrepor blocos sem avisar.
- Horários sempre em ISO com offset -03:00. "Amanhã", "sexta" etc. você resolve a partir de hoje.
- Se a pessoa pedir pra "organizar o dia", leia ler_resumo e listar_dia primeiro e proponha blocos concretos; só crie depois de ela confirmar, a não ser que ela já tenha mandado criar.
- Depois de agir, confirme em uma linha o que mudou. Não repita a lista inteira.
- Se faltar informação essencial (que horas?), pergunte em uma frase.
- "Me lembra às X de Y" / "me avisa 30 min antes" → ferramenta lembrete (é push no celular). Pra lembrete antes de um evento, use listar_dia pra pegar o event_id e o horário.
- Pra algo que se repete (aula toda semana, escola em dias úteis, tarefa toda sexta) use criar_serie, com kind "tarefa" quando for tarefa. Se a pessoa não disser até quando, use até o fim do mês seguinte e diga isso na resposta.
- Academia: "qual o treino de hoje?" → ferramenta treino. Ao criar o bloco de academia na agenda, ponha nas notes a sessão e os exercícios com séries×reps da semana (ex. "Treino A — peito/tríceps · S1 3x7a9\n- Supino Inclinado (H)…"), ~75 min. Quando ele disser que treinou ("fiz o A", "treinei hoje, supino 40kg 3x8"), use registrar_treino com as cargas que ele passou — isso avança a rotação. Pra encaixar refeições (pré e pós-treino em volta do bloco de academia) consulte dieta. Check-in com o treinador é a cada 15 dias na terça, fotos em jejum; use checkin pra registrar peso e envio.`;

  const historico: Msg[] = limparHistorico([...messages].slice(-30));
  // Tudo a partir daqui (a mensagem nova do usuário é a última) é o que será persistido no fim.
  const inicioNovo = Math.max(0, historico.length - 1);

  // Grava a mensagem do usuário já, pra tela mostrar e pra sobreviver a qualquer falha adiante.
  const { data: linhaUser } = await admin.from("chat_messages")
    .insert({ role: "user", content: textoNovo as unknown as object, visible: true }).select("id").single();

  // O loop com a Anthropic pode levar 30–90s (várias rodadas + avaliações). Conexão longa cai no
  // celular, então respondemos já e processamos em background; o app acompanha pelo banco.
  const trabalho = (async () => {
    const acoes: string[] = [];
    try {
      for (let rodada = 0; rodada < 8; rodada++) {
        const resp = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ model: MODEL, max_tokens: 4096, system, tools, messages: historico }),
        });
        if (!resp.ok) throw new Error(`Anthropic ${resp.status}: ${await resp.text()}`);
        const data = await resp.json();
        historico.push({ role: "assistant", content: data.content });

        // Decide pelo conteúdo, não só pelo stop_reason: se estourou max_tokens no meio de uma
        // sequência de tool_use, os blocos completos ainda precisam ser executados e respondidos.
        const temToolUse = (data.content as BlocoConteudo[]).some((b) => b.type === "tool_use");
        if (!temToolUse) break;

        const resultados = [];
        for (const bloco of data.content as { type: string; id: string; name: string; input: Record<string, unknown> }[]) {
          if (bloco.type !== "tool_use") continue;
          const r = await executar(bloco.name, bloco.input);
          if (["criar_evento", "criar_serie", "atualizar_evento", "remover_evento", "concluir_tarefa", "lembrete", "cancelar_lembrete", "registrar_treino"].includes(bloco.name) && !("erro" in r)) acoes.push(bloco.name);
          resultados.push({ type: "tool_result", tool_use_id: bloco.id, content: JSON.stringify(r) });
        }
        historico.push({ role: "user", content: resultados });
      }
      // Persiste tudo que veio depois da mensagem do usuário (que já está salva).
      const linhas = historico.slice(inicioNovo + 1).map((m) => ({
        role: m.role,
        content: m.content as unknown as object,
        visible: Array.isArray(m.content) && (m.content as BlocoConteudo[]).some((b) => b.type === "text"),
        acoes: acoes.length,
      }));
      if (linhas.length) await admin.from("chat_messages").insert(linhas);
    } catch (e) {
      console.error("assistente falhou", e);
      await admin.from("chat_messages").insert({
        role: "assistant", content: `Deu erro aqui: ${(e as Error).message}`, visible: true, erro: true,
      });
    }
  })();

  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(trabalho); else await trabalho;

  return Response.json({ aceito: true, user_id: linhaUser?.id ?? null }, { status: 202, headers: cors });
});
