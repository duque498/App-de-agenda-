import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

// O que a IA sabe sobre você. Texto livre, uma linha só no banco (perfil.id = 1).
export function Perfil({ onFechar }: { onFechar: () => void }) {
  const [texto, setTexto] = useState("");
  const [estado, setEstado] = useState<"carregando" | "pronto" | "salvando" | "salvo">("carregando");

  useEffect(() => {
    supabase.from("perfil").select("texto").eq("id", 1).maybeSingle().then(({ data }) => {
      setTexto(data?.texto ?? "");
      setEstado("pronto");
    });
  }, []);

  async function salvar() {
    setEstado("salvando");
    await supabase.from("perfil").upsert({ id: 1, texto, updated_at: new Date().toISOString() });
    setEstado("salvo");
    setTimeout(onFechar, 500);
  }

  return (
    <div className="gaveta aberta">
      <div className="gaveta-fundo" onClick={onFechar} />
      <section className="gaveta-painel perfil">
        <header>
          <h2>Sobre mim</h2>
          <button className="texto" onClick={onFechar}>Fechar</button>
        </header>
        <p className="texto">
          A IA lê isto toda vez que avalia esforço ou organiza o dia. Escreve o que ela precisa saber: rotina, o que te custa mais, o que é prioridade.
        </p>
        <textarea rows={12} value={texto} onChange={(e) => setTexto(e.target.value)} disabled={estado === "carregando"} />
        <div className="acoes">
          <button className="salvar" onClick={salvar} disabled={estado !== "pronto"}>
            {estado === "salvando" ? "Salvando…" : estado === "salvo" ? "Salvo" : "Salvar"}
          </button>
        </div>
      </section>
    </div>
  );
}
