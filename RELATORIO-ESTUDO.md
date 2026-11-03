# Agenda — relatório de estudo da sessão 1

O que foi construído, por que cada peça é assim, e o que tu precisa conseguir explicar sozinho.

## 1. O problema real: a tarefa das 14h não deixava rastro

A tarefa agendada rodava, mandava push pelo app do Claude e sumia. Pra um app "se interligar" com ela, ela precisa **gravar o resultado num lugar que o app leia**. Toda a arquitetura nasce dessa frase.

```
tarefa 14h ──INSERT──▶ daily_briefs ──trigger──▶ Edge Function send-push ──Web Push──▶ iPhone
                            ▲                                                          │
                            └──────────── PWA lê (Supabase client + RLS) ◀─────────────┘ toque abre /?dia=...
```

## 2. Por que PWA e não widget nativo

- Widget na home do iOS = WidgetKit = Swift + Xcode + conta Apple ou reinstalar a cada 7 dias.
- PWA: `manifest.webmanifest` + service worker + "Adicionar à Tela de Início". Desde o iOS 16.4 recebe Web Push **só quando instalado assim** (no Safari normal não funciona). Sem Xcode, sem conta.
- Custo: não tem widget com conteúdo; tem ícone + badge + notificação.

## 3. Banco (Supabase / Postgres)

### Tabelas
| tabela | papel | detalhe que importa |
|---|---|---|
| `daily_briefs` | resumo diário gravado pela tarefa | `brief_date` é `unique` → no máximo um por dia; o prompt usa `on conflict ... do update` |
| `events` | teus blocos da agenda | `context` é um `enum` (`trabalho/escola/curso/pessoal`) — o banco recusa valor inválido |
| `course_log` | um registro por dia do curso | base do streak |
| `push_subscriptions` | um celular = uma linha | `endpoint` unique → reinstalou = linha nova |

**Por que `jsonb` em `github/gmail/course`?** O formato do resumo ainda vai mudar. Colunas fixas agora = migration a cada ajuste. `jsonb` dá flexibilidade e o Postgres indexa/consulta dentro dele quando precisar.

### RLS (Row Level Security)
App de uma pessoa só. Em vez de `user_id` em toda tabela, uma função:

```sql
create function is_owner() returns boolean as $$
  select coalesce(auth.jwt() ->> 'email', '') = 'jp2575425@gmail.com';
$$;
```

Toda policy é `using (is_owner())`. Qualquer um pode criar conta no teu projeto, mas só o JWT com o teu e-mail enxerga linha. `stable` + `set search_path = public` são o que o linter exige.

### View `course_streak`
Conta dias consecutivos com `advanced = true` até hoje (ou ontem — não zera só porque ainda não deu 14h). Técnica: `day - row_number()` agrupa sequências consecutivas num mesmo `grp` — isso é o truque clássico de "gaps and islands" em SQL.

`security_invoker = on` na view: sem isso, a view roda com permissão do dono e **ignora o RLS da tabela**. O linter do Supabase reclama; é furo real.

### Trigger → Edge Function (`pg_net`)
`notify_brief_insert()` roda `after insert` e faz `net.http_post(...)` pra função. `pg_net` é assíncrono: o INSERT não espera a resposta. Por isso a resposta aparece em `net._http_response` segundos depois (e por isso meu `pg_sleep` na mesma transação não enxergou — transação não vê o que outra transação gravou depois do início dela).

O segredo do webhook vem de `vault.decrypted_secrets`, não fica hardcoded no SQL. `security definer` é obrigatório pra função conseguir ler o Vault; em troca, `revoke execute` de `anon/authenticated` pra ninguém chamar via `/rest/v1/rpc`.

## 4. Edge Function `send-push` (Deno)

