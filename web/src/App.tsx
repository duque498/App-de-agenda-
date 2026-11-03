import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, type Brief, type Evento } from "./lib/supabase";
import { addDias, formatarDia, hojeISO, limitesDoDia } from "./lib/dates";
import { Login } from "./components/Login";
import { BriefCard } from "./components/BriefCard";
import { Blocos } from "./components/Blocos";
import { PushToggle } from "./components/PushToggle";

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  // ?dia=YYYY-MM-DD vem da notificação; sem isso, hoje.
  const [dia, setDia] = useState(() => new URLSearchParams(location.search).get("dia") ?? hojeISO());
  const [brief, setBrief] = useState<Brief | null>(null);
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [streak, setStreak] = useState<number | null>(null);

  // Sessão: carrega a atual e escuta mudanças (login, logout, refresh do token).
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const carregar = useCallback(async () => {
    const { inicio, fim } = limitesDoDia(dia);
    // Três consultas em paralelo: são independentes, não faz sentido esperar uma pela outra.
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

  if (session === undefined) return null;
  if (!session) return <Login />;

  const ehHoje = dia === hojeISO();

  return (
    <main className="app">
      <header className="topo">
        <button className="mini" onClick={() => setDia(addDias(dia, -1))}>‹</button>
        <div className="titulo" onClick={() => setDia(hojeISO())}>
          <h1>{ehHoje ? "Hoje" : formatarDia(dia)}</h1>
          {ehHoje && <small>{formatarDia(dia)}</small>}
        </div>
        <button className="mini" onClick={() => setDia(addDias(dia, 1))}>›</button>
      </header>

      <div className="faixa">
        <span className="streak" title="dias seguidos avançando no curso">
          🔥 {streak ?? "…"}
        </span>
        <PushToggle />
        <button className="link" onClick={() => supabase.auth.signOut()}>sair</button>
      </div>

      <BriefCard brief={brief} />
      <Blocos dia={dia} eventos={eventos} onMudou={carregar} />
    </main>
  );
}
