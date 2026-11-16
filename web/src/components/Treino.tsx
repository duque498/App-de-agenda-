import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type Hoje = { plano_id: string; nome: string; semana: number; proxima_sessao: string; ultima_sessao: string | null; ultimo_treino: string | null };
type Ex = { sessao: string; ordem: number; exercicio: string; prescricao: Record<string, string>; obs: string | null };

const NOMES: Record<string, string> = { A: "Peito e tríceps", B: "Costas e bíceps", C: "Ombro e trapézio", D: "Pernas" };
const ORDEM = ["A", "B", "C", "D"];

// Cartão do treino da Antifofista: próxima sessão na rotação, semana da periodização e a
// lista de exercícios com a prescrição da semana. "Feito" registra e avança a rotação.
export function Treino({ dia }: { dia: string }) {
  const [hoje, setHoje] = useState<Hoje | null>(null);
  const [exs, setExs] = useState<Ex[]>([]);
  const [aberto, setAberto] = useState(false);
  const [sessao, setSessao] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function carregar() {
    const { data: t } = await supabase.from("treino_hoje").select("*").maybeSingle();
    setHoje((t as Hoje) ?? null);
    if (!t) return;
    const { data } = await supabase.from("plano_exercicios").select("sessao,ordem,exercicio,prescricao,obs").eq("plano_id", t.plano_id).order("ordem");
    setExs((data as Ex[]) ?? []);
  }
  useEffect(() => { carregar(); }, []);

  if (!hoje) return null;
  const atual = sessao ?? hoje.proxima_sessao;
  const sem = String(hoje.semana);
  const principais = exs.filter((e) => e.sessao === atual);
  const extras = exs.filter((e) => e.sessao === "ABD" || e.sessao === "CARDIO");
  const jaFezHoje = hoje.ultimo_treino === dia;

  async function feito() {
    if (salvando || !confirm(`Registrar treino ${atual} em ${dia}?`)) return;
    setSalvando(true);
    await supabase.from("treinos_feitos").insert({ plano_id: hoje!.plano_id, dia, sessao: atual, semana: hoje!.semana });
    setSalvando(false);
    setSessao(null);
    await carregar();
  }

  return (
    <section className={`treino ${aberto ? "aberto" : ""}`}>
      <button className="treino-topo" onClick={() => setAberto((a) => !a)}>
        <span className="letra">{atual}</span>
        <span className="info">
          <strong>{jaFezHoje ? `Treino ${hoje.ultima_sessao} feito hoje` : `Treino ${atual} — ${NOMES[atual]}`}</strong>
          <small>Semana {hoje.semana}/6 · {principais[0]?.prescricao[sem] ?? ""} · abd + cardio 20'</small>
        </span>
        <span className="seta">{aberto ? "▴" : "▾"}</span>
      </button>
      {aberto && (
        <div className="treino-corpo">
          <div className="treino-sessoes">
            {ORDEM.map((s) => (
              <button key={s} className={`chip ${s === atual ? "ativo" : ""}`} onClick={() => setSessao(s)}>{s}</button>
            ))}
            <span className="mudo">{hoje.ultimo_treino ? `último: ${hoje.ultima_sessao} em ${hoje.ultimo_treino.slice(8)}/${hoje.ultimo_treino.slice(5, 7)}` : "nenhum registrado"}</span>
          </div>
          <ol>
            {principais.map((e) => (
              <li key={e.exercicio}>
                <span>{e.exercicio}</span>
                <b>{e.prescricao[sem]}</b>
                {e.obs && <small>{e.obs}</small>}
              </li>
            ))}
            {extras.map((e) => (
              <li key={e.exercicio} className="extra">
                <span>{e.exercicio}</span>
                <b>{e.prescricao[sem]}</b>
              </li>
            ))}
          </ol>
          <p className="mudo">Aquecer com ~30% da carga, 90 s de descanso, 0–1 rep na reserva.</p>
          <div className="acoes">
            <button disabled={salvando || jaFezHoje} onClick={feito}>{jaFezHoje ? "Já registrado" : `Feito o ${atual}`}</button>
          </div>
        </div>
      )}
    </section>
  );
}
