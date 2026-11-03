import { createClient } from "@supabase/supabase-js";

// Variáveis VITE_* são embutidas no bundle em build time — por isso só a chave
// pública (anon/publishable) pode ficar aqui. A service role NUNCA entra no front.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
);

export type Contexto = "trabalho" | "escola" | "curso" | "pessoal";

export type Evento = {
  id: string;
  title: string;
  context: Contexto;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  notes: string | null;
  source: string;
};

export type Brief = {
  id: string;
  brief_date: string;
  github: {
    prs_abertas?: { repo: string; numero: number; titulo: string }[];
    reviews_pendentes?: { repo: string; numero: number; titulo: string; pedido?: string }[];
    issues?: { repo: string; numero: number; titulo: string }[];
  };
  gmail: { assunto: string; de: string; acao: string }[];
  course: { ultimo_modulo?: string; proximo_modulo?: string; dias_parado?: number };
  suggestion: string;
  raw_markdown: string | null;
};
