import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, type Brief, type Evento } from "./lib/supabase";
import { addDias, formatarDia, gradeDoMes, hojeISO, inicioDaSemana, limitesDoDia, mesAno } from "./lib/dates";
import { Login } from "./components/Login";
import { Briefing } from "./components/Briefing";
import { Semana } from "./components/Semana";
import { Timeline } from "./components/Timeline";
import { VisaoSemana } from "./components/VisaoSemana";
import { VisaoMes } from "./components/VisaoMes";
import { VisaoLista } from "./components/VisaoLista";
import { EditorEvento } from "./components/EditorEvento";
import { Chat } from "./components/Chat";
import { PushToggle } from "./components/PushToggle";

type Visao = "dia" | "semana" | "mes" | "lista";
type Editor = { evento: Evento | null; horaInicial?: string } | null;

const VISOES: { id: Visao; rotulo: string }[] = [
  { id: "dia", rotulo: "Dia" },
  { id: "semana", rotulo: "Semana" },
  { id: "mes", rotulo: "Mês" },
  { id: "lista", rotulo: "Lista" },
];

// Intervalo de eventos a carregar depende da visão: só o necessário, nada de baixar o ano inteiro.
function intervalo(visao: Visao, dia: string): { inicio: string; fim: string } {
  if (visao === "dia") return limitesDoDia(dia);
  if (visao === "semana") {
    const ini = inicioDaSemana(dia);
    return { inicio: limitesDoDia(ini).inicio, fim: limitesDoDia(addDias(ini, 6)).fim };
  }
  if (visao === "mes") {
    const { dias } = gradeDoMes(dia);
    return { inicio: limitesDoDia(dias[0]).inicio, fim: limitesDoDia(dias[41]).fim };
  }
  return { inicio: limitesDoDia(hojeISO()).inicio, fim: limitesDoDia(addDias(hojeISO(), 14)).fim };
}

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [dia, setDia] = useState(() => new URLSearchParams(location.search).get("dia") ?? hojeISO());
  const [visao, setVisao] = useState<Visao>(() => (localStorage.getItem("visao") as Visao) || "dia");
  const [brief, setBrief] = useState<Brief | null>(null);
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [streak, setStreak] = useState<number | null>(null);
  const [editor, setEditor] = useState<Editor>(null);
  const [chatAberto, setChatAberto] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    try { localStorage.setItem("visao", visao); } catch { /* modo privado */ }
  }, [visao]);

  const carregar = useCallback(async () => {
    const { inicio, fim } = intervalo(visao, dia);
    const [b, e, s] = await Promise.all([
      supabase.from("daily_briefs").select("*").eq("brief_date", dia).maybeSingle(),
      supabase.from("events").select("*").gte("starts_at", inicio).lte("starts_at", fim).order("starts_at"),
      supabase.from("course_streak").select("streak").maybeSingle(),
    ]);
    setBrief((b.data as Brief) ?? null);
    setEventos((e.data as Evento[]) ?? []);
    setStreak(s.data?.streak ?? 0);
  }, [dia, visao]);

  useEffect(() => {
    if (session) carregar();
  }, [session, carregar]);

  useEffect(() => {
    const f = () => document.visibilityState === "visible" && session && carregar();
    document.addEventListener("visibilitychange", f);
    return () => document.removeEventListener("visibilitychange", f);
  }, [session, carregar]);

  if (session === undefined) return null;
  if (!session) return <Login />;

  const ehHoje = dia === hojeISO();
  const irPara = (d: string) => { setDia(d); setVisao("dia"); };

  // Título e navegação mudam com a visão: passo de 1 dia, 7 dias ou 1 mês.
  const titulo =
    visao === "mes" ? mesAno(dia)
    : visao === "lista" ? "Próximos dias"
    : visao === "semana" ? `Semana de ${Number(inicioDaSemana(dia).slice(8))}`
    : ehHoje ? "Hoje" : formatarDia(dia).split(",")[0];
  const passo = visao === "semana" ? 7 : visao === "mes" ? 30 : 1;

  return (
    <main className="app">
      <header className="cabecalho">
        <div className="cabecalho-titulo">
          {visao !== "lista" && <button className="nav" onClick={() => setDia(addDias(dia, -passo))} aria-label="Anterior">‹</button>}
          <div onClick={() => setDia(hojeISO())}>
            <h1>{titulo}</h1>
            {visao === "dia" && <small>{formatarDia(dia)}</small>}
          </div>
          {visao !== "lista" && <button className="nav" onClick={() => setDia(addDias(dia, passo))} aria-label="Próximo">›</button>}
        </div>
        <div className="cabecalho-acoes">
          <PushToggle />
          <button className="texto" onClick={() => supabase.auth.signOut()}>Sair</button>
        </div>
      </header>

      <nav className="visoes" aria-label="Visualização">
        {VISOES.map((v) => (
          <button key={v.id} className={visao === v.id ? "ativo" : ""} onClick={() => setVisao(v.id)}>{v.rotulo}</button>
        ))}
      </nav>

      {visao === "dia" && (
        <>
          <Briefing brief={brief} streak={streak} />
          <Semana dia={dia} onEscolher={setDia} />
          <Timeline
            dia={dia}
            eventos={eventos}
            onAbrir={(evento) => setEditor({ evento })}
            onNovo={(horaInicial) => setEditor({ evento: null, horaInicial })}
          />
        </>
      )}
      {visao === "semana" && <VisaoSemana dia={dia} eventos={eventos} onAbrir={(evento) => setEditor({ evento })} onDia={irPara} />}
      {visao === "mes" && <VisaoMes dia={dia} eventos={eventos} onDia={irPara} />}
      {visao === "lista" && <VisaoLista eventos={eventos} onAbrir={(evento) => setEditor({ evento })} />}

      <div className="fabs">
        <button className="fab secundario" onClick={() => setChatAberto(true)}>Mudar o dia</button>
        <button className="fab" onClick={() => setEditor({ evento: null })} aria-label="Novo bloco">+</button>
      </div>

      {editor && (
        <EditorEvento
          dia={dia}
          evento={editor.evento}
          horaInicial={editor.horaInicial}
          onFechar={() => setEditor(null)}
          onSalvo={() => { setEditor(null); carregar(); }}
        />
      )}

      <Chat aberto={chatAberto} onFechar={() => setChatAberto(false)} onMudouAgenda={carregar} />
    </main>
  );
}
