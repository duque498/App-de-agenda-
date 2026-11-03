import { useState } from "react";
import { supabase, type Contexto, type Evento } from "../lib/supabase";
import { hora } from "../lib/dates";

const CONTEXTOS: { id: Contexto; rotulo: string }[] = [
  { id: "trabalho", rotulo: "Trabalho" },
  { id: "escola", rotulo: "Escola" },
  { id: "curso", rotulo: "Curso" },
  { id: "pessoal", rotulo: "Pessoal" },
];

type Props = {
  dia: string;
  eventos: Evento[];
  onMudou: () => void;
};

// Agenda do dia agrupada por contexto, em vez de uma lista cronológica única.
// O objetivo é ver de cara "quanto do dia é Medweb, quanto é escola, quanto sobra".
export function Blocos({ dia, eventos, onMudou }: Props) {
  const [novo, setNovo] = useState<{ title: string; context: Contexto; inicio: string; fim: string } | null>(null);

  async function salvar() {
    if (!novo || !novo.title.trim()) return;
    const { error } = await supabase.from("events").insert({
      title: novo.title.trim(),
      context: novo.context,
      starts_at: `${dia}T${novo.inicio}:00-03:00`,
      ends_at: novo.fim ? `${dia}T${novo.fim}:00-03:00` : null,
    });
    if (error) alert(error.message);
    setNovo(null);
    onMudou();
  }

  async function remover(id: string) {
    if (!confirm("Remover?")) return;
    await supabase.from("events").delete().eq("id", id);
    onMudou();
  }

  return (
    <section className="blocos">
      {CONTEXTOS.map((c) => {
        const lista = eventos.filter((e) => e.context === c.id);
        return (
          <div key={c.id} className={`card bloco bloco-${c.id}`}>
            <header>
              <h3>{c.rotulo}</h3>
              <button
                className="mini"
                onClick={() => setNovo({ title: "", context: c.id, inicio: "09:00", fim: "" })}
              >
                +
              </button>
            </header>
            {lista.length === 0 && <p className="mudo">—</p>}
            {lista.map((e) => (
              <p key={e.id} className="evento" onClick={() => remover(e.id)}>
                <span className="hora">
                  {e.all_day ? "dia" : hora(e.starts_at)}
                  {e.ends_at && !e.all_day && `–${hora(e.ends_at)}`}
                </span>
                {e.title}
              </p>
            ))}
          </div>
        );
      })}

      {novo && (
        <div className="modal" onClick={() => setNovo(null)}>
          <div className="card" onClick={(e) => e.stopPropagation()}>
            <h3>Novo em {CONTEXTOS.find((c) => c.id === novo.context)?.rotulo}</h3>
            <input
              autoFocus
              placeholder="o quê?"
              value={novo.title}
              onChange={(e) => setNovo({ ...novo, title: e.target.value })}
            />
            <div className="linha">
              <input type="time" value={novo.inicio} onChange={(e) => setNovo({ ...novo, inicio: e.target.value })} />
              <input type="time" value={novo.fim} onChange={(e) => setNovo({ ...novo, fim: e.target.value })} />
            </div>
            <button onClick={salvar}>Salvar</button>
          </div>
        </div>
      )}
    </section>
  );
}
