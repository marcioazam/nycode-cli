# Pesquisa: /plan SOTA 2026 (2026-11-13)

Dois scouts rodaram em paralelo:
- `perplexity-scout`: Perplexity + Keenable, leitura com `web_fetch`.
- `web-scout`: keenable, parallel, paper_search e exa, sem Perplexity.

Cada linha abaixo diz o que foi lido de fato. "snippet" significa que o trecho veio de excerto de busca, não da página aberta inteira. Os relatórios completos estão no transcript da sessão de 2026-11-13.

## Técnicas adotadas

| # | Técnica | Fonte (lida) | Onde entra |
|---|---|---|---|
| 1 | Plan mode read-only. Só escreve `.md` no diretório de planos. | Gemini CLI https://geminicli.com/docs/cli/plan-mode/ ("`write_file` and `replace` only allowed for `.md` files in the … plans directory"); OpenCode https://dev.opencode.ai/docs/permissions/ ("denies edits except files under `~/.opencode/plan`") | patch (AC4) |
| 2 | Critério de "mutar" é o efeito sobre o estado, não o nome da ferramenta. Pedido de execução dentro do plan mode vira "planejar a execução". O plano precisa sair *decision complete*. | Codex `plan.md` https://github.com/openai/codex/blob/main/codex-rs/collaboration-mode-templates/templates/plan.md ("must be **decision complete**, where the implementer does not need to make any decisions") | skill P0, P8 |
| 3 | Fatos são descobertos pelo agente, não perguntados ao usuário. | Codex `plan.md` ("Eliminate unknowns in the prompt by discovering facts, not by asking the user"); Pocock grilling ("Finding _facts_ is your job") | skill P2 |
| 4 | Frontier em rodadas: perguntas numeradas, cada uma com resposta recomendada; parar quando a frontier esvazia. | https://raw.githubusercontent.com/mattpocock/skills/main/skills/productivity/grilling/SKILL.md (commit `5863806`, MIT) | skill P3 |
| 5 | Cobertura em 10 categorias (Clear/Partial/Missing) e prioridade por Impacto × Incerteza. Até 5 perguntas por passada. Recomendação primeiro, com uma linha de motivo; "sim" aceita. | Spec Kit 1.4.0 `clarify.md` https://github.com/github/spec-kit/blob/main/templates/commands/clarify.md | skill P1/P3, `question-policy.md` |
| 6 | Checklist como "unit tests for English": testa a qualidade dos requisitos, não a implementação. ≥80% dos itens têm rastreio (`[Spec §]`, `[Gap]`, `[Ambiguity]`, `[Conflict]`, `[Assumption]`). | Spec Kit `checklist.md` | `checklists.md` |
| 7 | Analyze read-only por severidade (CRITICAL..LOW): duplicação, ambiguidade, subespecificação, lacuna de cobertura, inconsistência. | Spec Kit `analyze.md` | skill P7 |
| 8 | Aceitação em EARS ("WHEN … THE SYSTEM SHALL …"). Design com componentes, dados e interfaces, erros e estratégia de testes. Tarefas discretas com resultado esperado, dependências e marca de opcional. | Kiro https://kiro.dev/docs/specs/feature-specs/requirements-first | skill P4/P5 |
| 9 | grill-with-docs: o termo resolvido vai para o glossário na hora. ADR só quando passa 3 portões: difícil de reverter, surpreendente sem contexto, trade-off real. O que foi decidido mas não registrado se perde entre etapas, então mantém-se um log de decisões. | Pocock `grill-with-docs` + issue #341 (snippet) | skill P4 |
| 10 | Fatias verticais (tracer bullets) com arestas "bloqueia", dimensionadas para caber numa janela de contexto limpa. A ordem de execução segue a frontier pronta. | Pocock `to-tickets` | skill P5 |
| 11 | Formato da tarefa: nome, arquivos, ler-antes, ação, verificação, aceitação, pronto. A tarefa traz `depends_on` e cabe num contexto. Um plan-checker independente roda em loop até passar ou bater o limite de iterações. | GSD (open-gsd/gsd-core, README lido; `plan-md.md` snippet) | skill P5/P7 |
| 12 | Etapas puláveis: brief, fluxos, plano técnico, tickets, execução, revisão. Revisão por lote contra o plano; drift de produto para a execução. Avaliador separado do construtor. | Traycer https://docs.traycer.ai/concepts/artifact-workflow | tiers, plan-reviewer |
| 13 | Planejar proporcional ao gap: "complete enough that someone else could build it without guessing". Suposições tagueadas (`[ASSUMPTION]`). Cada ponto aberto recebe um destino: decidir agora, spike ou deixar para a tarefa. | BMAD docs (snippet) | skill P0/P3 |
| 14 | Perguntar demais custa. Um monitor separado de intenção/ambiguidade decide quando perguntar e chega perto do interativo (69,4% contra 70,4%) sem perguntar em todo caso. A spec completa dá 70,8%; sem perguntar, 54,8%. | Edwards & Schuster, *Ask or Assume?* https://arxiv.org/abs/2603.26233 (lido) | skill P1 (portão de ambiguidade explícito) |
| 15 | Modelos identificam ambiguidade quando forçados a julgá-la, mas por padrão respondem direto. Por isso o julgamento de ambiguidade tem que ser um passo obrigatório. | Su & Cardie https://arxiv.org/abs/2605.25284 (abstract) | skill P1 |
| 16 | A qualidade da clarificação cai quando há muitas ambiguidades: priorizar e limitar. Muitas perguntas não melhoram o resultado. | ClarifyCodeBench https://arxiv.org/abs/2607.00711, Ambig-SWE https://arxiv.org/pdf/2502.13069 (abstract/snippet) | limites por tier |
| 17 | Pre-mortem: quem verifica cada unidade, num contexto distinto do autor? Cada passo é porta de mão única ou de duas mãos? Para os de mão única, qual o custo de desfazer e o ponto sem volta? | agentops premortem (snippet; efeito não medido) | `checklists.md` |
| 18 | O AskUserQuestion do Claude tem 2–4 opções, header ≤12 caracteres e `multiSelect`; o plan mode explora antes de perguntar. A ferramenta de pergunta nunca é aprovada automaticamente. | https://code.claude.com/docs/en/agent-sdk/user-input, https://code.claude.com/docs/en/permission-modes | question-policy |
| 19 | O plano é arquivo `.md` editável; salvar no workspace é um passo explícito. | Cursor https://cursor.com/docs/agent/plan-mode | patch (arquivo) + materialização em /docs |

