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

## 12. Nível de esforço (função `esforco`)

- Colunas novas em `events`: `effort` (0–100, com `check`), `ai_brief`, `ai_tips` (jsonb array), `ai_evaluated_at`.
- **Saída estruturada por ferramenta**: em vez de pedir "responda em JSON" e torcer, declaramos uma ferramenta `avaliar` com schema (`effort` inteiro 0–100, `brief` string, `tips` array); o código só lê `tool_use.input`. É o jeito certo de extrair dados de LLM.
  - Tentei forçar com `tool_choice: { type: "tool" }`, mas **este modelo (`claude-sonnet-5-5`) devolve 400: tool_choice "tool" e "any" não suportados**. Solução: instrução explícita no system prompt + uma segunda tentativa se vier texto em vez de `tool_use`. Lição: a API muda entre modelos; o erro real precisa chegar na tela (por isso o `mensagemDeErro` no front), senão tu fica adivinhando.
- A IA recebe também os **outros eventos do dia**: "implementar feature" às 20h depois de 6h de Medweb pesa mais do que às 9h num dia vazio.
- A escala (0–20 rotina, 21–45 conhecido, 46–70 trabalho de verdade, 71–100 pesado) está no system prompt. Sem escala explícita cada chamada inventa a própria régua e os números não são comparáveis entre eventos.
- UI: `%` no canto do bloco na timeline; no editor, barra com cor por faixa (classe `media`/`alta`), brief e dicas. As notas do evento são salvas antes de avaliar, porque a função lê do banco, não do formulário.
- Erro meu corrigido no caminho: tentei fazer a cor da barra mudar via `background-size` no gradiente. Não funciona — `background-size` é relativo ao próprio elemento, então a barra sempre mostraria o mesmo trecho do gradiente. Classes por faixa são mais simples e previsíveis.

## 13. Visualizações (dia, semana, mês, lista) e criação de evento

Referência: Google Agenda. O que copiei dele: seletor de visão no topo, setas de navegação, "+" grande no canto, "Agenda" como lista cronológica, grade mensal com pontos. Os diferenciais continuam só na visão Dia (briefing, esforço, linha de agora, chat).

- **Carregar só o intervalo visível**: `intervalo(visao, dia)` devolve início/fim pra cada visão (1 dia, 7 dias, 42 dias da grade, 14 dias da lista). O `useCallback` de `carregar` depende de `[dia, visao]`, então trocar a visão recarrega sozinho.
- **Semana começa na segunda** (`inicioDaSemana`): `getUTCDay()` dá 0 = domingo; a conta `dow === 0 ? -6 : 1 - dow` volta pra segunda.
- **Grade do mês com 42 células** (6 semanas fixas): o layout não "pula" de altura entre meses de 5 e 6 semanas.
- **Visão da semana reaproveita a matemática da timeline** com `ALTURA_HORA` menor (40px vs 56px). Mesma função de minutos; só a escala muda.
- **Visão preferida persiste em `localStorage`** com try/catch — em modo privado o acesso pode lançar erro.
- **Editor ganhou Data e Dia inteiro**: `all_day` grava `starts_at` à meia-noite de SP e `ends_at` nulo; a timeline mostra dia-inteiro como chips acima da régua.
- **Dois botões flutuantes**: "+" (ação principal, como no Google) e "Mudar o dia" (chat). Primário maior, secundário discreto.

## 14. Detalhe, tarefas e o menu do +

