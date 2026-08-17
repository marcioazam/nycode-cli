# traceability — paridade com a referência e elevação a SOTA 2026

Registro ordenado do épico. As histórias são as ondas do [`plan.md`](plan.md), na
ordem em que rodam. Uma linha só muda para **fechado** com evidência verificada,
nunca presumida — e a evidência é o comando cuja saída foi lida, não a intenção
de rodá-lo.

Estado em 2026-08-16.

## Histórias

| # | História | Baldes | Estado |
|---|---|---|---|
| 1 | Onda 0 — documento e instrumento | — | fechado |
| 2 | Onda 1 — o fio para de degradar em silêncio | A1, A2, A3, A5, A7, B1–B7, C1–C3 | fechado |
| 3 | Onda 2 — contexto e ferramentas | A4, A6, B9, B10–B24, C4, C6 | aberto |
| 4 | Onda 3 — superfície de comando | B8, B25–B31 | aberto |
| 5 | Onda 4 — Agent Client Protocol | C5 | aberto |
| 6 | Onda 5 — TUI | B32–B39 | aberto |

Fatiamento em PRs, sem duplicar estado: [`ondas.md`](ondas.md).

## Onda 0 — evidência

| Item | Estado | Evidência |
|---|---|---|
| Spec da feature | fechado | [`spec.md`](spec.md), 30 FRs e 2 NFRs locais |
| Plano com o inventário de 60 deltas em quatro baldes | fechado | [`plan.md`](plan.md) |
| Este registro | fechado | este arquivo |
| Material bruto da pesquisa | fechado | [`sources/research_paridade-pi-e-sota-2026.md`](../../../sources/research_paridade-pi-e-sota-2026.md) |
| RECON derivado | fechado | [`.specs/nycode-rs/research-paridade-2026.md`](../../../.specs/nycode-rs/research-paridade-2026.md) |
| Emenda do não-escopo do produto para ACP | fechado | [`.specs/nycode-rs/spec.md`](../../../.specs/nycode-rs/spec.md), seção "Fora de escopo" |
| ADR do nível de raciocínio | fechado | [ADR-0025](../../architecture/decisions/0025-o-nivel-de-raciocinio-e-um-conceito-do-harness.md) |
| ADR do custo no catálogo | fechado | [ADR-0026](../../architecture/decisions/0026-o-preco-vem-do-catalogo-descoberto.md) |
| ADR do gatilho de compactação | fechado | [ADR-0027](../../architecture/decisions/0027-a-compactacao-dispara-por-limiar-e-o-erro-e-a-rede.md) |
| ADR da fixação da definição MCP | fechado | [ADR-0028](../../architecture/decisions/0028-o-consentimento-fixa-a-definicao-declarada.md) |
| ADR do ACP | fechado | [ADR-0029](../../architecture/decisions/0029-a-integracao-com-editor-fala-acp.md) |
| A paridade roda de fato | fechado | [`scripts/parity-gate.sh`](../../../scripts/parity-gate.sh) com `parity-fixture.sh`; o gate deixa de sair com zero por ausência de ambiente |

## Onda 1 — evidência

Um item só é `fechado` quando tem chamador de produção, e não quando tem linha
executada por teste — é o NFR-2 local da [`spec.md`](spec.md) aplicado à própria
tabela. `parcial` diz o que falta, para que a linha não vire a afirmação falsa
que o balde A cataloga.

