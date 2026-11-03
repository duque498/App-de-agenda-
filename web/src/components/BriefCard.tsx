import type { Brief } from "../lib/supabase";

export function BriefCard({ brief }: { brief: Brief | null }) {
  if (!brief) {
    return (
      <section className="card brief vazio">
        <h2>Resumo das 14h</h2>
        <p>Ainda não chegou hoje.</p>
      </section>
    );
  }

  const prs = brief.github.prs_abertas ?? [];
  const reviews = brief.github.reviews_pendentes ?? [];
  const emails = brief.gmail ?? [];
  const curso = brief.course ?? {};

  return (
    <section className="card brief">
      <h2>Resumo das 14h</h2>

      {brief.suggestion && <p className="sugestao">▶ {brief.suggestion}</p>}

      <div className="grupo">
        <h3>Medweb</h3>
        {prs.length === 0 && reviews.length === 0 && <p className="mudo">Nada pendente no GitHub.</p>}
        {prs.map((p) => (
          <p key={`pr-${p.repo}-${p.numero}`}>
            <span className="tag">PR</span> {p.repo}#{p.numero} — {p.titulo}
          </p>
        ))}
        {reviews.map((r) => (
          <p key={`rv-${r.repo}-${r.numero}`}>
            <span className="tag alerta">review</span> {r.repo}#{r.numero} — {r.titulo}
            {r.pedido && <em> · {r.pedido}</em>}
          </p>
        ))}
        {emails.map((m, i) => (
          <p key={`em-${i}`}>
            <span className="tag">e-mail</span> {m.de}: {m.assunto} — <em>{m.acao}</em>
          </p>
        ))}
      </div>

      <div className="grupo">
        <h3>Curso web.dev</h3>
        {curso.proximo_modulo ? (
          <p>
            Próximo: <strong>{curso.proximo_modulo}</strong>
            {curso.dias_parado != null && curso.dias_parado > 3 && (
              <span className="tag alerta"> {curso.dias_parado}d parado</span>
            )}
          </p>
        ) : (
          <p className="mudo">Sem dados do curso.</p>
        )}
      </div>
    </section>
  );
}
