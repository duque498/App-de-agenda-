import { useState } from "react";
import { supabase, type Contexto, type Evento } from "../lib/supabase";
import { avaliarEsforco } from "../lib/assistente";
import { diaDe } from "../lib/dates";

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
  const [data, setData] = useState(evento ? diaDe(evento.starts_at) : dia);
  const [diaInteiro, setDiaInteiro] = useState(evento?.all_day ?? false);
  const [context, setContext] = useState<Contexto>(evento?.context ?? "pessoal");
  const [inicio, setInicio] = useState(evento ? horaLocal(evento.starts_at) : horaInicial ?? "09:00");
  const [fim, setFim] = useState(evento ? horaLocal(evento.ends_at) : "");
  const [notes, setNotes] = useState(evento?.notes ?? "");
  const [salvando, setSalvando] = useState(false);
  const [avaliando, setAvaliando] = useState(false);
  const [avaliacao, setAvaliacao] = useState<Evento | null>(evento);
  const [erroIa, setErroIa] = useState("");

  async function avaliar() {
    if (!evento) return;
    setAvaliando(true);
    setErroIa("");
    try {
      // Salva notas antes: a IA lê o que está no banco.
      if (notes !== (evento.notes ?? "")) await supabase.from("events").update({ notes: notes || null }).eq("id", evento.id);
      setAvaliacao(await avaliarEsforco(evento.id));
    } catch (e) {
      setErroIa((e as Error).message);
    } finally {
      setAvaliando(false);
    }
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSalvando(true);
    const payload = {
      title: title.trim(),
      context,
      all_day: diaInteiro,
      starts_at: diaInteiro ? `${data}T00:00:00-03:00` : `${data}T${inicio}:00-03:00`,
      ends_at: diaInteiro ? null : fim ? `${data}T${fim}:00-03:00` : null,
      notes: notes.trim() || null,
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
            Data
            <input type="date" value={data} onChange={(e) => setData(e.target.value)} required />
          </label>
          <label className="alternar">
            Dia inteiro
            <input type="checkbox" checked={diaInteiro} onChange={(e) => setDiaInteiro(e.target.checked)} />
          </label>
        </div>

        {!diaInteiro && (
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
        )}

        <textarea
          placeholder="Notas (a IA usa isso pra avaliar o esforço)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
        />

        {evento && (
          <section className="esforco">
            {avaliacao?.effort != null ? (
              <>
                <div className="esforco-cabeca">
                  <strong>{avaliacao.effort}% de esforço</strong>
                  <button type="button" className="texto" onClick={avaliar} disabled={avaliando}>
                    {avaliando ? "Avaliando…" : "Reavaliar"}
                  </button>
                </div>
                <div className={`barra ${avaliacao.effort > 70 ? "alta" : avaliacao.effort > 45 ? "media" : ""}`}>
                  <i style={{ width: `${avaliacao.effort}%` }} />
                </div>
                {avaliacao.ai_brief && <p className="brief">{avaliacao.ai_brief}</p>}
                {avaliacao.ai_tips?.length > 0 && (
                  <ul className="dicas">
                    {avaliacao.ai_tips.map((t, i) => <li key={i}>{t}</li>)}
                  </ul>
                )}
              </>
            ) : (
              <button type="button" className="texto" onClick={avaliar} disabled={avaliando}>
                {avaliando ? "Avaliando…" : "Avaliar esforço com IA"}
              </button>
            )}
            {erroIa && <p className="msg erro">{erroIa}</p>}
          </section>
        )}

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
