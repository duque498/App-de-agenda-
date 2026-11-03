import type { Evento } from "../lib/supabase";
import { diaDe, formatarDia, hojeISO, hora } from "../lib/dates";

type Props = { eventos: Evento[]; onAbrir: (e: Evento) => void };

// "Agenda" do Google: tudo que vem pela frente, agrupado por dia. Sem grade, só a sequência.
export function VisaoLista({ eventos, onAbrir }: Props) {
  const hoje = hojeISO();
  const grupos = new Map<string, Evento[]>();
  for (const e of eventos) {
    const d = diaDe(e.starts_at);
    grupos.set(d, [...(grupos.get(d) ?? []), e]);
  }
  const dias = [...grupos.keys()].sort();

  if (dias.length === 0) {
    return (
      <section className="lista-view vazia">
        <p>Nada marcado nas próximas duas semanas.</p>
        <p className="texto">Toca em + pra criar um bloco, ou pede pra IA em "Mudar o dia".</p>
      </section>
    );
  }

  return (
    <section className="lista-view">
      {dias.map((d) => (
        <div key={d} className="lista-dia">
          <h3 className={d === hoje ? "hoje" : ""}>{d === hoje ? "Hoje" : formatarDia(d)}</h3>
          {grupos.get(d)!.map((e) => (
            <button key={e.id} className={`lista-item ctx-${e.context}`} onClick={() => onAbrir(e)}>
              <span className="quando">
                {e.all_day ? "dia todo" : hora(e.starts_at)}
                {!e.all_day && e.ends_at && <small>{hora(e.ends_at)}</small>}
              </span>
              <span className="oque">
                {e.title}
                {e.effort != null && <small>{e.effort}% esforço</small>}
              </span>
            </button>
          ))}
        </div>
      ))}
    </section>
  );
}
