# App de agenda

Calendário pessoal como PWA (iPhone, tela de início, Web Push), ligado à tarefa agendada das 14h que resume trabalho e curso e grava no Supabase.

**App:** https://duque498.github.io/App-de-agenda-/

```
tarefa 14h ──INSERT──▶ daily_briefs ──trigger──▶ Edge Function send-push ──Web Push──▶ iPhone
                            ▲                                                          │
                            └──────────── PWA lê (Supabase client + RLS) ◀─────────────┘
```

## Estrutura

- `web/` — PWA em React + Vite + TypeScript. Deploy automático no GitHub Pages a cada push em `main` (`.github/workflows/pages.yml`).
- `supabase/functions/send-push/` — Edge Function que envia o push (chaves VAPID e segredo do webhook lidos do Vault via RPC `get_app_secrets`).
- `tarefa-14h-prompt.md` — prompt da tarefa agendada, com o passo que grava em `daily_briefs` e `course_log`.
- `RELATORIO-ESTUDO.md` — por que cada decisão foi tomada.

## Rodar local

```bash
cd web
cp .env.example .env
npm install
npm run dev      # http://localhost:5173/App-de-agenda-/
```

Push só funciona em HTTPS (ou localhost) e, no iPhone, só com o site adicionado à Tela de Início.

## Supabase

Projeto `agenda` (`mtkbchoekmmngyzvyads`, sa-east-1). Tabelas: `daily_briefs`, `events`, `course_log`, `push_subscriptions`; view `course_streak`. RLS fechado pro e-mail do dono (`is_owner()`).
