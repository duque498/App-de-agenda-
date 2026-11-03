import { supabase } from "./supabase";

export type ChatMsg = { role: "user" | "assistant"; content: unknown };

// O histórico que mandamos é o que a função devolve (inclui tool_use/tool_result),
// pra IA lembrar o que já fez nesta conversa. Fica só em memória: fecha o app, zera.
// supabase-js esconde o corpo de respostas não-2xx dentro de error.context; a gente puxa de lá
// pra mostrar o motivo real ("Anthropic 400: ...") em vez de "non-2xx status code".
async function mensagemDeErro(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response }).context;
  if (ctx && typeof ctx.text === "function") {
    try {
      const texto = await ctx.text();
      try { return JSON.parse(texto).erro ?? texto; } catch { return texto; }
    } catch { /* cai no genérico */ }
  }
  return (error as Error).message ?? "Erro desconhecido";
}

export async function perguntar(historico: ChatMsg[], texto: string) {
  const mensagens: ChatMsg[] = [...historico, { role: "user", content: texto }];

  const { data, error } = await supabase.functions.invoke("assistente", { body: { messages: mensagens } });
  if (error) throw new Error(await mensagemDeErro(error));
  if (data?.erro) throw new Error(data.erro);

  return data as { resposta: string; acoes: string[]; historico: ChatMsg[] };
}

// Pra exibir no chat só os textos (sem os blocos de ferramenta).
export function textoDe(m: ChatMsg): string {
  if (typeof m.content === "string") return m.content;
  if (Array.isArray(m.content)) {
    return (m.content as { type: string; text?: string }[])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
  }
  return "";
}

// Pede pra IA avaliar o esforço de um evento. A função grava no banco e devolve o evento atualizado.
export async function avaliarEsforco(eventId: string) {
  const { data, error } = await supabase.functions.invoke("esforco", { body: { event_id: eventId } });
  if (error) throw new Error(await mensagemDeErro(error));
  if (data?.erro) throw new Error(data.erro);
  return data.evento as import("./supabase").Evento;
}
