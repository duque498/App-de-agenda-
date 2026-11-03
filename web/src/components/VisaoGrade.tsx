import type { Evento } from "../lib/supabase";
import { addDias, diaDe, diaSemanaCurto, hojeISO, hora } from "../lib/dates";

type Props = { dia: string; eventos: Evento[]; onAbrir: (e: Evento) => void; onDia: (d: string) => void };

// Grade de cartões: 14 dias a partir do dia escolhido, dois por linha, com os itens por título.
// É a visão "o que vem por aí" com mais densidade que a lista, sem a régua de horas.
export function VisaoGrade({ dia, eventos, onAbrir, onDia }: Props) {
  const hoje = hojeISO();
  const dias = Array.from({ length: 14 }, (_, i) => addDias(dia, i));
  const porDia = new Map<string, Evento[]>();
  for (const e of eventos) {
    const d = diaDe(e.starts_at);
    porDia.set(d, [...(porDia.get(d) ?? []), e]);
  }

  return (
    <section className="grade-view">
      {dias.map((d) => {
        const itens = porDia.get(d) ?? [];
        return (
          <article key={d} className={`cartao ${d === hoje ? "hoje" : ""}`}>
            <header onClick={() => onDia(d)}>
              <span>{diaSemanaCurto(d)}</span>
              <strong>{Number(d.slice(8))}</strong>
            </header>
            {itens.length === 0 && <p className="mudo">—</p>}
            {itens.slice(0, 6).map((e) => (
              <button
                key={e.id}
                className={`item ctx-${e.context} ${e.kind === "tarefa" ? "tarefa" : ""} ${e.done ? "feita" : ""}`}
                onClick={() => onAbrir(e)}
              >
                {!e.all_day && <span className="h">{hora(e.starts_at)}</span>}
                <span className="t">{e.title}</span>
              </button>
            ))}
            {itens.length > 6 && <p className="mudo">+{itens.length - 6}</p>}
          </article>
        );
      })}
    </section>
  );
}
