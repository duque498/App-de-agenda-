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

---

# Sessão 2 — UI nova e assistente com IA

## 9. Edge Function `assistente`

É o "Claude administrando as coisas". Fluxo de uma mensagem:

```
app ──JWT + histórico──▶ assistente ──▶ Anthropic API (com tools)
                             │               │ stop_reason = tool_use?
                             │◀── executa a tool no banco (service role) ◀┘
                             │   e devolve tool_result; repete até end_turn
                             └──▶ { resposta, acoes, historico }
```

Decisões:
- **`verify_jwt: true` + checagem do e-mail.** O gateway do Supabase já barra quem não tem JWT; a função ainda confere que o JWT é **teu** (`admin.auth.getUser(jwt)`), porque "logado" não é o mesmo que "dono". É a mesma regra do RLS, só que em código.
- **Service role nas ferramentas.** A função usa a service role pra escrever em `events` — por isso a checagem do e-mail acima é obrigatória. Sem ela, qualquer conta logada mandaria a IA apagar tua agenda.
- **Loop agêntico com teto de 8 rodadas.** `tool_use` → executa → `tool_result` → chama de novo. O teto evita loop infinito se o modelo ficar chamando ferramenta sem parar.
- **Histórico vai e volta inteiro.** O app guarda o `historico` que a função devolve (com `tool_use`/`tool_result`) e manda de volta na próxima mensagem. Sem isso a IA não lembra que acabou de criar um evento. Fica em memória do app: fechou, zerou. Simples de propósito.
- **Chave da Anthropic no Vault**, mesma RPC `get_app_secrets()` (atualizada pra incluir `anthropic_api_key`). Zero chave no front, zero chave em env manual.
- **Modelo:** `claude-sonnet-5-5` — rápido e barato o suficiente pra chat de agenda. Dá pra trocar numa constante.
- `source: "ia"` nos eventos que a IA cria → a timeline mostra um pontinho verde-água neles. Tu sabe o que foi tu e o que foi ela.

Pra ligar: no SQL Editor do Supabase, uma vez:
```sql
select vault.create_secret('sk-ant-...sua chave...', 'anthropic_api_key', 'Chave da Anthropic API');
```
A chave sai de console.anthropic.com e é cobrada por uso, separado da assinatura do claude.ai. Chat de agenda gasta centavos por dia.

## 10. UI

**Herói = sugestão do dia** em 1.45rem. É a única coisa que importa quando o push chega às 14h. Pendências ficam dobradas em "Ver detalhes".

**Timeline vertical** (07h–23h, 56px por hora): posição e altura do bloco vêm dos minutos desde 07:00 — `top = (min/60) * 56`. A linha "agora" é o mesmo cálculo com `new Date()`, atualizada a cada minuto. Tocar numa hora vazia abre o editor já com aquela hora. `minutosDesdeInicio` usa `Intl.DateTimeFormat(..., { timeZone: "America/Sao_Paulo" })` em vez de `getHours()` pra não depender do fuso do aparelho.

**Cores por contexto via CSS custom property**: `.ctx-trabalho { --ctx: var(--trabalho) }` e o resto (`border-left`, `color` da hora, chip) só lê `var(--ctx)`. Um lugar define, todo mundo herda — sem quatro regras repetidas por componente.

**Gavetas (bottom sheet)** pra editor e chat: `transform: translateY(100%)` → `translateY(0)`. Transform não dispara layout, por isso é suave no celular. `pointer-events: none` quando fechada pra não bloquear toques.

**Tipografia**: uma família só (Instrument Sans), hierarquia por tamanho e peso, sem caixa alta em rótulo, sem marcador numerado. Fundo tinta-azulada em vez de preto puro; verde-água como única cor de ação.

**`visibilitychange`**: iOS congela o PWA em background; quando volta, recarrega. Senão tu abre pelo push e vê dado velho.

## 11. Checklist da sessão 2

- [ ] Por que a função `assistente` precisa checar o e-mail se já tem `verify_jwt`?
- [ ] O que acontece se o modelo responder `stop_reason: "tool_use"`?
- [ ] Por que mandamos o histórico inteiro de volta, incluindo `tool_result`?
- [ ] Como a timeline calcula o `top` de um bloco?
- [ ] Por que `translateY` e não `bottom: -100%` na gaveta?