- **Ler ≠ editar.** Tocar num item abre `Detalhe` (folha de leitura: título, quando, notas, esforço, brief, dicas). "Editar" leva ao formulário. Separar os dois evita formulário aberto por engano e dá lugar pro conteúdo da IA respirar.
- **Tarefa é uma linha de `events` com `kind = 'tarefa'`**, não uma tabela nova. O que ela tem a mais é `done`. Por quê: 90% do que precisa (contexto, data, notas, esforço, RLS, ferramentas da IA) é igual; uma tabela separada duplicaria tudo isso. `check (kind in (...))` garante que só esses dois valores entram.
- Tarefa **sem hora** = `all_day = true` com `starts_at` à meia-noite de SP; aparece só na lista de tarefas do dia. Tarefa **com hora** aparece também na timeline, tracejada, pra não parecer um bloco que ocupa tempo.
- O "+" abre um menu de duas opções em vez de criar direto. Custo: um toque a mais. Ganho: o editor abre já no modo certo, sem um seletor "evento/tarefa" dentro do formulário.
- IA: `criar_evento` ganhou `kind` e `all_day`; `listar_dia` devolve `kind`/`done`; `concluir_tarefa` novo. O system prompt ensina a regra de bolso: "lembra de", "preciso fazer" → tarefa.

## 15. Perfil e avaliação automática

- A Edge Function **não** tem acesso à memória do claude.ai (não existe API pra isso). O equivalente controlável é a tabela `perfil` (uma linha, `id = 1` com `check`), que o Duque edita em "Sobre mim" e que entra no system prompt das duas funções de IA.
- `esforco` agora recebe também: as últimas 12 avaliações (título, contexto, %, brief) pra **manter coerência** — sem isso cada avaliação é independente e a mesma tarefa ganha 40% num dia e 65% no outro — e o resumo das 14h do dia.
- `Promise.allSettled` em vez de `Promise.all`: perfil, histórico e resumo são opcionais; se um falhar, a avaliação segue. Só a chave da API é obrigatória, e é a única cuja rejeição vira erro.
- **Avaliação automática ao criar**: o editor fecha na hora e dispara `avaliarEsforco` em segundo plano; quando volta, `onAvaliado` recarrega e a % aparece. Erro ali é `console.warn`, nunca bloqueia o salvar — a tarefa já está criada, a IA é extra.
- Bug de nome que o TypeScript pegou: `data` era o estado da data do formulário e também o retorno da query. Renomeei pra `salvo`. Nomes genéricos (`data`, `result`) são onde esse tipo de colisão nasce.

## 16. Markdown, visão Grade e avaliação automática pelo chat

- **Markdown com sanitização**: `marked` converte, `DOMPurify` limpa antes de `dangerouslySetInnerHTML`. Mesmo texto vindo da própria IA ou das tuas notas passa pelo sanitizador — HTML cru de qualquer origem nunca entra direto no DOM. Entra em: respostas do chat, sugestão do dia, brief, dicas e notas.
- **Visão Grade**: 14 dias a partir do dia escolhido, dois cartões por linha, itens por título (até 6 por dia, "+n" além disso). Mês fica com pontos porque na tela do celular não cabe título em 42 células.
- **Esforço automático também pelo chat**: `criar_evento` e `criar_serie` agora chamam a função `esforco` por HTTP, com o mesmo JWT do dono (ela confere o e-mail). Reusar a função em vez de copiar a lógica garante que avaliação manual, do editor e do chat sejam idênticas (mesmo perfil, mesma calibração).
- **Série avalia uma vez e copia**: 40 "Escola" idênticos não precisam de 40 chamadas; avalia o primeiro e replica `effort/brief/tips` nos outros com um `update ... in (ids)`. Custo cai de O(n) pra O(1) chamadas de IA.
- Falha na avaliação não derruba a criação: `avaliar()` engole o erro e devolve `null`; o item existe, só fica sem %.

## 17. T.O.B.I.A.S. — assistente com conversa persistente

