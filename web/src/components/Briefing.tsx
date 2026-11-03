import { useState } from "react";
import type { Brief } from "../lib/supabase";
import { Md } from "./Md";

// Resumo das 14h, compacto: sugestão em destaque discreto, uma linha de contexto,
// e o resumo completo (raw_markdown) dobrado — abre quando você quer ler tudo.
export function Briefing({ brief, streak }: { brief: Brief | null; streak: number | null }) {
  const [aberto, setAberto] = useState(false);
  const streakTxt = `${streak ?? 0} ${streak === 1 ? "dia seguido" : "dias seguidos"}`;

  if (!brief) {
    return (
      <section className="briefing vazio">
        <p className="sugestao">O resumo das 14h ainda não chegou.</p>
        <p className="linha-meta">Curso: {streakTxt}</p>
      </section>
    );
  }

  const prs = brief.github.prs_abertas ?? [];
  const reviews = brief.github.reviews_pendentes ?? [];
  const issues = brief.github.issues ?? [];
  const emails = brief.gmail ?? [];
  const curso = brief.course ?? {};
  const pendencias = prs.length + reviews.length + emails.length;
  const temCompleto = !!brief.raw_markdown?.trim();

  return (
    <section className={`briefing ${aberto ? "aberto" : ""}`}>
      <Md texto={brief.suggestion?.trim() || "Sem sugestão hoje."} className="sugestao" />

      <p className="linha-meta">
        {pendencias === 0 ? "Nada pendente" : `${pendencias} ${pendencias === 1 ? "pendência" : "pendências"}`}
        {issues.length > 0 && ` · ${issues.length} issue${issues.length > 1 ? "s" : ""}`}
        {curso.proximo_modulo && ` · próximo: ${curso.proximo_modulo}`}
        {curso.dias_parado != null && curso.dias_parado > 3 && ` · ${curso.dias_parado}d parado`}
        {` · ${streakTxt}`}
      </p>

      {(temCompleto || pendencias > 0) && (
        <button className="texto abrir" onClick={() => setAberto(!aberto)} aria-expanded={aberto}>
          {aberto ? "Esconder resumo" : "Ver resumo completo"}
        </button>
      )}

      {aberto && (
        <div className="resumo-completo">
          {temCompleto ? (
            <Md texto={brief.raw_markdown!} />
          ) : (
            <ul className="pendencias">
              {reviews.map((r) => (
                <li key={`r${r.repo}${r.numero}`} className="review">
                  Review pedido em {r.repo}#{r.numero}: {r.titulo}
                  {r.pedido && <small>{r.pedido}</small>}
                </li>
              ))}
              {prs.map((p) => <li key={`p${p.repo}${p.numero}`}>PR aberta {p.repo}#{p.numero}: {p.titulo}</li>)}
              {emails.map((m, i) => (
                <li key={`e${i}`}>E-mail de {m.de}: {m.assunto}<small>{m.acao}</small></li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