- `verify_jwt: false` porque quem chama é o banco, não um usuário. Autenticação própria: header `x-webhook-secret`.
- **Segredos pelo Vault, não por env**: o formulário de secrets do conector não funcionava no teu cliente. Solução: RPC `get_app_secrets()` que lê o Vault, com `grant execute` **só pra `service_role`**. A função usa `SUPABASE_SERVICE_ROLE_KEY` (injetada automaticamente em toda Edge Function) e chama a RPC uma vez por worker. Resultado: zero segredo pra colar à mão e nada vaza pro front.
- `web-push` via `npm:` — funciona no runtime do Supabase (confirmado nos logs: `booted`, resposta 200).
- Limpeza automática: resposta 404/410 do serviço de push = inscrição morta → apaga a linha. Sem isso a tabela acumula lixo e cada envio demora mais.
- `Promise.all` nos envios: são independentes, não faz sentido mandar um por vez.

## 5. PWA (React + Vite + TS)

### Arquivos que fazem ele ser "app"
- `public/manifest.webmanifest` — nome, ícones, `display: standalone`.
- `index.html` — tags `apple-mobile-web-app-*` (o iOS ignora parte do manifest e lê essas) e `viewport-fit=cover` + `env(safe-area-inset-*)` no CSS pro notch.
- `public/sw.js` — service worker. Só dois eventos: `push` (mostra notificação) e `notificationclick` (foca ou abre o app na URL do dia). **Sem cache offline de propósito**: cache mal feito é a principal fonte de "o app não atualiza" em PWA. Adiciona depois, quando o app estabilizar.

### `lib/push.ts` — o fluxo de inscrição
1. `Notification.requestPermission()` — só funciona em resposta a um toque do usuário (por isso é um botão).
2. `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })` — a chave VAPID pública em `Uint8Array`; a função `base64UrlToUint8Array` existe porque VAPID usa base64**url** (`-`/`_`) e `atob` quer base64 normal (`+`/`/`).
3. `upsert` em `push_subscriptions` por `endpoint`.

### Login com e-mail + senha, não magic link
No iOS, o link do e-mail abre no Safari, não dentro do PWA — a sessão fica no app errado. Senha evita isso. Primeiro uso: "Criar conta" com o teu e-mail, confirmar no e-mail, entrar.

### Datas
`lib/dates.ts` força `America/Sao_Paulo` em tudo. `limitesDoDia()` usa offset `-03:00` fixo — válido porque SP não tem horário de verão desde 2019. Se isso mudar, muda ali.

### `App.tsx`
`Promise.all` com três consultas (brief, events, streak) — independentes, então paralelas. `?dia=YYYY-MM-DD` na URL é como a notificação abre o app já no dia certo.

## 6. Onde estão as coisas

- Projeto Supabase: `agenda` (`mtkbchoekmmngyzvyads`, sa-east-1)
- URL: `https://mtkbchoekmmngyzvyads.supabase.co`
- Chave pública (front): `sb_publishable_x-NliHjmI8s3SIu7vXUOqg_2A2cyZ9j`
- Edge Function: `send-push` v3
- Código: `web/` (PWA), `supabase/functions/send-push/`, `tarefa-14h-prompt.md`

## 7. Próximos passos, em ordem

1. **Hospedar o PWA** (Vercel/Netlify/Cloudflare Pages, qualquer um com HTTPS). `npm i && npm run build` em `web/`; variáveis `VITE_*` do `.env.example`.
2. Abrir no Safari do iPhone → Compartilhar → Adicionar à Tela de Início → abrir por lá → Criar conta → Ativar push.
3. Testar: inserir uma linha em `daily_briefs` pelo SQL Editor e ver a notificação chegar.
4. Apagar as 3 linhas de teste (`brief_date < '2020-01-01'`) — a permissão de delete pelo conector estava bloqueada.
5. Aplicar o prompt novo na tarefa das 14h (`tarefa-14h-prompt.md`).
6. Depois: fase de IA (Edge Function chamando a Anthropic API pra sugerir blocos nos buracos do dia).

## 8. Pra tu conseguir explicar sozinho — checklist

- [ ] Por que o PWA só recebe push depois de "Adicionar à Tela de Início"?
- [ ] O que `security_invoker` muda numa view?
- [ ] Por que a função de trigger precisa ser `security definer` e por que, então, revogamos `execute`?
- [ ] Como a Edge Function obtém a chave VAPID sem env var?
- [ ] O que `day - row_number()` faz no cálculo do streak?
- [ ] Por que `atob` não lê a chave VAPID direto?
