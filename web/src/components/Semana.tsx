import { addDias, hojeISO } from "../lib/dates";

// Faixa de 7 dias centrada no dia escolhido. Toque troca o dia; o de hoje fica marcado.
export function Semana({ dia, onEscolher }: { dia: string; onEscolher: (d: string) => void }) {
  const hoje = hojeISO();
  const dias = Array.from({ length: 7 }, (_, i) => addDias(dia, i - 3));

  return (
    <nav className="semana" aria-label="Dias">
      {dias.map((d) => {
        const [y, m, dd] = d.split("-").map(Number);
        const data = new Date(Date.UTC(y, m - 1, dd));
        const semana = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "short" })
          .format(data)
          .replace(".", "");
        return (
          <button
            key={d}
            className={`dia ${d === dia ? "ativo" : ""} ${d === hoje ? "hoje" : ""}`}
            onClick={() => onEscolher(d)}
          >
            <span>{semana}</span>
            <strong>{dd}</strong>
          </button>
        );
      })}
    </nav>
  );
}
