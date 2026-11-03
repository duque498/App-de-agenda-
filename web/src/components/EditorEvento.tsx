import { useState } from "react";
import { supabase, type Contexto, type Evento } from "../lib/supabase";

const CONTEXTOS: { id: Contexto; rotulo: string }[] = [
  { id: "trabalho", rotulo: "Trabalho" },
  { id: "escola", rotulo: "Escola" },
  { id: "curso", rotulo: "Curso" },
  { id: "pessoal", rotulo: "Pessoal" },
];

function horaLocal(ts: string | null) {
  if (!ts) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(ts));
}

type Props = {
  dia: string;
  evento: Evento | null; // null = novo
  horaInicial?: string;
  onFechar: () => void;
  onSalvo: () => void;
};

// Uma folha só para criar e editar: menos código, mesmo comportamento.
export function EditorEvento({ dia, evento, horaInicial, onFechar, onSalvo }: Props) {
  const [title, setTitle] = useState(evento?.title ?? "");
  const [context, setContext] = useState<Contexto>(evento?.context ?? "pessoal");
  const [inicio, setInicio] = useState(evento ? horaLocal(evento.starts_at) : horaInicial ?? "09:00");
  const [fim, setFim] = useState(evento ? horaLocal(evento.ends_at) : "");
  const [salvando, setSalvando] = useState(false);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSalvando(true);
    const payload = {
      title: title.trim(),
      context,
      starts_at: `${dia}T${inicio}:00-03:00`,
      ends_at: fim ? `${dia}T${fim}:00-03:00` : null,
    };
    const q = evento
      ? supabase.from("events").update(payload).eq("id", evento.id)
      : supabase.from("events").insert(payload);
    const { error } = await q;
    setSalvando(false);
    if (error) return alert(error.message);
    onSalvo();
  }

  async function remover() {
    if (!evento || !confirm(`Remover "${evento.title}"?`)) return;
    await supabase.from("events").delete().eq("id", evento.id);
    onSalvo();
  }

  return (
    <div className="gaveta aberta">
      <div className="gaveta-fundo" onClick={onFechar} />
      <form className="gaveta-painel editor" onSubmit={salvar}>
        <header>
          <h2>{evento ? "Editar bloco" : "Novo bloco"}</h2>
          <button type="button" className="texto" onClick={onFechar}>Fechar</button>
        </header>

        <input autoFocus placeholder="O quê?" value={title} onChange={(e) => setTitle(e.target.value)} required />

        <div className="seletor-ctx">
          {CONTEXTOS.map((c) => (
            <button
              type="button"
              key={c.id}
              className={`chip ctx-${c.id} ${context === c.id ? "ativo" : ""}`}
              onClick={() => setContext(c.id)}
            >
              {c.rotulo}
            </button>
          ))}
        </div>

        <div className="linha">
          <label>
            Começa
            <input type="time" value={inicio} onChange={(e) => setInicio(e.target.value)} required />
          </label>
          <label>
            Termina
            <input type="time" value={fim} onChange={(e) => setFim(e.target.value)} />
          </label>
        </div>

        <div className="acoes">
          {evento && (
            <button type="button" className="texto perigo" onClick={remover}>Remover</button>
          )}
          <button disabled={salvando}>{evento ? "Salvar" : "Criar"}</button>
        </div>
      </form>
    </div>
  );
}
