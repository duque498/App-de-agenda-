import { useState } from "react";
import { supabase } from "../lib/supabase";
import { hojeISO } from "../lib/dates";

// Lembrete solto, sem evento: "me lembra às 16h de ligar pro dentista".
export function EditorLembrete({ dia, onFechar, onSalvo }: { dia: string; onFechar: () => void; onSalvo: () => void }) {
  const [title, setTitle] = useState("");
  const [data, setData] = useState(dia || hojeISO());
  const [hora, setHora] = useState("09:00");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const quando = new Date(`${data}T${hora}:00-03:00`);
    if (quando.getTime() <= Date.now()) return setErro("Esse horário já passou.");
    setSalvando(true);
    const { error } = await supabase.from("reminders").insert({ title: title.trim(), body: null, remind_at: quando.toISOString() });
    setSalvando(false);
    if (error) return setErro(error.message);
    onSalvo();
  }

  return (
    <div className="gaveta aberta">
      <div className="gaveta-fundo" onClick={onFechar} />
      <form className="gaveta-painel editor" onSubmit={salvar}>
        <header>
          <h2>Novo lembrete</h2>
          <button type="button" className="texto" onClick={onFechar}>Fechar</button>
        </header>
        <input autoFocus placeholder="Do quê?" value={title} onChange={(e) => setTitle(e.target.value)} required />
        <div className="linha">
          <label>Data<input type="date" value={data} onChange={(e) => setData(e.target.value)} required /></label>
          <label>Hora<input type="time" value={hora} onChange={(e) => setHora(e.target.value)} required /></label>
        </div>
        {erro && <p className="msg erro">{erro}</p>}
        <div className="acoes">
          <button disabled={salvando}>Criar</button>
        </div>
      </form>
    </div>
  );
}
