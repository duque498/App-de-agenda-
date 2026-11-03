import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, type Brief, type Evento, type Tipo } from "./lib/supabase";
import { addDias, formatarDia, gradeDoMes, hojeISO, inicioDaSemana, limitesDoDia, mesAno } from "./lib/dates";
import { Login } from "./components/Login";
import { Briefing } from "./components/Briefing";
import { Semana } from "./components/Semana";
import { Timeline } from "./components/Timeline";
import { VisaoSemana } from "./components/VisaoSemana";
import { VisaoMes } from "./components/VisaoMes";
import { VisaoLista } from "./components/VisaoLista";
import { VisaoGrade } from "./components/VisaoGrade";
import { EditorEvento } from "./components/EditorEvento";
import { Detalhe } from "./components/Detalhe";
import { Tarefas } from "./components/Tarefas";
import { Perfil } from "./components/Perfil";
import { Tobias } from "./components/Tobias";
import { PushToggle } from "./components/PushToggle";

type Visao = "dia" | "semana" | "mes" | "grade" | "lista" | "tobias";
type Editor = { evento: Evento | null; tipo: Tipo; horaInicial?: string } | null;

const VISOES: { id: Visao; rotulo: string }[] = [
  { id: "dia", rotulo: "Dia" },
  { id: "semana", rotulo: "Semana" },
  { id: "mes", rotulo: "Mês" },
  { id: "grade", rotulo: "Grade" },
  { id: "lista", rotulo: "Lista" },
  { id: "tobias", rotulo: "Tobias" },
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
  if (visao === "tobias") return limitesDoDia(dia);
  if (visao === "grade") return { inicio: limitesDoDia(dia).inicio, fim: limitesDoDia(addDias(dia, 13)).fim };
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
  const [detalhe, setDetalhe] = useState<Evento | null>(null);
  const [menuNovo, setMenuNovo] = useState(false);
  const [perfilAberto, setPerfilAberto] = useState(false);

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
  const abrir = (e: Evento) => setDetalhe(e);
  // Na timeline entram eventos e tarefas com hora marcada; tarefas sem hora ficam só na lista do dia.
  const naTimeline = eventos.filter((e) => e.kind === "evento" || !e.all_day);
  const tarefasDoDia = eventos.filter((e) => e.kind === "tarefa");

  // Título e navegação mudam com a visão: passo de 1 dia, 7 dias ou 1 mês.
  const titulo =
    visao === "tobias" ? "T.O.B.I.A.S."
    : visao === "mes" ? mesAno(dia)
    : visao === "lista" ? "Próximos dias"
    : visao === "grade" ? `A partir de ${Number(dia.slice(8))}`
    : visao === "semana" ? `Semana de ${Number(inicioDaSemana(dia).slice(8))}`
    : ehHoje ? "Hoje" : formatarDia(dia).split(",")[0];
  const passo = visao === "semana" ? 7 : visao === "mes" ? 30 : visao === "grade" ? 14 : 1;

  return (
    <main className="app">
      <header className="cabecalho">
        <div className="cabecalho-titulo">
          {visao !== "lista" && visao !== "tobias" && <button className="nav" onClick={() => setDia(addDias(dia, -passo))} aria-label="Anterior">‹</button>}
          <div onClick={() => setDia(hojeISO())}>
            <h1>{titulo}</h1>
            {visao === "dia" && <small>{formatarDia(dia)}</small>}
          </div>
          {visao !== "lista" && visao !== "tobias" && <button className="nav" onClick={() => setDia(addDias(dia, passo))} aria-label="Próximo">›</button>}
        </div>
        <div className="cabecalho-acoes">
          <PushToggle />
          <button className="texto" onClick={() => setPerfilAberto(true)}>Sobre mim</button>
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
          <Tarefas tarefas={tarefasDoDia} onAbrir={abrir} onMudou={carregar} />
          <Timeline
            dia={dia}
            eventos={naTimeline}
            onAbrir={abrir}
            onNovo={(horaInicial) => setEditor({ evento: null, tipo: "evento", horaInicial })}
          />
        </>
      )}
      {visao === "semana" && <VisaoSemana dia={dia} eventos={naTimeline} onAbrir={abrir} onDia={irPara} />}
      {visao === "mes" && <VisaoMes dia={dia} eventos={eventos} onDia={irPara} />}
      {visao === "grade" && <VisaoGrade dia={dia} eventos={eventos} onAbrir={abrir} onDia={irPara} />}
      {visao === "lista" && <VisaoLista eventos={eventos} onAbrir={abrir} />}
      {visao === "tobias" && <Tobias onMudouAgenda={carregar} />}

      <div className={`fabs ${visao === "tobias" ? "escondido" : ""}`}>
        <button className="fab secundario" onClick={() => setVisao("tobias")}>Tobias</button>
        <button className={`fab ${menuNovo ? "aberto" : ""}`} onClick={() => setMenuNovo(!menuNovo)} aria-label="Criar">+</button>
      </div>

      {menuNovo && (
        <div className="menu-novo" onClick={() => setMenuNovo(false)}>
          <div className="opcoes" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => { setMenuNovo(false); setEditor({ evento: null, tipo: "evento" }); }}>
              <strong>Evento</strong>
              <small>Ocupa um horário na timeline</small>
            </button>
            <button onClick={() => { setMenuNovo(false); setEditor({ evento: null, tipo: "tarefa" }); }}>
              <strong>Tarefa</strong>
              <small>Algo a fazer no dia, hora opcional</small>
            </button>
          </div>
        </div>
      )}

      {detalhe && !editor && (
        <Detalhe
          evento={detalhe}
          onFechar={() => setDetalhe(null)}
          onEditar={() => setEditor({ evento: detalhe, tipo: detalhe.kind })}
          onMudou={carregar}
        />
      )}

      {editor && (
        <EditorEvento
          dia={dia}
          evento={editor.evento}
          tipo={editor.tipo}
          horaInicial={editor.horaInicial}
          onFechar={() => setEditor(null)}
          onSalvo={() => { setEditor(null); setDetalhe(null); carregar(); }}
          onAvaliado={carregar}
        />
      )}

      {perfilAberto && <Perfil onFechar={() => setPerfilAberto(false)} />}

    </main>
  );
}
