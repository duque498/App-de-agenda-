import { supabase, type Lembrete } from "../lib/supabase";
import { hora } from "../lib/dates";

// Lembretes avulsos do dia (os ligados a evento aparecem no próprio evento).
export function Lembretes({ lembretes, onMudou }: { lembretes: Lembrete[]; onMudou: () => void }) {
  const avulsos = lembretes.filter((l) => !l.event_id);
  if (avulsos.length === 0) return null;
  async function remover(id: string) {
    await supabase.from("reminders").delete().eq("id", id);
    onMudou();
  }
  return (
    <section className="lembretes">
      {avulsos.map((l) => (
        <div key={l.id} className={`lembrete ${l.sent_at ? "enviado" : ""}`}>
          <span className="sino">🔔</span>
          <span className="corpo"><strong>{hora(l.remind_at)}</strong> {l.title}</span>
          <button className="texto" onClick={() => remover(l.id)} aria-label="Remover">×</button>
        </div>
      ))}
    </section>
  );
}
