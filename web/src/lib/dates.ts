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

// Segunda-feira da semana que contém o dia (semana começa na segunda, padrão BR).
export function inicioDaSemana(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = domingo
  return addDias(iso, dow === 0 ? -6 : 1 - dow);
}

// 42 células (6 semanas) cobrindo o mês do dia dado, começando na segunda.
export function gradeDoMes(iso: string): { dias: string[]; mes: number } {
  const [y, m] = iso.split("-").map(Number);
  const primeiro = `${y}-${String(m).padStart(2, "0")}-01`;
  const inicio = inicioDaSemana(primeiro);
  return { dias: Array.from({ length: 42 }, (_, i) => addDias(inicio, i)), mes: m };
}

export function diaSemanaCurto(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "short" })
    .format(new Date(Date.UTC(y, m - 1, d)))
    .replace(".", "");
}

export function mesAno(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", month: "long", year: "numeric" }).format(
    new Date(Date.UTC(y, m - 1, 1)),
  );
}

// Dia (YYYY-MM-DD em SP) de um timestamp.
export function diaDe(ts: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(ts));
}