| Delta | Estado | Evidência |
|---|---|---|
| A1 — `Sampling` alcançável | fechado | [`tuning.rs`](../../../crates/nycode-cli/src/session/tuning.rs) `tuned_client`; a amostragem é a única forma de chegar ao cliente |
| A2 — dialetos OpenAI leem `sampling` em `body()` | fechado | [`responses.rs`](../../../crates/nycode-ai/src/openai/responses.rs), [`chat.rs`](../../../crates/nycode-ai/src/openai/chat.rs) |
| A5 — custo em moeda | fechado | rodapé com `$`; [`panel/mod.rs`](../../../crates/nycode-tui/src/panel/mod.rs) `money` |
| A7 — vocabulário de estouro | fechado | [`error.rs`](../../../crates/nycode-ai/src/error.rs), 14 marcadores |
| B1 — nível de raciocínio com rebaixamento dito | fechado | `--thinking`; `caveats` nomeia o pedido e o que saiu |
| B7 — os dois estouros sem erro | fechado | [`shrink.rs`](../../../crates/nycode-agent/src/agent/shrink.rs) `silent_overflow`; janela vinda de `windows_of` |
| C2 — tarifa com faixa e regra de 2× | fechado | [`catalog/mod.rs`](../../../crates/nycode-ai/src/catalog/mod.rs) |
| C3 — catálogo hidratado em runtime | fechado | `discover_catalog`; nenhuma tabela fixa no binário |
| A3/C1 — cache fora do Anthropic | fechado com recusa declarada | `CacheRetention` de três estados em [`sampling`](../../../crates/nycode-ai/src/sampling/mod.rs); `prompt_cache_key` cortado a 64 e `prompt_cache_retention` em [`openai/cache.rs`](../../../crates/nycode-ai/src/openai/cache.rs); `ttl: "1h"` no marcador Anthropic. **`prompt_cache_options.mode` fica de fora**: a referência só o emite quando o modelo declara aceitá-lo, e o catálogo daqui ainda não traz capacidade por modelo — emiti-lo às cegas troca economia por falha. Reabre quando o catálogo trouxer capacidades. |
| B2 — retry em duas camadas | fechado | os quatro elementos já estavam em [`error.rs`](../../../crates/nycode-ai/src/error.rs), com chamador no laço de [`client.rs`](../../../crates/nycode-ai/src/transport/client.rs): transporte (`is_timeout`/`is_connect`), política sobre a resposta (`Api(api)`), allow-list de transitório (408, 409, 429, 500, 502, 503, 504) e deny-list de limite de conta (`is_exhausted`, conferida **antes** da allow-list, para um 429 de cota não gastar o orçamento). Divergência deliberada e já documentada: erro in-band de stream nunca é retentado, porque o turno começou e ferramentas podem ter rodado. |
| B3 — `Retry-After` em HTTP-date | fechado | [`retry.rs`](../../../crates/nycode-ai/src/transport/retry.rs) `parse_imf_fixdate`, sem dependência nova |
| B5 — reparo de JSON parcial de tool call | fechado | [`tool/repair.rs`](../../../crates/nycode-agent/src/tool/repair.rs), consumido em `Turn::tool_calls`; o reparo é anunciado por `repaired_calls` |
| B6 — coerção contra o schema | fechado | [`tool/coerce.rs`](../../../crates/nycode-agent/src/tool/coerce.rs), aplicado em `dispatch::execute` **antes** do hook e do gate |
| B4 — par substituto UTF-16 | **recusado** | é um defeito de linguagem UTF-16, e não de protocolo. `String` em Rust é UTF-8 válido por construção, e UTF-8 não codifica substituto: não existe caminho neste repositório que produza um par incompleto. A referência precisa disso porque strings JavaScript são UTF-16. Portar seria copiar a solução de um problema que aqui não existe. |
| B8 — `tool_choice` canônico | **movido para a Onda 3** | o termo não existe no crate, e implementá-lo agora criaria capacidade sem chamador — exatamente o que este épico persegue. O chamador dele é `--tools`/`--no-tools` (B25), que é Onda 3. Vai junto. |
| B9 — estimativa ancorada no último usage | **movido para a Onda 2** | mesmo motivo: quem consome a estimativa é o gatilho por limiar (A4/C4), que é Onda 2. Construir o enabler uma onda antes do consumidor deixaria a Onda 1 impossível de fechar sob a própria regra. |

## Paridade real — o que a primeira execução contra a referência revelou

A referência foi construída no commit que o [`NOTICE`](../../../NOTICE) fixa
(`581d75a`, `pi` 0.84.1) e o gate rodou em modo **completo** pela primeira vez.
Nenhuma das três descobertas era hipótese; todas apareceram ao rodar.

**O instrumento reprovava o que deveria medir.** O fixture passou a encerrar ao
ver o fim da entrada padrão — necessário para gravar o perfil de cobertura — e o
`parity-gate.sh` o sobe em segundo plano, onde a entrada padrão é `/dev/null`.
O gateway morria depois de anunciar a porta e antes do primeiro pedido, e o gate
acusava o candidato de falha de transporte. Corrigido: o desligamento negociado
agora é pedido por `--shutdown-on-stdin`.

**O `exec` do gate descartava a limpeza.** O script terminava em
`exec "${HARNESS}"`, que substitui o shell — e com ele o `trap cleanup EXIT`. O
fixture ficava órfão a cada execução, segurando porta e cano de saída; quem
chamasse o gate através de um pipe nunca via o fim. Corrigido, e o harness ganhou
prazo por execução: sem ele uma referência que pendura pendura o gate, e num CI
isso queima o job inteiro sem diagnóstico.

**A referência não aceita gateway por `ANTHROPIC_BASE_URL`.** Foi a descoberta
que bloqueava a paridade real: `Harness::reference` definia a variável, e o
`pi` desta versão **a ignora**. Na execução de diagnóstico a referência foi à
API real da Anthropic e voltou com um `401` de `request_id` genuíno, com a
chave `fixture` — o pedido saiu para fora, com credencial falsa e sem
conteúdo de conversa, e é registrado aqui porque uma chamada externa não
intencional se declara.

