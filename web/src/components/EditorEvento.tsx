import { useEffect, useState } from "react";
import { supabase, type Contexto, type Evento, type Lembrete, type Tipo } from "../lib/supabase";
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
  // Lembrete: minutos antes do início. "" = sem lembrete. Em item sem hora, fica "no dia às 08:00".
  const [lembrete, setLembrete] = useState<string>("");
  const [lembreteExistente, setLembreteExistente] = useState<Lembrete | null>(null);

  useEffect(() => {
    if (!evento) return;
    supabase.from("reminders").select("*").eq("event_id", evento.id).is("sent_at", null).order("remind_at").limit(1)
      .then(({ data }) => {
        const l = data?.[0] as Lembrete | undefined;
        if (!l) return;
        setLembreteExistente(l);
        const min = Math.round((new Date(evento.starts_at).getTime() - new Date(l.remind_at).getTime()) / 60000);
        setLembrete(evento.all_day ? "dia" : String(min));
      });
  }, [evento]);

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

    // Lembrete: apaga o pendente anterior e cria o novo (se houver).
    const idEvento = salvo?.id ?? evento?.id;
    if (idEvento) {
      if (lembreteExistente) await supabase.from("reminders").delete().eq("id", lembreteExistente.id);
      if (lembrete) {
        const inicio = new Date(payload.starts_at);
        const quando = lembrete === "dia"
          ? new Date(`${data}T08:00:00-03:00`)
          : new Date(inicio.getTime() - Number(lembrete) * 60000);
        if (quando.getTime() > Date.now()) {
          await supabase.from("reminders").insert({
            event_id: idEvento,
            title: tarefa ? `Tarefa: ${title.trim()}` : title.trim(),
            body: diaInteiro ? "Hoje" : `${lembrete === "0" ? "Agora" : `Em ${lembrete} min`} · ${inicio.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}`,
            remind_at: quando.toISOString(),
          });
        }
      }
    }
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

        <label className="campo-lembrete">
          Lembrete
          <select value={lembrete} onChange={(e) => setLembrete(e.target.value)}>
            <option value="">Sem lembrete</option>
            {diaInteiro ? (
              <option value="dia">No dia, às 08:00</option>
            ) : (
              <>
                <option value="0">Na hora</option>
                <option value="5">5 min antes</option>
                <option value="10">10 min antes</option>
                <option value="15">15 min antes</option>
                <option value="30">30 min antes</option>
                <option value="60">1 hora antes</option>
                <option value="120">2 horas antes</option>
                <option value="1440">1 dia antes</option>
              </>
            )}
          </select>
        </label>

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
