# 0005: escopo do núcleo (harness generalista)

Estado: regra e checagem de classificação adotadas (2026-11-16). A mudança das peças `optional` para fora do contexto
do modelo é outro pull request, medido no gate (K3c), porque mexe em custo e acerto.

## Pergunta

O ny-pi deve trazer só peças generalistas, como um harness "vanilla", e deixar as de domínio, de serviço ou de gosto
pessoal como opção?

## Evidência (fontes primárias lidas em 2026-11-16)

O que outros harnesses trazem de fábrica:

| Harness | Embutido | Opcional |
|---|---|---|
| Claude Code | Subagentes Explore, Plan e general-purpose; poucas skills gerais (`/doctor`, `/code-review`, `/batch`, `/debug`, `/loop`, `/claude-api`), desligáveis com `disableBundledSkills` ([sub-agents](https://code.claude.com/docs/en/sub-agents), [skills](https://code.claude.com/docs/en/skills)) | Plugins do marketplace oficial e de terceiros ([plugins](https://code.claude.com/docs/en/plugins)) |
| Codex | Só skills de meta, `skill-creator` e `skill-installer`, desligáveis por projeto; a lista de skills ocupa no máximo 2% da janela ou 8.000 caracteres ([build-skills](https://developers.openai.com/codex/build-skills)) | O resto, via `$skill-installer` ou plugins |
| OpenCode | Agentes Build e Plan; subagentes General e Explore ([agents](https://opencode.ai/docs/agents/)) | Plugins e skills do usuário |
| pi | "ships with powerful defaults but skips features like sub-agents and plan mode" ([README](https://github.com/earendil-works/pi)) | Pacotes e extensões |
| Factory Droid | Droids `worker` e `explorer` ([subagents](https://docs.factory.com/harness/subagents)) | Marketplace de plugins |
| Cursor | Subagentes de contexto (Explore, Browser) e um conjunto pequeno de skills gerais ([skills](https://cursor.com/docs/skills), [subagents](https://cursor.com/docs/subagents)) | Plugins revisados à mão |
| Gemini CLI | Subagentes `codebase_investigator`, `cli_help` e `generalist` ([subagents](https://geminicli.com/docs/core/subagents/)) | Extensões com skills, MCP, hooks e comandos |
| DeepSeek Harness | Arquitetura "everything is a plugin", em developer preview; o README não lista o que vem embutido ([repo](https://github.com/deepseek-ai/deepseek-harness)) | Plugins |

Nenhuma dessas fontes escreve um critério de "núcleo ou opcional". O critério se lê no que cada uma embute. Todas
trazem ferramentas básicas, de 2 a 4 subagentes genéricos e, no máximo, um punhado de skills gerais ou de meta. Domínio,
serviço externo e preferência ficam em plugin. Ninguém vem totalmente "cru": até o pi traz bons padrões, e o mais enxuto
corta também subagentes e plano.

Custo de peças a mais no contexto do modelo:

- Com 1.000 skills irrelevantes, o recall de skills carregadas cai de 73,6% para 27,4% e o "não carregou nenhuma" sobe
  de 9,3% para 51,6% ([arXiv 2610.18522](https://arxiv.org/abs/2610.18522)).
- Skills focadas (no máximo três módulos) superam pacotes grandes ou exaustivos ([SkillsBench, arXiv 2602.12670](https://arxiv.org/abs/2602.12670)).
- Carregar todas as definições custa caro: 58 ferramentas consomem cerca de 55 mil tokens. Com busca de ferramentas, a
  escolha certa sobe de 49% para 74% no Opus 4. As falhas mais comuns são ferramenta errada e nomes parecidos
  ([Anthropic, advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use)).
- No ny-pi: 26 skills visíveis custam cerca de 3,5 mil tokens por turno, e houve 0 leituras de `SKILL.md` em 265 sessões
  de benchmark (K3c, registro do follow-up A).

## Conclusão

Sim, núcleo generalista, mas não "virgem". O ny-pi segue o padrão comum: ferramentas e subagentes genéricos e um
conjunto pequeno de skills de engenharia que valem para qualquer linguagem e projeto. Ficam fora do núcleo as peças de
domínio, as que exigem um serviço, conta ou MCP específico e as de gosto pessoal. Essas peças ficam como opção ou nem
entram no repositório. Uma skill de marketing não entra nem como opção.

## Regra

1. Uma peça entra no núcleo (`core`) quando cumpre tudo isto:
   - serve ao trabalho de programação em qualquer linguagem, tipo de projeto e domínio;
   - funciona só com as ferramentas embarcadas e o provedor do modelo, sem MCP, SaaS, conta ou ambiente pessoal
     específico;
   - não é preferência pessoal;
   - passou pela regra de custo × benefício contra Claude Code e pi puro.
2. Peça só de interface (`ui`) não entra no contexto do modelo e só muda o terminal. Pode vir ligada, como o TUI do
   próprio pi.
3. O resto é `optional`: fica no repositório, mas fora do contexto do modelo por padrão. Skill oculta com
   `disable-model-invocation: true`; agente, extensão, hook, comando ou plugin só com opt-in.
4. Código de diagnóstico ou temporário é `remove` e sai no próximo pull request que tocar a área.
5. Peça de domínio estreito (marketing, design visual, uma nuvem ou SaaS específicos) não entra no repositório.
6. O orçamento do que o modelo vê sempre continua no gate `instruction-budget`, que não deixa o catálogo crescer sem
   o rótulo `budget-increase`.
7. Toda peça embarcada aparece na tabela abaixo, com classe e motivo. `scripts/ci/lint/core_scope.py` falha quando falta uma
   peça, quando sobra uma linha de peça que não existe ou quando a classe é desconhecida.

## Classificação (2026-11-16)

Tipos: `skill` (`packages/coding-agent/resources/skills/<nome>/`), `agent` (`packages/coding-agent/resources/agents/<nome>.md`), `extension`
(`packages/coding-agent/src/extensions/<nome>/`), `hook` (`packages/coding-agent/resources/hooks/<nome>`, fora testes e `fixtures`),
`command` (`packages/coding-agent/resources/commands/<nome>.md`) e `plugin` (`claude-home/plugins/<nome>/` no ny-pi; no nycode a linha de status
vai para `packages/coding-agent/resources/statusline/`). Os caminhos são os de destino do mapa de migração (`docs/migration/ny-pi-core/`); as peças
chegam por fase e o `core_scope.py` é convertido em F3.

<!-- core-scope:begin -->
| Tipo | Nome | Classe | Motivo |
|---|---|---|---|
| skill | agent-routing | core | Escolha entre agentes e ferramentas, qualquer projeto |
| skill | agent-systems | optional | Domínio: projetar agentes e prompts de LLM |
| skill | atualizador | optional | Fluxo de entrega do dono; `git-workflow` cobre o geral |
| skill | code-simplification | core | Refatoração geral |
| skill | codegraph | optional | Exige o MCP codegraph |
| skill | context-economy | core | Custo de contexto, qualquer sessão |
| skill | deep-search | optional | Exige MCPs de busca |
| skill | diagnose | core | Depuração geral |
| skill | differential-review | core | Revisão de segurança de diff, geral |
| skill | doces-ou-travessuras | core | Detecta teste maquiado, geral |
| skill | engineering-standards | core | Padrões de código por linguagem |
| skill | git-workflow | core | Git geral |
| skill | graph-engineering | core | Decomposição de tarefa grande, geral |
| skill | insecure-defaults | core | Auditoria de padrões inseguros, oculta |
| skill | lane-integration | core | Integração de lanes paralelas |
| skill | loop-engineering | core | Laços com parada verificável |
| skill | perplexity-urls | optional | Exige o MCP Perplexity |
| skill | plan-workflow | core | Modo plano, oculta |
| skill | pr-review | core | Revisão de PR geral |
| skill | property-based-testing | core | Testes de propriedade, geral |
| skill | quality-gates | core | Cobertura e mutação, geral |
| skill | ripple-hunt | core | Referências velhas após edição |
| skill | sdd-workflow | core | Especificação antes de mudança grande |
| skill | security-audit | core | Auditoria de segurança geral |
| skill | sharp-edges | core | APIs perigosas, geral |
| skill | soteiros | optional | Auditoria de atualidade sob pedido, nicho |
| skill | swarm-orchestration | core | Delegação em lanes |
| skill | tdd | core | Teste antes, geral |
| skill | to-questionnaire | core | Perguntas para terceiros, oculta |
| skill | variant-analysis | core | Variantes de um bug, oculta |
| agent | Explore | core | Leitura de código, padrão do mercado |
| agent | Plan | core | Planejamento, padrão do mercado |
| agent | general-purpose | core | Agente geral, padrão do mercado |
| agent | swarm-worker | core | Escritor padrão das lanes |
| agent | code-reviewer | core | Revisão de diff |
| agent | test-author | core | Escrita de testes |
| agent | test-reviewer | core | Revisão de testes |
| agent | security-reviewer | core | Revisão de segurança |
| agent | reliability-reviewer | core | Revisão de falhas e recuperação |
| agent | gate-runner | core | Roda o gate uma vez |
| agent | git-delivery | core | Entrega git |
| agent | lane-integrator | core | Junta lanes |
| agent | plan-reviewer | core | Fecha plano aprovado |
| agent | research-scout | core | Fatos e versões com `web_fetch` |
| agent | perplexity-scout | optional | Exige o MCP Perplexity |
| agent | web-scout | optional | Exige MCPs de busca |
| agent | claim-verifier | optional | Papel do `deep-search` |
| extension | auto-resume | core | Retoma após erro transitório do provedor |
| extension | bash-timeout | core | Limite de tempo do shell |
| extension | bypass-permissions | core | Modo de permissão |
| extension | cache-prefix-probe | remove | Diagnóstico temporário |
| extension | compact-at-400k | core | Compactação de segurança |
| extension | completion-gate | core | Verificação antes de encerrar |
| extension | dev-commands | ui | `/copy-code` e `/keybindings` |
| extension | effort-sandwich | optional | Raciocínio high só no 1º turno do `pi -p` de topo (opt-in, spec 0009) |
| extension | footer-no-stats | ui | Rodapé |
| extension | git-checkpoint | core | Checkpoints git e `/rewind` |
| extension | headless-lean | core | Custo sem interface |
| extension | hooks | core | Hooks no formato do Claude Code |
| extension | no-context-files-covers-claude-md | core | Contexto sem duplicata |
| extension | no-web-search | core | Desliga busca que falha |
| extension | pi-docs | core | Prompt menor |
| extension | plan-gate | core | Plano aprovado vai ao fim |
| extension | prefix-cache-1h | core | Cache do prefixo |
| extension | puxar | optional | Importa sessão de outro perfil, uso pessoal |
| extension | sound-notify | optional | Som ao fim do turno, gosto pessoal |
| extension | sticky-prompt | ui | Última mensagem fixa |
| extension | syntax-check | core | Erro de sintaxe após edição |
| extension | todo-sync | core | Lista de tarefas em dia |
| extension | ui | ui | Editor, acessibilidade, `/diff` |
| extension | ui-visual | ui | Cabeçalho e ícones |
| extension | up-dequeue | ui | Seta para cima restaura a fila |
| hook | claims | core | Afirmação sem evidência |
| hook | dispatch | core | Despachante dos hooks |
| hook | fuzz | core | Testes de fuzz do parser do guard (só teste; sem efeito em runtime) |
| hook | graph_context.py | optional | Exige codegraph |
| hook | guard.py | core | Bloqueio de comando destrutivo |
| hook | impeccable_gate.sh | optional | Serve uma skill de design que o repositório não traz |
| command | cancel-ralph | core | Laço de prompt (par do `/loop` do Claude Code) |
| command | claude-hud-configure | optional | Plugin `claude-hud` |
| command | claude-hud-setup | optional | Plugin `claude-hud` |
| command | claude-tier | optional | Sonda de plano de conta Claude Team |
| command | clean_gone | core | Limpa branches mergeadas |
| command | code-review | core | Revisão de PR |
| command | commit | core | Commit |
| command | commit-push-pr | core | Commit, push e PR |
| command | diff-review | core | Revisão diferencial |
| command | insecure-defaults-audit | core | Auditoria de padrões inseguros |
| command | pre-launch | core | Fase do projeto prevista no contrato |
| command | ralph-help | core | Ajuda do laço de prompt |
| command | ralph-loop | core | Laço de prompt |
| command | review-pr | core | Revisão por aspectos |
| command | revise-claude-md | core | Aprendizado da sessão vira regra |
| command | skill-gen | optional | Exige o MCP Firecrawl |
| command | swarm | core | Delegação em lanes |
| plugin | claude-hud | optional | Barra de status de terceiro |
<!-- core-scope:end -->

## Próximo passo (pull request medido, #89)

Tirar do contexto do modelo as skills e agentes `optional` e pôr extensões, hooks, comandos e plugin `optional` atrás de
opt-in. Remover `cache-prefix-probe`. A checagem passa a exigir `disable-model-invocation: true` nas skills `optional`.
A medição é a do K3c: custo por tarefa no gate, contra o `main`, sem perda de acerto.