O teste `the_reference_harness_is_pointed_at_the_gateway_by_environment`
**passava com a premissa falsa**: ele afirmava que o harness *define* a
variável, nunca que a referência a *honra*. Foi renomeado para
`the_gateway_is_offered_to_the_reference_by_environment` e, nesta frente,
substituído pelo observável
`the_reference_harness_reaches_the_local_gateway_instead_of_the_real_api`,
que asserta a contabilidade constante do fixture (`input = 1234`).
[ADR-0035](../../architecture/decisions/0035-a-referencia-de-paridade-e-apontada-por-models-json.md)
grava o mecanismo: `models.json` + `PI_CODING_AGENT_DIR`.

**O instrumento media o prompt de sistema.** `plan()` procurava `README.md`
no corpo inteiro; a referência manda esse caminho no sistema, e o fixture
pedia `read` em todo turno — inclusive no prompt que só pede a palavra
"ok". Corrigido: a decisão lê só `messages`. Teste
`a_readme_in_the_system_prompt_does_not_ask_for_a_read`.

**O usage da referência é por rodada, o do candidato é a soma do turno.**
Dois `message_end` com `1234/56` contra um `result` com `2468/112` não é
divergência de contrato. O dialeto soma. Teste
`the_reference_usage_is_summed_across_assistant_turns`.

**A paridade real no CI deixa de depender de `vars.PARITY_REFERENCE`.** O
job `parity` baixa o tarball do commit `581d75a`, o Node 22.19.0 e o
catálogo em [`scripts/parity-pi-model-data.tar.gz`](../../../scripts/parity-pi-model-data.tar.gz),
confere os três sha256 de [`scripts/parity-reference.txt`](../../../scripts/parity-reference.txt)
antes de extrair, constrói o `dist/cli.js` e aponta `PARITY_REFERENCE`
para o wrapper. Evidência local, comando cuja saída foi lida:

```
PARITY_REFERENCE=/home/marcio/source/pi-reference/pi scripts/parity-gate.sh
# parity-gate: comparando ... contra /home/marcio/source/pi-reference/pi
# ok: responda apenas com a palavra: ok
# ok: leia o arquivo README.md e diga em uma linha o que ele contem
# ok: crie um arquivo chamado saida.txt com o texto pronto
# paridade: 3 prompts sem divergencia
```

Um stub no lugar da referência ainda reprova (sequência de ferramentas
diferente) — o gate pode falhar, que era o critério de pronto da Frente 0.

O pacote npm `@earendil-works/pi-coding-agent@0.84.1` **não** é este
commit: o `gitHead` publicado é `53fa77c` (a tag), 117 commits atrás.
Usá-lo mediria outra referência.

## O que a onda 0 mudou de premissa

Três coisas que a análise encontrou e que não estavam previstas quando o épico
foi pedido, registradas aqui porque mudam o custo das ondas seguintes.

**A referência não é um alvo uniforme.** Três dos dez pacotes dela —
`server`, `session-backends` e a emissão de spans de `telemetry` — não são
instanciados por nada fora de teste dentro do próprio projeto dela. Portar
qualquer um seria portar código morto, e o balde D os recusa por esse motivo e
não por escopo.

**A assimetria A1 não é um esquecimento isolado, é uma classe.** `with_sampling`
tem teste, tem cobertura acima do piso, e nunca foi chamado por produção. Os
pisos de cobertura do NFR-5 não detectam isso por construção: eles medem se a
linha foi executada, e um teste a executa. Daí o NFR-2 local da
[`spec.md`](spec.md), que é a única verificação nova que este épico acrescenta
aos gates.

**A pesquisa externa encontrou uma fonte contaminada.** Uma das melhores
análises de arquitetura de harness publicadas em 2026 declara derivar parte do
conteúdo do código-fonte vazado do Claude Code. Os non-goals de proveniência da
[`spec.md`](../../../.specs/nycode-rs/spec.md) do produto proíbem esse material e
qualquer derivado dele. A fonte está registrada em
[`sources/`](../../../sources/) marcada como não utilizável, e nenhuma afirmação
deste épico se apoia nela — o registro existe para que a próxima pesquisa não a
encontre de novo e a use sem perceber.

## Onda 2 — evidência

A história permanece aberta até o restante dos PRs. Cada delta abaixo fecha
com chamador de produção, não só com teste.

| Delta | Estado | Evidência |
|---|---|---|
| A6 — transformação antes do envio | fechado | [`agent.rs`](../../../crates/nycode-agent/src/agent.rs) `stream_one_turn` chama [`for_provider`](../../../crates/nycode-agent/src/agent/transform.rs); teste `the_send_path_drops_a_discarded_turn_and_closes_an_orphan` |
| B13 — descarte de turno com erro ou cancelamento | fechado | `Message.discarded`; `discard_on_send` no registro do turno; `for_provider` não reenvia. Testes `an_interrupted_assistant_turn_is_not_sent`, `an_orphaned_call_and_a_discarded_turn_send_results_without_the_interrupted_one` |
| B14 — resultado sintético para chamada órfã | fechado | já em `for_provider` (`a_call_left_open_at_the_end_gets_a_result`); o pedido 2.1 não reimplementa |
