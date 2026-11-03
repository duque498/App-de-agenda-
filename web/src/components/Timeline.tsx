import { useEffect, useState } from "react";
import type { Evento } from "../lib/supabase";
import { hora, hojeISO } from "../lib/dates";

const INICIO = 7; // 07h
const FIM = 23; // 23h
const ALTURA_HORA = 56; // px por hora

// Minutos desde INICIO:00 no fuso de SP, pra posicionar um instante na régua.
function minutosDesdeInicio(ts: string | Date) {
  const d = typeof ts === "string" ? new Date(ts) : ts;
  const partes = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const h = Number(partes.find((p) => p.type === "hour")!.value);
  const m = Number(partes.find((p) => p.type === "minute")!.value);
  return (h - INICIO) * 60 + m;
}

type Props = {
  dia: string;
  eventos: Evento[];
  onAbrir: (e: Evento) => void;
  onNovo: (horaInicio: string) => void;
};

export function Timeline({ dia, eventos, onAbrir, onNovo }: Props) {
  const [agora, setAgora] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setAgora(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const horas = Array.from({ length: FIM - INICIO + 1 }, (_, i) => INICIO + i);
  const alturaTotal = (FIM - INICIO) * ALTURA_HORA;
  const ehHoje = dia === hojeISO();
  const yAgora = (minutosDesdeInicio(agora) / 60) * ALTURA_HORA;
  const diaInteiro = eventos.filter((e) => e.all_day);
  const comHora = eventos.filter((e) => !e.all_day);

  return (
    <section className="timeline" aria-label="Linha do tempo do dia">
      {diaInteiro.length > 0 && (
        <div className="dia-inteiro">
          {diaInteiro.map((e) => (
            <button key={e.id} className={`chip ctx-${e.context}`} onClick={() => onAbrir(e)}>
              {e.title}
            </button>
          ))}
        </div>
      )}

      <div className="regua" style={{ height: alturaTotal }}>
        {horas.map((h) => (
          <div
            key={h}
            className="marca"
            style={{ top: (h - INICIO) * ALTURA_HORA }}
            onClick={() => onNovo(`${String(h).padStart(2, "0")}:00`)}
          >
            <span>{String(h).padStart(2, "0")}</span>
          </div>
        ))}

        {comHora.map((e) => {
          const ini = Math.max(0, minutosDesdeInicio(e.starts_at));
          const fim = e.ends_at ? minutosDesdeInicio(e.ends_at) : ini + 45;
          const top = (ini / 60) * ALTURA_HORA;
          const altura = Math.max(28, ((fim - ini) / 60) * ALTURA_HORA);
          return (
            <button
              key={e.id}
              className={`bloco ctx-${e.context} ${e.source === "ia" ? "da-ia" : ""}`}
              style={{ top, height: altura }}
              onClick={() => onAbrir(e)}
            >
              <span className="bloco-hora">
                {hora(e.starts_at)}
                {e.ends_at && ` – ${hora(e.ends_at)}`}
              </span>
              <span className="bloco-titulo">{e.title}</span>
            </button>
          );
        })}

        {ehHoje && yAgora >= 0 && yAgora <= alturaTotal && (
          <div className="agora" style={{ top: yAgora }}>
            <i />
          </div>
        )}
      </div>
    </section>
  );
}
