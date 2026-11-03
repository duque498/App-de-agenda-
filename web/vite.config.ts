import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages serve em https://duque498.github.io/App-de-agenda-/ — por isso o base.
// Em dev local (vite) continua funcionando em http://localhost:5173/App-de-agenda-/.
export default defineConfig({
  base: "/App-de-agenda-/",
  plugins: [react()],
});
