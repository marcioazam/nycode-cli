# Observabilidade completa do pi: trilha, hooks, fio, filhos, OTLP, /doctor e tela (2026-11-14)

Pedido do dono: fechar as seis lacunas do `/diagnostico` (`pi-diagnostico-2026-11-14.md`), aplicar o estado da arte de
2026 pesquisado na web, incluir um `/doctor`, e mostrar em tela o máximo de informação, sobretudo avisos e erros.

## Aceite

1. **Trilha**: todo evento do pi que não é por token vira um registro (turno, chamada de modelo, tool, hook, compactação,
   troca de modelo/esforço, sessão), com duração e resultado, visível na aba `eventos` do `/diagnostico` e gravado em
   arquivo.
2. **Hooks**: cada execução de hook de comando (do harness ou de terceiros) registra evento, comando, duração, código de
   saída, timeout e stderr (redigido, limitado); falha ou bloqueio aparece como aviso.
3. **Fio**: cada chamada a provedor registra modelo pedido, esforço, duração, tokens (entrada, saída, cache), motivo de
   parada e erro, inclusive chamadas fora do laço do agente (compactação, `/btw`, avaliador do `/goal`).
4. **Filhos**: falhas e avisos de subagentes (primeiro plano, segundo plano, lote) chegam ao painel do pai com a fonte
   `sub:<agente>`; os filhos usam o mesmo trace id (`TRACEPARENT`).
5. **Exportação**: spans em OTLP JSON Lines (`~/.nycode/agent/diag/traces.jsonl`); com `OTEL_EXPORTER_OTLP_ENDPOINT` definido,
   envio OTLP/HTTP JSON em lotes, limitado, sem derrubar o pi.
6. **`/doctor`**: verifica a saúde do harness e imprime `✓ / ▲ / ✕` por item com a correção sugerida; só leitura.
7. **Tela**: faixa acima do editor com os últimos avisos e erros no momento em que acontecem; nível ajustável
   (`/diagnostico nivel erros|avisos|tudo`, `PI_DIAG_NIVEL`); em `tudo` a faixa mostra também hooks e chamadas de modelo.
8. E2E em pi real: falha de patch do wrapper, retry do modelo, hook que falha, falha em subagente, `/doctor`.
9. `PI_DIAG=0` desliga tudo; sem coletor configurado nada sai da máquina.

## Pesquisa (provedor por afirmação; "lido" = página aberta por leitor)

