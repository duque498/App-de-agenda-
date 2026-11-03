import { useState } from "react";
import { supabase, type Contexto, type Evento, type Tipo } from "../lib/supabase";
import { diaDe } from "../lib/dates";
import { avaliarEsforco } from "../lib/assistente";

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
  tipo: Tipo;
  horaInicial?: string;
  onFechar: () => void;
  onSalvo: () => void;
  onAvaliado?: () => void;
};

// Uma folha só para criar e editar, evento ou tarefa. O que muda entre os dois:
// evento tem começo e fim; tarefa tem só um "começar às" opcional.
export function EditorEvento({ dia, evento, tipo, horaInicial, onFechar, onSalvo, onAvaliado }: Props) {
  const tarefa = tipo === "tarefa";
  const [title, setTitle] = useState(evento?.title ?? "");
  const [context, setContext] = useState<Contexto>(evento?.context ?? (tarefa ? "trabalho" : "pessoal"));
  const [data, setData] = useState(evento ? diaDe(evento.starts_at) : dia);
  const [diaInteiro, setDiaInteiro] = useState(evento ? evento.all_day : tarefa);
  const [inicio, setInicio] = useState(evento && !evento.all_day ? horaLocal(evento.starts_at) : horaInicial ?? "09:00");
  const [fim, setFim] = useState(evento ? horaLocal(evento.ends_at) : "");
  const [notes, setNotes] = useState(evento?.notes ?? "");
  const [salvando, setSalvando] = useState(false);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSalvando(true);
    const payload = {
      kind: tipo,
      title: title.trim(),
      context,
      all_day: diaInteiro,
      starts_at: diaInteiro ? `${data}T00:00:00-03:00` : `${data}T${inicio}:00-03:00`,
      ends_at: diaInteiro || tarefa ? null : fim ? `${data}T${fim}:00-03:00` : null,
      notes: notes.trim() || null,
    };
    const q = evento
      ? supabase.from("events").update(payload).eq("id", evento.id).select("id").single()
      : supabase.from("events").insert(payload).select("id").single();
    const { data: salvo, error } = await q;
    setSalvando(false);
    if (error) return alert(error.message);
    onSalvo();
    // Novo item: a IA avalia em segundo plano. A tela já fechou; quando terminar,
    // o onAvaliado recarrega e a % aparece. Erro aqui não atrapalha o salvar.
    if (!evento && salvo?.id) {
      avaliarEsforco(salvo.id).then(() => onAvaliado?.()).catch(console.warn);
    }
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
          <h2>{evento ? "Editar" : "Nova"} {tarefa ? "tarefa" : evento ? "evento" : "evento"}</h2>
          <button type="button" className="texto" onClick={onFechar}>Fechar</button>
        </header>

        <input autoFocus placeholder={tarefa ? "O que precisa fazer?" : "O quê?"} value={title} onChange={(e) => setTitle(e.target.value)} required />

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
            Data
            <input type="date" value={data} onChange={(e) => setData(e.target.value)} required />
          </label>
          <label className="alternar">
            {tarefa ? "Sem hora" : "Dia inteiro"}
            <input type="checkbox" checked={diaInteiro} onChange={(e) => setDiaInteiro(e.target.checked)} />
          </label>
        </div>

        {!diaInteiro && (
          <div className="linha">
            <label>
              {tarefa ? "Começar às" : "Começa"}
              <input type="time" value={inicio} onChange={(e) => setInicio(e.target.value)} required />
            </label>
            {!tarefa && (
              <label>
                Termina
                <input type="time" value={fim} onChange={(e) => setFim(e.target.value)} />
              </label>
            )}
          </div>
        )}

        <textarea
          placeholder="Notas — aceita Markdown (**negrito**, - listas). A IA usa isso pra avaliar."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
        />

        <div className="acoes">
          {evento && <button type="button" className="texto perigo" onClick={remover}>Remover</button>}
          <button disabled={salvando}>{evento ? "Salvar" : "Criar"}</button>
        </div>
      </form>
    </div>
  );
}
