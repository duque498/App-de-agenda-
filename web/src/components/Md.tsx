import { useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";

// Renderiza Markdown com sanitização. O texto vem da IA ou das suas notas —
// mesmo assim passa pelo DOMPurify: HTML cru de qualquer origem nunca entra direto no DOM.
marked.setOptions({ breaks: true, gfm: true });

export function Md({ texto, className = "" }: { texto: string; className?: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(texto) as string), [texto]);
  return <div className={`md ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
