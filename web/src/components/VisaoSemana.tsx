import type { Evento } from "../lib/supabase";
import { addDias, diaDe, diaSemanaCurto, hojeISO, inicioDaSemana } from "../lib/dates";

const INICIO = 7;
const FIM = 23;
const ALTURA_HORA = 40; // mais compacto que a visão do dia

function minutos(ts: string) {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(ts));
  return (Number(p.find((x) => x.type === "hour")!.value) - INICIO) * 60 + Number(p.find((x) => x.type === "minute")!.value);
}

type Props = { dia: string; eventos: Evento[]; onAbrir: (e: Evento) => void; onDia: (d: string) => void };

// Sete colunas, uma por dia, blocos como faixas finas. Tocar no cabeçalho da coluna abre o dia.
export function VisaoSemana({ dia, eventos, onAbrir, onDia }: Props) {
  const inicio = inicioDaSemana(dia);
  const dias = Array.from({ length: 7 }, (_, i) => addDias(inicio, i));
  const hoje = hojeISO();
  const altura = (FIM - INICIO) * ALTURA_HORA;
  const horas = Array.from({ length: FIM - INICIO + 1 }, (_, i) => INICIO + i);

  return (
    <section className="semana-view">
      <div className="semana-cabecalho">
        <div className="canto" />
        {dias.map((d) => (
          <button key={d} className={`col-dia ${d === hoje ? "hoje" : ""} ${d === dia ? "ativo" : ""}`} onClick={() => onDia(d)}>
            <span>{diaSemanaCurto(d)}</span>
            <strong>{Number(d.slice(8))}</strong>
          </button>
        ))}
      </div>

      <div className="semana-corpo" style={{ height: altura }}>
        <div className="horas">
          {horas.map((h) => (
            <span key={h} style={{ top: (h - INICIO) * ALTURA_HORA }}>{String(h).padStart(2, "0")}</span>
          ))}
        </div>
        {dias.map((d) => {
          const doDia = eventos.filter((e) => !e.all_day && diaDe(e.starts_at) === d);
          return (
            <div key={d} className={`coluna ${d === hoje ? "hoje" : ""}`} onClick={() => onDia(d)}>
              {horas.map((h) => <i key={h} className="linha-h" style={{ top: (h - INICIO) * ALTURA_HORA }} />)}
              {doDia.map((e) => {
                const ini = Math.max(0, minutos(e.starts_at));
                const fim = e.ends_at ? minutos(e.ends_at) : ini + 45;
                return (
                  <button
                    key={e.id}
                    className={`faixa ctx-${e.context}`}
                    style={{ top: (ini / 60) * ALTURA_HORA, height: Math.max(16, ((fim - ini) / 60) * ALTURA_HORA) }}
                    onClick={(ev) => { ev.stopPropagation(); onAbrir(e); }}
                    title={e.title}
                  >
                    {e.title}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </section>
  );
}
