import { useState } from "react";
import { supabase, type Evento } from "../lib/supabase";
import { avaliarEsforco } from "../lib/assistente";
import { formatarDia, hora, diaDe } from "../lib/dates";
import { Md } from "./Md";

const ROTULO = { trabalho: "Trabalho", escola: "Escola", curso: "Curso", pessoal: "Pessoal" };

type Props = { evento: Evento; onFechar: () => void; onEditar: () => void; onMudou: () => void };

// Folha de leitura: o que é, quando, o que a IA achou. Editar é um passo à parte.
export function Detalhe({ evento, onFechar, onEditar, onMudou }: Props) {
  const [ev, setEv] = useState(evento);
  const [avaliando, setAvaliando] = useState(false);
  const [erro, setErro] = useState("");

  async function avaliar() {
    setAvaliando(true);
    setErro("");
    try {
      setEv(await avaliarEsforco(ev.id));
      onMudou();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setAvaliando(false);
    }
  }

  async function alternarConcluida() {
    const { data } = await supabase.from("events").update({ done: !ev.done }).eq("id", ev.id).select().single();
    if (data) setEv(data as Evento);
    onMudou();
  }

  const quando = ev.all_day
    ? "dia inteiro"
    : `${hora(ev.starts_at)}${ev.ends_at ? ` – ${hora(ev.ends_at)}` : ""}`;
  const tarefa = ev.kind === "tarefa";

  return (
    <div className="gaveta aberta">
      <div className="gaveta-fundo" onClick={onFechar} />
      <section className={`gaveta-painel detalhe ctx-${ev.context}`}>
        <header>
          <span className="rotulo-tipo">{tarefa ? "Tarefa" : "Evento"} · {ROTULO[ev.context]}</span>
          <button className="texto" onClick={onFechar}>Fechar</button>
        </header>

        <h2 className={ev.done ? "feita" : ""}>{ev.title}</h2>
        <p className="quando">
          <span className="data">{formatarDia(diaDe(ev.starts_at))}</span>
          {tarefa && ev.all_day ? "" : ` · ${quando}`}
          {tarefa && ev.all_day && " · sem hora marcada"}
        </p>

        {ev.notes && <Md texto={ev.notes} className="notas" />}

        <section className="esforco">
          {ev.effort != null ? (
            <>
              <div className="esforco-cabeca">
                <strong>{ev.effort}% de esforço</strong>
                <button className="texto" onClick={avaliar} disabled={avaliando}>
                  {avaliando ? "Reavaliando…" : "Reavaliar"}
                </button>
              </div>
              <div className={`barra ${ev.effort > 70 ? "alta" : ev.effort > 45 ? "media" : ""}`}>
                <i style={{ width: `${ev.effort}%` }} />
              </div>
              {ev.ai_brief && <Md texto={ev.ai_brief} className="brief" />}
              {ev.ai_tips?.length > 0 && (
                <ul className="dicas">{ev.ai_tips.map((t, i) => <li key={i}><Md texto={t} /></li>)}</ul>
              )}
            </>
          ) : (
            <button className="texto" onClick={avaliar} disabled={avaliando}>
              {avaliando ? "Avaliando…" : "Avaliar esforço com IA"}
            </button>
          )}
          {erro && <p className="msg erro">{erro}</p>}
        </section>

        <div className="acoes">
          {tarefa && (
            <button className={`concluir ${ev.done ? "desfazer" : ""}`} onClick={alternarConcluida}>
              {ev.done ? "Reabrir" : "Concluir"}
            </button>
          )}
          <button className="editar" onClick={onEditar}>Editar</button>
        </div>
      </section>
    </div>
  );
}