- **Histórico no banco, não no app.** Tabela `chat_messages` (role, content jsonb, visible). O app manda só `{ texto }`; a função carrega as últimas 60 mensagens, roda o loop de ferramentas e grava **tudo que aconteceu nessa rodada** (mensagem do usuário, tool_use, tool_result, resposta). Fechar o app não perde a conversa, e o Tobias lembra o que já fez.
- `visible = false` nas linhas que são só tool_use/tool_result: elas existem pra IA lembrar, não pra tela. Uma coluna booleana evita filtrar JSON no front.
- **Bug corrigido no caminho** (o erro "tool_use ids were found without tool_result"): o modelo disparou 8 chamadas de ferramenta de uma vez e estourou `max_tokens: 1024` no meio. Meu código decidia pelo `stop_reason`, viu que não era `tool_use` e tratou como resposta final — guardando no histórico um assistant com tool_use sem resposta. Três correções: `max_tokens: 4096`; decidir pelo **conteúdo** (tem tool_use? executa); e `limparHistorico()`, que remove tool_use órfãos antes de mandar pra API. Lição: nunca confie só em metadado; valide o estado que você vai reenviar.
- **Ferramentas novas**: `ler_resumos_recentes` (PRs, reviews, issues, e-mails, curso dos últimos N dias — é por aí que ele "integra o trabalho") e `listar_periodo`. Ele não acessa GitHub/Gmail ao vivo; o prompt o obriga a dizer a data do resumo quando a pergunta exige dado atual.
- **Persona no system prompt**: direto, seco, humor raro, nunca bajula. Personalidade é prompt, não código — e fica num lugar só.
- UI: aba própria em vez de gaveta. Conversa precisa de espaço; gaveta era pra comando rápido. O botão "Tobias" flutuante só leva pra aba.

## 18. Memória compartilhada Claude ↔ Tobias

- A memória do claude.ai **não é acessível por API**. A ponte possível é um lugar que os dois alcançam: a tabela `memorias` no Supabase. O Tobias grava pela ferramenta `lembrar` (e apaga com `esquecer`); o Claude lê e grava pelo conector Supabase em qualquer conversa — e tem anotado na própria memória que essa tabela existe e quando consultá-la.
- Cada linha tem `origem` (`tobias` | `claude` | `duque`): dá pra saber quem aprendeu o quê, e pra auditar se alguém gravou bobagem.
- Tanto `assistente` quanto `esforco` injetam `perfil` + `memorias` no system prompt. O Tobias vê os ids (`[12] texto`) pra poder esquecer por id; o avaliador vê só o texto.
- Regra no prompt: "não guarde coisa passageira". Memória cresce; o que vale é fato durável (horários fixos, prazos, preferências), não "hoje estou cansado".

## 19. Resposta assíncrona do Tobias

- Sintoma: "Failed to send a request to the Edge Function" numa mensagem longa. Nos logs, o worker subiu e foi desligado sem nunca registrar o POST — a conexão foi cortada do lado do cliente enquanto o loop (várias rodadas + avaliações) ainda rodava. Celular não segura requisição de 60 s.
- Solução: **aceitar e responder na hora (202), processar em background** com `EdgeRuntime.waitUntil`, e o app faz polling em `chat_messages` a cada 2 s até aparecer uma mensagem do assistente com id maior que a do usuário. Nenhuma conexão vive mais que um segundo.
- A mensagem do usuário é gravada **antes** de começar: se tudo falhar depois, ela não some. Erro no loop vira uma mensagem do assistente com `erro = true` (vermelha na tela) — nunca silêncio.
- Coluna `acoes` na resposta: o app recarrega a agenda só quando a IA mudou algo, sem comparar listas.
- Padrão geral: operação que pode demorar não deve segurar o HTTP. Aceita → trabalha → grava → cliente observa.

## 21. Briefing compacto com resumo completo

- A sugestão do dia caiu de 1.4rem pra 1rem: o herói virou um cartão discreto com borda verde-água, que lê rápido e não empurra a timeline pra baixo da dobra. Hierarquia agora é: sugestão → uma linha de contexto (pendências, issues, próximo módulo, streak) → "Ver resumo completo".
- O resumo completo é o `raw_markdown` que a tarefa das 14h já gravava e o app nunca mostrava. Renderizado com `Md`, títulos rebaixados pra não brigar com o resto da tela. Sem `raw_markdown` (resumos antigos), cai na lista de pendências.
- Regra de design: o que tu lê toda vez fica pequeno e sempre visível; o que tu lê às vezes fica dobrado e completo.