## Rejeitado ou adaptado

- Um número fixo de 3–5 perguntas (prompt "Mob Elaboration"): trocado pelo portão adaptativo (itens 14–16).
- O formato XML do GSD: o tracker do pi lê linhas numeradas, então os campos da tarefa viram bullets.
- `to-spec` diz "sem caminhos de arquivo". O contrato local manda nomear caminhos reais (planning-checklist), e isso prevalece.
- O número "60% → 100%" do ASP pre-mortem é demo do autor e foi ignorado.

## Lacunas

- Não confirmados por leitura: o limite de 1–4 perguntas por chamada do AskUserQuestion, o `~/.claude/plans` default, o texto de aprovação do Claude, o `request_user_input` do Codex e os to-dos do Cursor.
- Páginas lidas só por snippet: BMAD, GSD e Traycer plan-a-feature.
- Nenhum resultado revisado por pares sobre o valor esperado de perguntar em agentes de código, além de abstracts.
- A meta de "99% de acerto" não tem base empírica. Fica como alvo medido pelo eval local (tarefa 9).

## Rodada 2 (2026-11-13, perplexity-scout + Keenable)

Só as linhas verificadas na fonte entram como base de decisão.

| Achado | Fonte | Uso |
|---|---|---|
| ExecPlan: 12 seções, 4 vivas (Progress, Surprises & Discoveries, Decision Log, Outcomes & Retrospective); plano autocontido; "Explicit acceptance: state behaviors, commands, and observable outputs that prove success." | https://raw.githubusercontent.com/openai/openai-agents-python/main/PLANS.md | D11; regra `check:` do lint |
| Kiro: "For quick, well-understood changes, skip planning and work directly with the default agent." | https://kiro.dev/docs/specs/plan/ | atalho T0 (D7) |
| Confiança verbalizada é superconfiante e nenhuma técnica vence sempre (Xiong et al., ICLR 2024) | https://arxiv.org/abs/2306.13063 | D9 |
| Cache: leitura a 0,1x, escrita de 5 min a 1,25x | https://platform.claude.com/docs/en/build-with-claude/prompt-caching | contexto injetado estável; revisão em contexto novo só em T3 (D8) |
| Cursor (plano editável em markdown), Antigravity (comentário por passo), Claude Code `opusplan` | cursor.com/docs/agent/plan-mode, antigravity.google/docs/plan/, code.claude.com/docs/en/model-config | já coberto (arquivo de plano, pins por agente) |

Não verificado (só snippet; não usado como base): "plano ruim é pior que plano nenhum" (arXiv 2604.12147), RigorBench, Agent GPA, TQS, semáforo de confiança do Devin, DINCO, limite de 2.000 palavras por ExecPlan. Não encontrado: evidência de que planos mais longos melhoram o resultado; página oficial do plan mode do Codex.
