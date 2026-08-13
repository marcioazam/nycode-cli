# RECON — o que "SOTA 2026" exige de um harness de terminal

**Data:** 2026-08-13 · **Passes:** 4 · **Confiança:** ~90%

Complementa o [`research.md`](research.md) original, que fundamentou a decisão
de portar. Este documento fundamenta a [emenda de escopo](spec.md#emenda-de-escopo--2026-08-13)
que acrescentou FR-11 a FR-20 e NFR-7.

## Método

Quatro passes: descoberta ampla com dois motores em paralelo, extração das
fontes de maior sinal, validação cruzada, e preenchimento das lacunas que
ficaram abaixo de 75% de confiança. As fontes brutas estão em
[`sources/`](../../sources/).

## Achados

Ordenados por impacto sobre a decisão de escopo.

**1. A base comum de 2026 é maior que o escopo original da spec.** O
levantamento de 35 agentes ativos é explícito: "By 2025 every serious agent had
the same skeleton: edit-run-test loop, project instructions file, MCP, plan
mode, permission prompts, headless mode. None of that separates anyone anymore."
O NyCode CLI atendia dois desses seis. Confiança: alta. Impacto: crítico.

**2. A referência declarada tem uma superfície muito maior que a portada.** O
`pi` entrega sessão em árvore com `/tree`, `/fork` e `/clone` num arquivo só;
quatro modos de execução, sendo um deles RPC sobre stdin/stdout; enfileiramento
e direcionamento de mensagem durante o turno; slash commands como templates de
markdown; troca de modelo no meio da sessão; contabilidade de custo e de cache
no rodapé; sete ferramentas embutidas, não quatro. Confiança: alta, o material é
a documentação do próprio projeto. Impacto: crítico.

**3. As quatro ferramentas do `pi` não são quatro.** O padrão é `read`, `write`,
`edit`, `bash`, e existem `grep`, `find` e `ls` adicionais, desligados por
padrão, "if you want to restrict the agent from modifying files or running
arbitrary commands". O `READ_ONLY` de `permission.rs` já nomeia exatamente esses
quatro, três dos quais não existem no NyCode CLI — o gate foi escrito contra um
conjunto de ferramentas que ninguém implementou. Confiança: alta. Impacto: alto.

**4. Confinamento de SO virou base, e o `pi` não o tem.** O Codex CLI aplica
Seatbelt no macOS, bubblewrap no Linux e WSL2, e sandbox nativo no Windows. A
documentação da OpenAI dá a razão em uma frase: "The sandbox reduces approval
fatigue" — sem confinamento, o agente pergunta a cada comando ou não pergunta
nunca. É o eixo em que o NyCode CLI pode superar a referência em vez de
alcançá-la. Confiança: alta. Impacto: alto.

**5. `unsafe_code = "forbid"` decide a forma do sandbox, não o objetivo.**
Elimina FFI direto para `sandbox_init` e `landlock_*`. Sobram wrappers seguros
(`landlock` 0.4.x, `seccompiler` 0.5) e delegação a executável (`bwrap`,
`sandbox-exec`). `birdcage` cobriria Linux e macOS numa API só mas depende de
`seccompiler` 0.3; `extrasafe` tem a melhor ergonomia e só suporta `x86_64`, o
que quebraria o alvo `aarch64` que o release já publica. Confiança: alta.
Impacto: alto. Registrado no [ADR-0005](../../docs/architecture/decisions/0005-sandbox-de-so-por-processo-auxiliar.md).

**6. O MCP mudou de forma quebrante e vai continuar mudando.** A revisão
`2026-07-28` tornou o núcleo stateless, trocou as requisições
servidor-para-cliente por Multi Round-Trip Requests, exige headers `Mcp-Method`
e `Mcp-Name`, elevou os esquemas a JSON Schema 2020-12 completo, depreciou
HTTP+SSE, Roots, Sampling e Logging, e trocou o erro de recurso ausente de
`-32002` para `-32602`. Existe SDK oficial em Rust, `rmcp`, Apache-2.0, com
transportes de cliente prontos. Confiança: alta. Impacto: alto. Registrado no
[ADR-0004](../../docs/architecture/decisions/0004-cliente-mcp-usa-o-sdk-oficial-rmcp.md).

**7. Engenharia de custo virou feature.** O caso extremo relatado é de 435M
tokens de entrada num dia com 99,82% de acerto de cache, por manter o prefixo
byte-estável entre turnos. O NyCode CLI já contabiliza `cache_read_tokens` e
`cache_write_tokens` na resposta, e não emite `cache_control` no pedido. A
métrica existe sem a causa. Confiança: média — o número é auto-reportado pelo
projeto e não foi reproduzido por terceiro; o mecanismo, porém, é o documentado
pelos provedores. Impacto: alto. Virou NFR-7.

**8. Subagentes deixaram de ser diferencial.** Presentes em Claude Code, Codex,
Copilot CLI, OpenCode, Grok Build e Kimi Code. O `pi` os recusa por decisão
explícita e recomenda tmux. Incluir é divergir da referência, o que o NFR-6
obriga a registrar. Confiança: alta. Impacto: médio-alto. Registrado no
[ADR-0007](../../docs/architecture/decisions/0007-subagentes-sao-in-process-divergindo-da-referencia.md).

**9. O modelo de TUI é uma escolha binária, e a referência escolheu scrollback.**
Duas famílias: posse do viewport como buffer de células (Amp, opencode,
`ratatui`) contra escrita no scrollback com redesenho diferencial (Claude Code,
Codex, `pi`). O detalhe operacional que evita flicker é envolver as atualizações
em saída sincronizada, `CSI ?2026h` e `CSI ?2026l`. Confiança: alta. Impacto:
médio-alto. Registrado no [ADR-0008](../../docs/architecture/decisions/0008-a-tui-usa-o-renderizador-proprio-sobre-o-scrollback.md).

**10. Compactação não substitui reset de contexto.** A Anthropic relata
"context anxiety" — modelos encerrando trabalho cedo ao se aproximarem do que
julgam ser o limite — e observa que a compactação preserva continuidade sem dar
página limpa, de modo que a ansiedade persiste. Isso muda o alvo da compactação
de "sempre compactar" para "compactar sob pressão, resetar com artefato de
handoff quando a tarefa é longa". Confiança: média-alta. Impacto: médio.

**11. Separar quem faz de quem julga é alavanca forte.** Agentes avaliando o
próprio trabalho o elogiam. Calibrar um avaliador cético é mais tratável que
tornar o gerador crítico de si. Reforça que o subagente precisa ter contexto
próprio de verdade, e não uma cópia do contexto do pai. Confiança: média-alta.
Impacto: médio.

**12. Governança de padrão reduz risco de migração.** MCP, AGENTS.md e ACP
estão sob a Agentic AI Foundation. No mesmo período, o Gemini CLI teve o acesso
de consumidor encerrado com um mês de aviso, com 103k estrelas. Escolher
padrões governados é escolher a rota de saída. Confiança: alta. Impacto: médio.

**13. A pontuação de benchmark é majoritariamente do modelo, não do harness.**
O `mini-SWE-agent`, cerca de 100 linhas de Python com só `bash`, permanece
competitivo. E 19,78% dos casos marcados como resolvidos no topo do SWE-bench
Verified foram apontados como semanticamente incorretos. Consequência prática:
não perseguir leaderboard como critério de aceite. Confiança: média — a análise
de 19,78% vem de fonte secundária. Impacto: médio, e o efeito é negativo, isto
é, evita trabalho.

## Questões em aberto

- **Custo real da Onda C.** Só se resolve com o esqueleto da TUI rodando. É a
  mesma questão de impacto alto que o `research.md`:121-129 registrou e que
  nenhum ADR fechou até agora. Impacto: alto.
- **Peso de `rmcp` no binário.** Conhecido apenas depois de integrar; NFR-3 é o
  limite. Impacto: médio.
- **Se a política `workspace-write` é restritiva demais na prática.** O sinal a
  observar é usuários passando `--no-sandbox` por hábito. Impacto: médio.

## Fontes

- [State of CLI Coding Agents, Mid-2026](https://blog.arcbjorn.com/state-of-cli-coding-agents-2026) — levantamento de 35 agentes ativos, comparação por área.
- [Coding Agent Harness Comparison 2026](https://techstackups.com/comparisons/coding-agent-harness-comparison-2026/) — licença, modelo de negócio, flexibilidade de provider.
- [What I learned building an opinionated and minimal coding agent](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/) — o autor do `pi` sobre TUI diferencial, prompt mínimo e conjunto de ferramentas.
- [pi — README do coding-agent](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md) — superfície de comandos, formato de sessão em árvore, modos de execução.
- [Codex — Sandbox](https://developers.openai.com/codex/concepts/sandboxing) — enforcement por plataforma e a relação entre sandbox e fadiga de aprovação.
- [The 2026-07-28 MCP Specification](https://blog.modelcontextprotocol.io/posts/2026-07-28) — protocolo stateless, MRTR, headers de roteamento.
- [MCP 2026-07-28: what changed, what breaks](https://stacktr.ee/blog/mcp-2026-spec-changes) — política de depreciação e janela de doze meses.
- [Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps) — context anxiety, reset contra compactação, gerador e avaliador separados.
- [rmcp — documentação](https://docs.rs/rmcp) — features de transporte e backends de TLS.
- [landlock](https://crates.io/crates/landlock), [seccompiler](https://crates.io/crates/seccompiler), [extrasafe](https://crates.io/crates/extrasafe), [birdcage](https://crates.io/crates/birdcage) — opções de confinamento em Rust e suas restrições.

## Cálculo da confiança

Média ponderada por impacto, com pesos crítico 1,0, alto 0,7, médio 0,5. Os
achados de confiança alta dominam a soma; os dois de confiança média — o número
de cache do Reasonix e a análise de 19,78% do SWE-bench — são também os de menor
peso, e nenhum deles sustenta sozinho uma decisão de escopo. Resultado ~90%,
acima do piso de 85% que autoriza seguir para planejamento.
