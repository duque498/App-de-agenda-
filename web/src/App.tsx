import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, type Brief, type Evento } from "./lib/supabase";
import { formatarDia, hojeISO, limitesDoDia } from "./lib/dates";
import { Login } from "./components/Login";
import { Briefing } from "./components/Briefing";
import { Semana } from "./components/Semana";
import { Timeline } from "./components/Timeline";
import { EditorEvento } from "./components/EditorEvento";
import { Chat } from "./components/Chat";
import { PushToggle } from "./components/PushToggle";

type Editor = { evento: Evento | null; horaInicial?: string } | null;

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [dia, setDia] = useState(() => new URLSearchParams(location.search).get("dia") ?? hojeISO());
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

  const carregar = useCallback(async () => {
    const { inicio, fim } = limitesDoDia(dia);
    const [b, e, s] = await Promise.all([
      supabase.from("daily_briefs").select("*").eq("brief_date", dia).maybeSingle(),
      supabase.from("events").select("*").gte("starts_at", inicio).lte("starts_at", fim).order("starts_at"),
      supabase.from("course_streak").select("streak").maybeSingle(),
    ]);
    setBrief((b.data as Brief) ?? null);
    setEventos((e.data as Evento[]) ?? []);
    setStreak(s.data?.streak ?? 0);
  }, [dia]);

  useEffect(() => {
    if (session) carregar();
  }, [session, carregar]);

  // Recarrega quando o app volta pro primeiro plano (iOS congela o PWA em background).
  useEffect(() => {
    const f = () => document.visibilityState === "visible" && session && carregar();
    document.addEventListener("visibilitychange", f);
    return () => document.removeEventListener("visibilitychange", f);
  }, [session, carregar]);

  if (session === undefined) return null;
  if (!session) return <Login />;

  const ehHoje = dia === hojeISO();

  return (
    <main className="app">
      <header className="cabecalho">
        <div>
          <h1 onClick={() => setDia(hojeISO())}>{ehHoje ? "Hoje" : formatarDia(dia).split(",")[0]}</h1>
          <small>{formatarDia(dia)}</small>
        </div>
        <div className="cabecalho-acoes">
          <PushToggle />
          <button className="texto" onClick={() => supabase.auth.signOut()}>Sair</button>
        </div>
      </header>

      <Briefing brief={brief} streak={streak} />
      <Semana dia={dia} onEscolher={setDia} />
      <Timeline
        dia={dia}
        eventos={eventos}
        onAbrir={(evento) => setEditor({ evento })}
        onNovo={(horaInicial) => setEditor({ evento: null, horaInicial })}
      />

      <button className="fab" onClick={() => setChatAberto(true)} aria-label="Falar com a agenda">
        Mudar o dia
      </button>

      {editor && (
        <EditorEvento
          dia={dia}
          evento={editor.evento}
          horaInicial={editor.horaInicial}
          onFechar={() => setEditor(null)}
          onSalvo={() => {
            setEditor(null);
            carregar();
          }}
        />
      )}

      <Chat aberto={chatAberto} onFechar={() => setChatAberto(false)} onMudouAgenda={carregar} />
    </main>
  );
}
