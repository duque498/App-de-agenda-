import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { Md } from "./Md";

type Linha = { id: number; role: "user" | "assistant"; texto: string; erro?: boolean };

const SUGESTOES = ["Como tá meu dia?", "O que tá pendente na Medweb?", "Organiza minha semana", "Onde parei no curso?"];

function textoDe(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return (content as { type: string; text?: string }[]).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  }
  return "";
}

// Aba do T.O.B.I.A.S.: conversa persistente (chat_messages). O app manda só o texto novo;
// a função carrega o histórico, age e grava o que aconteceu.
export function Tobias({ onMudouAgenda }: { onMudouAgenda: () => void }) {
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [texto, setTexto] = useState("");
  const [pensando, setPensando] = useState(false);
  const [erro, setErro] = useState("");
  const fim = useRef<HTMLDivElement>(null);

  async function carregar() {
    const { data } = await supabase.from("chat_messages").select("id,role,content,erro").eq("visible", true).order("id").limit(200);
    const novas = (data ?? []).map((r) => ({ id: r.id, role: r.role, texto: textoDe(r.content), erro: r.erro })).filter((l) => l.texto);
    setLinhas(novas);
    return novas;
  }
  useEffect(() => { carregar(); }, []);
  useEffect(() => { fim.current?.scrollIntoView({ behavior: "smooth" }); }, [linhas, pensando]);

  async function enviar(t = texto) {
    if (!t.trim() || pensando) return;
    setTexto("");
    setErro("");
    setPensando(true);
    setLinhas((l) => [...l, { id: -Date.now(), role: "user", texto: t }]);
    try {
      // A função responde na hora ("aceito") e trabalha em background; a resposta chega pelo banco.
      const { data, error } = await supabase.functions.invoke("assistente", { body: { texto: t } });
      if (error) {
        const ctx = (error as { context?: Response }).context;
        let msg = error.message;
        try { const raw = await ctx?.text(); if (raw) msg = JSON.parse(raw).erro ?? raw; } catch { /* mantém */ }
        throw new Error(msg);
      }
      if (data?.erro) throw new Error(data.erro);
      const userId: number = data.user_id ?? 0;

      // Espera a primeira mensagem do assistente com id maior que a do usuário (até 3 min).
      const limite = Date.now() + 180_000;
      while (Date.now() < limite) {
        await new Promise((r) => setTimeout(r, 1200));
        const { data: resp } = await supabase.from("chat_messages").select("id,acoes")
          .eq("role", "assistant").eq("visible", true).gt("id", userId).order("id").limit(5);
        if (resp && resp.length) {
          await carregar();
          if (resp.some((r) => r.acoes > 0)) onMudouAgenda();
          return;
        }
      }
      setErro("O Tobias demorou demais. A resposta pode aparecer se você reabrir a aba.");
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setPensando(false);
    }
  }

  async function limpar() {
    if (!confirm("Apagar toda a conversa com o Tobias?")) return;
    await supabase.functions.invoke("assistente", { body: { limpar: true } });
    setLinhas([]);
  }

  return (
    <section className="tobias">
      <header className="tobias-cabecalho">
        <div>
          <h2>T.O.B.I.A.S.</h2>
          <small>Agenda, Medweb e curso. Pergunta ou manda.</small>
        </div>
        {linhas.length > 0 && <button className="texto" onClick={limpar}>Limpar</button>}
      </header>

      <div className="mensagens tobias-mensagens">
        {linhas.length === 0 && (
          <div className="sugestoes">
            {SUGESTOES.map((s) => <button key={s} className="chip" onClick={() => enviar(s)}>{s}</button>)}
          </div>
        )}
        {linhas.map((m) =>
          m.erro ? <p key={m.id} className="msg erro">{m.texto}</p>
          : m.role === "assistant"
            ? <Md key={m.id} texto={m.texto} className="msg assistant" />
            : <p key={m.id} className="msg user">{m.texto}</p>,
        )}
        {pensando && <p className="msg assistant pensando">…</p>}
        {erro && <p className="msg erro">{erro}</p>}
        <div ref={fim} />
      </div>

      <form className="tobias-form" onSubmit={(e) => { e.preventDefault(); enviar(); }}>
        <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Fala com o Tobias" disabled={pensando} />
        <button disabled={pensando || !texto.trim()}>Enviar</button>
      </form>
    </section>
  );
}
