import { useEffect, useMemo, useState } from "react";

// Renderiza Markdown com sanitização. As libs (marked + DOMPurify, ~60 KB) são carregadas
// sob demanda na primeira vez que um texto aparece; até lá mostra o texto puro.
// Isso tira as duas do bundle inicial e a primeira tela aparece antes.
type Libs = { marked: typeof import("marked").marked; purify: typeof import("dompurify").default };
let libs: Libs | null = null;
let carregando: Promise<Libs> | null = null;

function carregarLibs(): Promise<Libs> {
  if (libs) return Promise.resolve(libs);
  if (!carregando) {
    carregando = Promise.all([import("marked"), import("dompurify")]).then(([m, d]) => {
      m.marked.setOptions({ breaks: true, gfm: true });
      libs = { marked: m.marked, purify: d.default };
      return libs;
    });
  }
  return carregando;
}

export function Md({ texto, className = "" }: { texto: string; className?: string }) {
  const [pronto, setPronto] = useState(!!libs);
  useEffect(() => {
    if (!libs) carregarLibs().then(() => setPronto(true));
  }, []);

  // Mesmo texto, mesmo HTML: evita reprocessar a cada render.
  const html = useMemo(() => (pronto && libs ? libs.purify.sanitize(libs.marked.parse(texto) as string) : null), [texto, pronto]);

  if (html === null) return <div className={`md ${className}`} style={{ whiteSpace: "pre-wrap" }}>{texto}</div>;
  return <div className={`md ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
