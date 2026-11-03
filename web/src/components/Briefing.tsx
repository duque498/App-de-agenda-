import { useState } from "react";
import type { Brief } from "../lib/supabase";

// O herói da tela: a sugestão do dia em destaque. Detalhes ficam dobrados.
export function Briefing({ brief, streak }: { brief: Brief | null; streak: number | null }) {
  const [aberto, setAberto] = useState(false);

  if (!brief) {
    return (
      <section className="briefing vazio">
        <p className="sugestao">O resumo das 14h ainda não chegou.</p>
        <p className="linha-meta">Curso: {streak ?? 0} {streak === 1 ? "dia seguido" : "dias seguidos"}</p>
      </section>
    );
  }

  const prs = brief.github.prs_abertas ?? [];
  const reviews = brief.github.reviews_pendentes ?? [];
  const emails = brief.gmail ?? [];
  const curso = brief.course ?? {};
  const pendencias = prs.length + reviews.length + emails.length;

  return (
    <section className="briefing">
      <p className="sugestao">{brief.suggestion || "Sem sugestão hoje."}</p>

      <p className="linha-meta">
        {pendencias === 0 ? "Nada pendente na Medweb" : `${pendencias} ${pendencias === 1 ? "pendência" : "pendências"} na Medweb`}
        {curso.proximo_modulo && <> · próximo módulo: {curso.proximo_modulo}</>}
        {" · "}curso: {streak ?? 0} {streak === 1 ? "dia seguido" : "dias seguidos"}
      </p>

      {pendencias > 0 && (
        <button className="texto" onClick={() => setAberto(!aberto)}>
          {aberto ? "Esconder detalhes" : "Ver detalhes"}
        </button>
      )}

      {aberto && (
        <ul className="pendencias">
          {reviews.map((r) => (
            <li key={`r${r.repo}${r.numero}`} className="review">
              Review pedido em {r.repo}#{r.numero}: {r.titulo}
              {r.pedido && <small>{r.pedido}</small>}
            </li>
          ))}
          {prs.map((p) => (
            <li key={`p${p.repo}${p.numero}`}>
              PR aberta {p.repo}#{p.numero}: {p.titulo}
            </li>
          ))}
          {emails.map((m, i) => (
            <li key={`e${i}`}>
              E-mail de {m.de}: {m.assunto}
              <small>{m.acao}</small>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
