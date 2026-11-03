import { useState } from "react";
import { supabase } from "../lib/supabase";

// E-mail + senha em vez de magic link: no iOS o link do e-mail abre no Safari,
// não dentro do PWA, e a sessão fica no lugar errado. Senha evita isso.
export function Login() {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [modo, setModo] = useState<"entrar" | "criar">("entrar");
  const [msg, setMsg] = useState("");
  const [carregando, setCarregando] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setCarregando(true);
    setMsg("");
    const fn = modo === "entrar" ? supabase.auth.signInWithPassword : supabase.auth.signUp;
    const { error } = await fn.call(supabase.auth, { email, password: senha });
    setCarregando(false);
    if (error) setMsg(error.message);
    else if (modo === "criar") setMsg("Conta criada. Confirma no e-mail e volta pra entrar.");
  }

  return (
    <main className="tela-login">
      <h1>Agenda</h1>
      <form onSubmit={enviar}>
        <input type="email" placeholder="e-mail" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input
          type="password"
          placeholder="senha"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          minLength={6}
          required
        />
        <button disabled={carregando}>{modo === "entrar" ? "Entrar" : "Criar conta"}</button>
      </form>
      {msg && <p className="msg">{msg}</p>}
      <button className="link" onClick={() => setModo(modo === "entrar" ? "criar" : "entrar")}>
        {modo === "entrar" ? "Primeira vez? Criar conta" : "Já tenho conta"}
      </button>
    </main>
  );
}
