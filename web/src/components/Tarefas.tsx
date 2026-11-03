import { supabase, type Evento } from "../lib/supabase";
import { hora } from "../lib/dates";

type Props = { tarefas: Evento[]; onAbrir: (e: Evento) => void; onMudou: () => void };

// Lista de tarefas do dia: checkbox pra concluir, toque no texto abre o detalhe.
// Abertas primeiro, concluídas no fim e apagadas.
export function Tarefas({ tarefas, onAbrir, onMudou }: Props) {
  if (tarefas.length === 0) return null;
  const ordenadas = [...tarefas].sort((a, b) => Number(a.done) - Number(b.done));

  async function alternar(t: Evento) {
    await supabase.from("events").update({ done: !t.done }).eq("id", t.id);
    onMudou();
  }

  return (
    <section className="tarefas">
      {ordenadas.map((t) => (
        <div key={t.id} className={`tarefa ctx-${t.context} ${t.done ? "feita" : ""}`}>
          <button className="caixa" aria-label={t.done ? "Reabrir" : "Concluir"} onClick={() => alternar(t)}>
            {t.done && "✓"}
          </button>
          <button className="corpo" onClick={() => onAbrir(t)}>
            <span className="titulo">{t.title}</span>
            <span className="meta">
              {!t.all_day && `${hora(t.starts_at)} · `}
              {t.effort != null && `${t.effort}% · `}
              {t.context}
            </span>
          </button>
        </div>
      ))}
    </section>
  );
}
