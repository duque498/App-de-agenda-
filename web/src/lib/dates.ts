// Tudo em America/Sao_Paulo explicitamente. Confiar no fuso do aparelho
// quebra no dia em que tu abre o app viajando.
const TZ = "America/Sao_Paulo";

export function hojeISO(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date()); // YYYY-MM-DD
}

export function addDias(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export function formatarDia(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function hora(ts: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(
    new Date(ts),
  );
}

// Limites do dia em UTC pra filtrar events.starts_at no banco.
export function limitesDoDia(iso: string): { inicio: string; fim: string } {
  // Offset de SP é fixo em -03:00 desde 2019 (sem horário de verão).
  return { inicio: `${iso}T00:00:00-03:00`, fim: `${iso}T23:59:59-03:00` };
}
