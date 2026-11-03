import { useEffect, useState } from "react";
import { currentSubscription, isStandalone, pushSupported, subscribeToPush, unsubscribeFromPush } from "../lib/push";

export function PushToggle() {
  const [estado, setEstado] = useState<"carregando" | "ativo" | "inativo" | "bloqueado" | "instalar" | "sem-suporte">(
    "carregando",
  );

  useEffect(() => {
    (async () => {
      if (!pushSupported()) return setEstado(isStandalone() ? "sem-suporte" : "instalar");
      if (Notification.permission === "denied") return setEstado("bloqueado");
      setEstado((await currentSubscription()) ? "ativo" : "inativo");
    })();
  }, []);

  async function alternar() {
    if (estado === "ativo") {
      await unsubscribeFromPush();
      setEstado("inativo");
    } else {
      const r = await subscribeToPush();
      setEstado(r === "ok" ? "ativo" : r === "negado" ? "bloqueado" : "sem-suporte");
    }
  }

  if (estado === "carregando") return null;
  if (estado === "instalar")
    return (
      <p className="aviso">
        Pra receber notificações no iPhone: Compartilhar → <strong>Adicionar à Tela de Início</strong>, e abre por lá.
      </p>
    );
  if (estado === "sem-suporte") return <p className="aviso">Este navegador não suporta push.</p>;
  if (estado === "bloqueado")
    return <p className="aviso">Notificações bloqueadas. Libera em Ajustes → Notificações → Agenda.</p>;

  return (
    <button className={`push ${estado}`} onClick={alternar}>
      {estado === "ativo" ? "🔔 Push ativo" : "🔕 Ativar push"}
    </button>
  );
}
