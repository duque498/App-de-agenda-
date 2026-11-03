import type { Evento } from "../lib/supabase";
import { diaDe, gradeDoMes, hojeISO } from "../lib/dates";

const SEMANA = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];

type Props = { dia: string; eventos: Evento[]; onDia: (d: string) => void };

// Grade mensal: um ponto por evento (cor do contexto, até 4). Tocar no dia abre a visão do dia.
export function VisaoMes({ dia, eventos, onDia }: Props) {
  const { dias, mes } = gradeDoMes(dia);
  const hoje = hojeISO();
  const porDia = new Map<string, Evento[]>();
  for (const e of eventos) {
    const d = diaDe(e.starts_at);
    porDia.set(d, [...(porDia.get(d) ?? []), e]);
  }

  return (
    <section className="mes-view">
      <div className="mes-semana">
        {SEMANA.map((s) => <span key={s}>{s}</span>)}
      </div>
      <div className="mes-grade">
        {dias.map((d) => {
          const evs = porDia.get(d) ?? [];
          const foraDoMes = Number(d.slice(5, 7)) !== mes;
          return (
            <button
              key={d}
              className={`celula ${foraDoMes ? "fora" : ""} ${d === hoje ? "hoje" : ""} ${d === dia ? "ativo" : ""}`}
              onClick={() => onDia(d)}
            >
              <strong>{Number(d.slice(8))}</strong>
              <span className="pontos">
                {evs.slice(0, 4).map((e) => <i key={e.id} className={`ctx-${e.context}`} />)}
                {evs.length > 4 && <small>+{evs.length - 4}</small>}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
