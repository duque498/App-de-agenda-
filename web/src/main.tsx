import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { registerSW } from "./lib/push";
import "./styles.css";

// Registra o SW já no carregamento: o push só funciona com SW ativo,
// e o registro é idempotente (chamar de novo não cria outro).
registerSW().catch(console.error);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
