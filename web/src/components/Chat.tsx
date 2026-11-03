import { useEffect, useRef, useState } from "react";
import { perguntar, textoDe, type ChatMsg } from "../lib/assistente";
import { Md } from "./Md";

type Props = { aberto: boolean; onFechar: () => void; onMudouAgenda: () => void };

const SUGESTOES = ["Organiza meu dia", "O que tenho amanhã?", "Bloqueia 1h de curso hoje à noite"];

export function Chat({ aberto, onFechar, onMudouAgenda }: Props) {
  const [historico, setHistorico] = useState<ChatMsg[]>([]);
  const [texto, setTexto] = useState("");
  const [pensando, setPensando] = useState(false);
  const [erro, setErro] = useState("");
  const fim = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fim.current?.scrollIntoView({ behavior: "smooth" });
  }, [historico, pensando]);

  async function enviar(t = texto) {
    if (!t.trim() || pensando) return;
    setTexto("");
    setErro("");
    setPensando(true);
    // Mostra a mensagem do usuário na hora; o histórico "oficial" vem da função.
    setHistorico((h) => [...h, { role: "user", content: t }]);
    try {
      const r = await perguntar(historico, t);
      setHistorico(r.historico);
      if (r.acoes.length) onMudouAgenda();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setPensando(false);
    }
  }

  // Só mensagens com texto visível (tool_result não aparece).
  const visiveis = historico.map((m) => ({ role: m.role, texto: textoDe(m) })).filter((m) => m.texto);

  return (
    <div className={`gaveta ${aberto ? "aberta" : ""}`} aria-hidden={!aberto}>
      <div className="gaveta-fundo" onClick={onFechar} />
      <section className="gaveta-painel">
        <header>
          <h2>Mudar o dia</h2>
          <button className="texto" onClick={onFechar}>Fechar</button>
        </header>

        <div className="mensagens">
          {visiveis.length === 0 && (
            <div className="sugestoes">
              {SUGESTOES.map((s) => (
                <button key={s} className="chip" onClick={() => enviar(s)}>{s}</button>
              ))}
            </div>
          )}
          {visiveis.map((m, i) =>
            m.role === "assistant" ? (
              <Md key={i} texto={m.texto} className="msg assistant" />
            ) : (
              <p key={i} className={`msg ${m.role}`}>{m.texto}</p>
            ),
          )}
          {pensando && <p className="msg assistant pensando">…</p>}
          {erro && <p className="msg erro">{erro}</p>}
          <div ref={fim} />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            enviar();
          }}
        >
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Ex.: move a reunião pra 16h"
            disabled={pensando}
          />
          <button disabled={pensando || !texto.trim()}>Enviar</button>
        </form>
      </section>
    </div>
  );
}