| Afirmação | Fonte | Provedor |
|---|---|---|
| GenAI semconv mudou para `open-telemetry/semantic-conventions-genai`; tudo em "Development" | github.com/open-telemetry/semantic-conventions-genai (gen-ai-metrics.md lido; issue #511 só trecho) | keenable (lido), exa, perplexity |
| Span de inferência `{operação} {modelo}`, CLIENT; `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.usage.input_tokens/output_tokens`, `cache_read.input_tokens` | …/docs/gen-ai/client-inference.md (lido) | keenable |
| `invoke_agent {agente}` INTERNAL; `execute_tool {tool}` INTERNAL com `gen_ai.tool.name` | …/gen-ai-agent-spans.md (lido), execute-tool.md (trecho) | keenable, exa |
| Métricas de tokens em renomeação (`gen_ai.client.token.usage` → `gen_ai.client.inference.usage.*`) | issue #511 (trecho) | exa, perplexity |
| OTLP File Exporter: JSON Lines, um sinal por arquivo, `.jsonl`, "Development" | opentelemetry.io/docs/specs/otel/protocol/file-exporter/ (lido) | keenable, exa |
| Contexto por ambiente (`TRACEPARENT`), release candidate; valor é entrada não confiável; injetar na cópia do ambiente do filho | opentelemetry.io/docs/specs/otel/context/env-carriers/ (lido) | keenable, exa |
| Claude Code: eventos `api_request`, `api_error`, `tool_result`, `hook_execution_start/complete`, `compaction`; spans `interaction`, `llm_request`, `hook`, `tool`; propaga `TRACEPARENT` a subprocessos; prompts redigidos por padrão | code.claude.com/docs/en/monitoring-usage (lido) | keenable, parallel, exa |
| Claude Code registra uma linha por hook: `… finished with status 0 (31ms)`, `timed out`, `failed to start` | code.claude.com/docs/en/hooks (lido) | keenable |
| Codex `hooks.run` + `duration_ms` (`hook_name`, `status`); Gemini `hook_call` (`duration_ms`, `success`); nenhum documenta exit code ou stderr | developers.openai.com/codex/config-advanced, gemini-cli docs/cli/telemetry.md (lidos) | parallel |
| `claude doctor` só leitura; `/doctor` na sessão propõe correção; `brew doctor` e `gh auth status` saem ≠ 0 com problema | docs.brew.sh/Manpage, cli.github.com/manual/gh_auth_status (lidos); docs do Claude (trecho) | parallel, keenable |
| clig.dev: razão sinal/ruído, agrupar erros iguais, sem rótulos de nível fora do modo verboso, log de depuração em arquivo | clig.dev (lido) | keenable, parallel |

Não confirmado: versão numerada do semconv GenAI; formato da saída do `claude doctor`; guia primário sobre faixa de
status em TUI (a faixa é decisão nossa, apoiada no clig.dev).

Decisões que saem da pesquisa:
- Nomes `gen_ai.*` nos spans de modelo, tool e agente; atributos próprios com prefixo `pi.` (hooks, sessão, harness).
- Sem export de **métricas** OTLP agora: os nomes de métricas de tokens estão sendo trocados (issue #511). Tokens e
  duração vão nos spans; o resumo da sessão sai deles. Rever quando o semconv estabilizar.
- Conteúdo de prompt e de resposta nunca entra no trace (padrão do Claude Code e do Codex); só tamanhos e contagens.
- Exit code e stderr de hook vão além do que os CLIs de referência documentam; ficam só no log local e no painel,
  redigidos e limitados a 2 KiB, e não no envio ao coletor.

## Mapa do código (verificado)

- Eventos de extensão: 41 em `dist/core/extensions/types.d.ts:1229-1269`; alto volume (fora da trilha): `message_update`,
  `provider_stream_event`, `tool_execution_update`.
- Hooks de comando: `pi-code/extensions/hooks/runners.ts:152` (`runHookCommand`), convergência em `finish` (`:189-194`);
  nenhum patch da pilha toca esse arquivo; não há evento por execução.
- Chamadas de modelo: `ctx.modelRegistry.runtime.streamSimple/stream` (mesmo ponto único do `travar-modelos`,
  confirmado por sonda); o retorno tem `.result()`.
- Filhos: `subagent/run.ts:346`, `background.ts:336` herdam `process.env` (logo `PI_DIAG_INBOX` e `TRACEPARENT`);
  `diagnostico/index.ts:44` hoje sai cedo com `PI_CODE_SUBAGENT=1`.
- Já existe `scripts/harness/doctor/pi-doctor` (97 linhas: JSON de config, caminhos do settings, extensões sem index,
  pilha de patches); não há `/doctor` na sessão.

## Desenho

Tudo no dono existente `extensions/diagnostico/` (3 → 7 arquivos de código, no limite), mais um patch de 1 ponto no
pi-code. Testes novos em `extensions/diagnostico/test/obs/`.

### `trilha.ts` (puro)

```ts
type Span = { traceId: string; spanId: string; parentId?: string; nome: string; tipo: 'span' | 'evento';
  inicio: number; fim?: number; durMs?: number; attrs: Record<string, string | number | boolean>; erro?: string }
criarTrilha(o?: { max?: number; agora?: () => number; traceparent?: string; id?: (bytes: number) => string;
  aoFechar?: (s: Span) => void }): {
  traceId: string; raizId: string
  abrir(nome: string, attrs?: Span['attrs'], parentId?: string): string   // devolve spanId
  fechar(spanId: string, attrs?: Span['attrs'], erro?: string): Span | undefined
  evento(nome: string, attrs?: Span['attrs'], erro?: string): Span        // span instantâneo
  recentes(): Span[]                                                      // anel, mais novo por último (max 500)
  traceparent(spanId?: string): string                                    // 00-<trace>-<span>-01
  resumo(): { spans: number; erros: number; tokensEntrada: number; tokensSaida: number; porNome: Record<string, number> } }
lerTraceparent(v: string | undefined): { traceId: string; spanId: string } | undefined  // valida formato W3C; inválido = undefined
```

`traceparent` válido no ambiente → mesmo `traceId`, e `raizId` novo com `parentId` = span recebido. `aoFechar` é chamado
para todo span fechado e todo evento. `resumo` soma `gen_ai.usage.input_tokens/output_tokens`.

### `exportar.ts`

```ts
paraOtlp(spans: Span[], recurso: Record<string, string>): object   // TracesData (resourceSpans/scopeSpans/spans), ids hex,
                                                                   // tempos em nanos como string, status ERROR quando há erro
criarExportador(o: { arquivo?: string; endpoint?: string; headers?: Record<string, string>; recurso: Record<string, string>;
  fetch?: typeof fetch; lote?: number; fila?: number; maxBytes?: number; aoFalhar?: (msg: string) => void;
  filtro?: (s: Span) => Span }): { enfileirar(s: Span): void; descarregar(): Promise<void> }
```

Arquivo: uma linha `TracesData` por lote, modo 0600, rotação em 5 MiB (`.1`). Rede: `POST {endpoint}/v1/traces`,
`content-type: application/json`, timeout 5 s, fila limitada (1000, descarta o mais antigo), sem retry, `aoFalhar` uma
vez por motivo. `OTEL_EXPORTER_OTLP_HEADERS` (`k=v,k2=v2`) vira `headers`. `filtro` remove `pi.hook.stderr` antes do envio.

### `doctor.ts`

```ts
type Achado = { id: string; estado: 'ok' | 'aviso' | 'erro'; titulo: string; detalhe?: string; correcao?: string }
verificar(d: { env; agentDir: string; exec(cmd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }>;
  fs: Pick<typeof import('node:fs'), 'existsSync' | 'readFileSync' | 'statSync' | 'accessSync'>;
  sessao?: { modelo?: string; temAuth?: boolean; erros: number; avisos: number; crashes: number } }): Promise<Achado[]>
formatarDoctor(achados: Achado[], glifo: (estado: Achado['estado']) => string): string[]
```

Itens: `pi-doctor` (cada `FALHA` vira `erro`); wrapper em uso (`PI_DIAG_INBOX` definido, senão `aviso` "abra pelo
`~/.local/bin/pi`"); versões do pi, pi-code e node; hooks do `settings.json` (comando existe e é executável);
servidores do `mcp.json` (binário no PATH); credencial do modelo atual; diretório `diag` gravável e tamanho dos logs;
`PI_MODEL_LOCK` válido; `OTEL_EXPORTER_OTLP_ENDPOINT` (URL válida); crashes nas últimas 24 h; erros e avisos da sessão.
Linha final: `n ok · n avisos · n erros`. O `pi-doctor` de terminal continua sendo o modo só leitura fora da sessão.

### `tela.ts`

`criarFaixa({ max = 4, largura })` → `{ empurrar(item: { sev; fonte; msg; n }), linhas(theme): string[], limpar() }`.
`ctx.ui.setWidget('diag', linhas)` acima do editor: `✕ fonte: mensagem ×n`, mais novo embaixo, truncado à largura;
some quando o usuário abre o painel ou usa `/diagnostico limpar`. Nível `erros` (só ✕), `avisos` (✕ ▲, padrão),
`tudo` (também hooks e chamadas de modelo, em `dim`).

### `index.ts` (integração)

- Eventos → trilha: `agent_start/agent_end` = `invoke_agent pi`; `turn_start/turn_end`; `tool_execution_start/end` =
  `execute_tool <tool>`; `session_start`, `session_shutdown`, `session_compact*`, `model_select`, `thinking_level_select`,
  `input` (só tamanho) = eventos.
- Fio: embrulha `runtime.streamSimple/stream` (marca própria, depois do `travar-modelos` se houver): span
  `chat <modelo>` com `gen_ai.provider.name`, `gen_ai.request.model`, `pi.effort`; `.result()` fecha com usage,
  `gen_ai.response.finish_reasons` e erro. Nunca altera a chamada.
- Hooks: registros `tipo: 'hook'` do sink viram spans `pi.hook <evento>` e, se falharam, avisos.
- Filho (`PI_CODE_SUBAGENT=1`): sem UI e sem arquivo próprio; mesmo conjunto de capturas, mas cada aviso ou erro vai
  para `PI_DIAG_INBOX` com fonte `sub:<agente>`; spans vão para o `traces.jsonl` com o `traceId` herdado.
- Pai: define `process.env.TRACEPARENT` no `session_start`.
- Comandos: `/doctor`; `/diagnostico nivel <x>`; aba `eventos` no painel.

### Patch `pi-code`: `hooks/runners.ts`

Em `finish`: `globalThis[Symbol.for('pi-harness:diag')]?.({ sev, fonte: 'hook', tipo: 'hook', msg, detalhe, quieto,
dados: { evento, comando, code, durMs, timedOut, spawnFailed } })`. `sev` 9 e `quieto: true` quando `code === 0`;
13 quando `code === 2` (bloqueio); 17 nos demais. Sem o sink o comportamento é idêntico.

### Ajustes depois do E2E (2026-11-14)

- Hook que terminou bem (`code 0`) fica só na trilha e no `traces.jsonl`: no E2E o hook `Status` (a cada atualização do
  rodapé) inundava o `diag.jsonl` e a aba `tudo`. Falha, bloqueio e timeout continuam indo ao registro. Contrato antigo
  do teste `integracao.test.ts` ("os dois passam pelo registro") trocado por "só a falha".
- Faixa: avisos e erros ficam fixos (até 4); linhas informativas do nível `tudo` ocupam no máximo 3 e nunca os expulsam;
  `Status` não aparece na faixa.
- `/doctor`: o `claude-compat` já registrava `/doctor` e `/checkup` e ganha na ordem de carga. Ele agora delega ao
  `diagnostico` pelo símbolo global `pi-harness:doctor` e passa as próprias checagens, que entram como itens; sem o
  `diagnostico` (`PI_DIAG=0`) o comportamento antigo fica.

## Custo, qualidade, rollback

Custo: zero byte de contexto do modelo (nada vai ao prompt); um `appendFile` em lote por turno; trilha em anel de 500.
Qualidade: falha de hook, de filho e de chamada auxiliar deixa de ser invisível. Rollback: `PI_DIAG=0`; remover o patch
`…-hook-diag.patch`; os módulos novos são aditivos.

## Checkpoint

- [x] Lane A: `trilha.ts`, `exportar.ts` + testes
- [x] Lane B: `doctor.ts` + teste
- [x] Lane C: patch `hooks/runners.ts` + teste (aplicado na árvore instalada)
- [x] Lane D: `tela.ts`, `index.ts`, `painel.ts`
- [x] E2E, checks, `publish.list`, links, catálogo de comandos
- [ ] Revisão de UX das abas `eventos`/`saúde` e da faixa (não feita)

## Evidência (2026-11-14)

Testes: diagnostico 106/106, travar-modelos 19/19, hook-diag 8/8. `structure.py`: só os 3 achados anteriores.

E2E em pi real (tmux, `~/.local/bin/pi --no-session`, haiku-5-5 · low, coletor HTTP local em 127.0.0.1:4319):

- aviso do wrapper (`PI_HARNESS_PI_CODE_VERSION=9.9.9` → `skipping harness patches`) na faixa, no painel e no `diag.jsonl`;
- retry do modelo: 2 respostas 529 injetadas no `fetch` → `modelo · 529 … ×2`, `provedor fora do ar ×2`, spans `chat` com
  status ERROR, depois sucesso com tokens;
- guard negando `read` de `.env` → `tool: Bloqueado pelo guard: …` na faixa (nível `avisos`) e no registro;
- subagente `general-purpose`: erro de `ls` do filho no painel do pai com fonte `sub`; spans do filho com o trace id do pai;
- spans `pi.hook <evento>` com comando, código de saída e duração; `execute_tool`, `turn`, `invoke_agent pi`;
- coletor recebeu 17 lotes em `/v1/traces` (`application/json`), zero ocorrência de `pi.hook.stderr`;
- `/doctor` abre a aba `saúde`; apontou 11 patches que não revertem (pilha fora de sincronia por edição em andamento de
  outra frente em `plan-espera` e `question-dialog`, 16:52–16:53), 1 crash em 24 h, versões, 9 hooks, 2 servidores MCP;
- nível `tudo`: linhas de hook e `chat <modelo> · <esforço> · ms · tok` na faixa.

Não exercitado: hook de comando saindo com código ≠ 0 num pi real (o guard nega por JSON com saída 0; coberto só pelo
teste do patch); falha real de aplicação de patch pelo wrapper; coletor OTLP de terceiros; nome do agente na fonte
`sub:<agente>` (o pi-code só expõe o nome para agentes com hooks).

Falhas de outras frentes vistas nos checks (não tratadas): `comandos/test` (catálogo sem 23 comandos; captura
colidindo), `claude-compat/commands/test` (store: settings.json corrompido).

## Detecção e correlação (2026-11-14)

Revisão de UX das abas `eventos`/`saúde` e da faixa aplicada (fecha o item pendente do checkpoint), mais dois acréscimos.

**Correlação registro ↔ trilha (modelo de dados de log do OTel).** Cada linha do `diag.jsonl` ganha `trace_id` e
`span_id` do span ativo na captura: tool em curso, senão chamada de modelo, senão turno, senão a raiz. Erro de tool,
falha de chamada de modelo, falha de hook e detecção apontam para o próprio span. Os campos são opcionais (crash de
outra execução fica sem eles), não entram na chave de agrupamento `fonte|tipo|msg` e não mudam o TSV da caixa de
entrada dos filhos. O detalhe de uma entrada mostra `trace <8>… · span <8>…`; `/diagnostico trace` avisa o trace id e
os caminhos de `traces.jsonl` e `diag.jsonl`, para procurar o mesmo id nos dois.

**Detecção.** `criarDetector` (`trilha.ts`, puro, relógio e limites injetados) recebe todo span fechado e todo evento
pelo `aoFechar` da trilha; cada detecção passa pelo caminho normal de captura com a fonte `detector` (faixa, painel,
`diag.jsonl`; no filho, caixa do pai como `sub[:agente]` / `detector:<regra>`), uma vez por chave.

| regra (`error.type`) | condição | sev | mensagem | chave |
|---|---|---|---|---|
| `hook-lento` | `pi.hook.duration_ms` ≥ `PI_DIAG_HOOK_LENTO_MS` (padrão 2000) | 13 | `hook <evento> · <cmd> levou <n> ms` | evento + comando |
| `modelo-lento` | span `chat` ≥ `PI_DIAG_MODELO_LENTO_MS` (padrão 120000) | 13 | `modelo <provedor/modelo> levou <n> s` | modelo |
| `tool-em-laco` | a mesma tool fecha com erro 3 vezes seguidas | 13 | `tool <nome> falhou 3 vezes seguidas` | tool; rearma depois de um sucesso dela |
| `erros-de-modelo` | 3 spans `chat` com erro em 5 min | 17 | `3 chamadas de modelo falharam em 5 min` | única por processo |
| `tool-travada` | span de tool aberto há `PI_DIAG_TOOL_TRAVADA_MS` (padrão 600000) | 13 | `tool <nome> rodando há <n> min` | span |

Limites em milissegundos: só inteiro não negativo vale, o resto cai no padrão, `0` desliga a regra. `tool-travada` é
checada em `turn_start`, `turn_end`, `tool_execution_start/end` e por um intervalo de 30 s sem referência (`unref`),
criado no `session_start` e limpo no `session_shutdown` (`deps.timer` nos testes); a trilha expõe `abertos()`.

**Tela (substitui o que diverge acima).** `/doctor` não esvazia a faixa: só `/diagnostico` (marca as entradas como
vistas) e `limpar` (comando ou `l` no painel) esvaziam. Na faixa só o glifo leva a cor da severidade. `saúde`: resumo
`✕ n erros · ▲ n avisos · ✓ n ok` fixo na 1ª linha (sem problema: `✓ n verificações, nenhum problema`), achados vizinhos
com o mesmo `id` e a mesma correção num bloco só, `~` no lugar do home em detalhe e correção, marcadores `… n linhas
acima/abaixo`; a saída sem UI termina em `n erros · n avisos · n ok` (contrato antigo: `n ok · n avisos · n erros`).
`eventos`: hora do fecho, recuo de 2 espaços por nível do pai presente na lista (teto 3), nomes de exibição (`agente`,
`turno`, `tool <x>`, `hook <x>`, `entrada`; os nomes OTel ficam na exportação e no detalhe), linha de hook pelos
atributos (`hook Stop · bash · ok · 31 ms`), `pi.hook Status` com saída 0 fora da lista (continua exportado) e vizinhos
iguais numa linha com `×n`. Rodapé por aba, dica quebrada só entre itens, `tab aba` / `shift+tab`, e em telas estreitas
o cabeçalho mostra `● <aba> i/n`.
