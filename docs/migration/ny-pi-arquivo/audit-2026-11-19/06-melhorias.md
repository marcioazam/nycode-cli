# 06 — Melhorias sugeridas

Estado: lista de sugestões; nada aqui foi executado. Cada linha aponta a evidência: `01` = defeitos e logs
(`01-gaps-bugs-logs.md`), `R1`…`R7` = pesquisa em `research/`, `P` = artigos em `faixas/r4-artigos.md`, `At` =
`faixas/atualidade.md`, `X` = `research/verificacao-cruzada.md` (prevalece onde corrige). Esforço: P ≤ 1 dia, M ≤ 1
semana, G > 1 semana. Decisão: `dono` quando muda política já decidida.

Ordem de leitura: a seção 1 resume o que fazer primeiro; as demais são o catálogo por tema.

## 1. As quinze de maior retorno

| # | melhoria | por quê | esforço |
|---|---|---|---|
| 1 | Corrigir S4 e fazer a bisseção do overlay no `bench/` | ny-pi perde 9–12 pp e custa 3,3x o pi puro (doc 05) | M |
| 2 | Sandbox de SO opcional para `bash` (bwrap), falhando fechado | o guard por lista tem limite estrutural; bwrap sobe sem root em 11 ms nesta máquina (R6 C12) | M |
| 3 | Fixar versão dos servidores MCP e tirar `npx -y …@latest` | pacote MCP malicioso publicado hoje (X); contradiz a política de `third-party.json` (At) | P |
| 4 | Crítico independente na conclusão, acionado por sinal | +3,9–9,5 pp a 1,0–1,25x (R1 C17, P20) | M |
| 5 | Detector de laço que interrompe (observar 2, bloquear 3, parar 6) | hoje só avisa; 8 ocorrências nos logs (01; R7 C63, X) | P |
| 6 | Corrigir os defeitos de correção já achados (auto-resume, `compact-at-400k`, `plan-gate`, `syntax-check`, bench) | defeitos reproduzidos, fora do escopo executado hoje (01) | M |
| 7 | Medir cobertura de TS e rodar no CI os testes hoje fora dele | ~270 arquivos TS sem medição; 48+7 testes de patches e 13 pytest de skills não rodam (01) | M |
| 8 | Registrar `cache_creation` e taxa de leitura por tipo de agente | sem isso nenhuma decisão de custo é verificável (01; R2) | P |
| 9 | Prefixo enxuto para subagentes de leitura | 10–25k tokens por filho (R2 C22, C24) | M |
| 10 | Limpeza automática de `sessions/` (522 MB), checkpoints (382 MB) e inbox órfãos | cresce sem teto (01) | P |
| 11 | Corrigir a origem dos erros repetidos de ferramenta | `agent-contract.md` inexistente 101×, timeout acima do teto 75×, `rm -rf` 41× (01) | P |
| 12 | Animação decorativa a 15–20 fps e zero timers em repouso | 0,224 → 0,080 núcleo de 60 para 20 fps; tmux 3.7 amplia o custo (R5 C55; X) | P |
| 13 | Ajustes de contraste dos temas (`dim`, bordas, diff) | pares abaixo de 4,5:1 (doc 03) | P |
| 14 | Triagem dos patches antes de subir pi-code 1.7.0 → 1.10.1 | 12 patches falham; 3–4 podem ter ficado obsoletos (At) | G |
| 15 | Gerenciador de frota somente leitura (Plano A, fase 1) | pedido do dono; reaproveita o diretório de frota (doc 04) | M |

## 2. Segurança

Feito nesta auditoria: ver `02-seguranca-performance.md`. Pendente:

| melhoria | evidência | esforço | decisão |
|---|---|---|---|
| `ny-sandbox`: `bash` dentro de bwrap com `--tmpfs $HOME`, escrita só no projeto e `/tmp` privado, `.git` e config do agente somente leitura | R6 C7, C12; X | M | opcional: não; padrão: dono |
| Falhar fechado se o sandbox pedido não subir | R6 C3 | P | — |
| Rede negada por padrão com lista de domínios | R6 C1, C5 | G | dono |
| Fixar versão exata em `mcp.json.example`; hash das descrições de ferramentas MCP com alerta de mudança | R6 C38, C50, C59; X (MCPhantom) | P | — |
| Ambiente mínimo para servidores MCP stdio (`env -i` + lista) | R6 C51 | M | — |
| Proteger de escrita pelo agente: `.pi/`, `.claude/`, `settings*.json`, `mcp.json`, `.vscode/tasks.json`, hooks | R6 C44 (worm em hooks); X (Claude Code 2.1.323) | P | — |
| Hash dos patches aplicados em `node_modules` e do pacote pi-code | 01 (achado 15) | P | — |
| Redação de segredos em transcripts (`~/.pi/agent/sessions`), primeiro em modo simulação | R6 C52 | M | dono |
| `.npmrc` com `ignore-scripts` e idade mínima de versão | R6 C45–C48 | P | — |
| `permissions` mínimas por job e proibição de `pull_request_target` com checkout de fork | R6 C49 | P | — |
| Envelope de procedência em `web_fetch`, MCP e handback de subagente | R6 C33, C57 | M | — |
| Parser de shell por AST no guard, em vez de `shlex` e regex | R6 C18–C21 | G | dono (dependência nova) |
| "Regra dos dois": sessão com conteúdo não confiável + segredo + rede não roda autônoma | R6 C29, C30 | M | dono |
| Teto de capacidade por subagente fora do contexto do modelo | R6 C36 (CapScope: 3/75 contra 33–47/75) | G | dono |
| Checklist OWASP Agentic e MCP Top 10 em `/docs` | R6 C54–C57 | P | — |
| Revisar `guard.py` para a nova semântica de `CLAUDE_PROJECT_DIR` antes de subir o pi-code | At (b)6 | P | — |

Limite que continua: baixar para arquivo e executar, script escrito pelo próprio agente e alias em arquivo de
configuração não são barráveis por lista. Com bypass ligado, só o sandbox muda isso.

## 3. Acerto no benchmark

Plano completo no doc 05. Catálogo:

| melhoria | evidência | esforço |
|---|---|---|
| Implementar quando o pedido é "planeje e implemente" sem interface | baseline local S4 | P |
| Bisseção do overlay, um braço por componente | R1 C10, C19, C21 | M |
| Crítico independente e verificação seletiva | R1 C17; P19–P21 | M |
| Checklist único antes de concluir | R1 C18, C19 | P |
| Detector de laço com parada | R7 C63 | P |
| Contexto local no início (diretório, ferramentas, versões) | R1 C18, C26 | P |
| Orçamento de tempo e passos visível, com aviso | R1 C18; P32 | M |
| Parada antecipada de tentativa sem progresso | R1 C11 | M |
| Regras duras fixadas fora da compactação e reinjetadas depois | P14; R2 C30 | P |
| Regras com escopo por caminho em vez de sempre carregadas | R7 C8, C26, C28 | M |
| Auditoria periódica das instruções, com o motivo de cada regra | R7 C27 | M |
| Medir uso real do codegraph antes de investir em índice | R7 C40 (fonte interessada), C44 | P |
| Topologia por dificuldade: agente único primeiro, multiagente só em subtarefa difícil | P1, P17, P18 | G |
| Braço `mini-swe-agent` como piso | R1 C5, C8 | M |

## 4. Custo

| melhoria | evidência | esforço | decisão |
|---|---|---|---|
| Telemetria de cache por requisição e por tipo de agente | 01; R2 C19 | P | — |
| TTL por papel (1 h principal, 5 min passagem única) | R2 C22 | M | — |
| Prefixo mínimo para scouts e leitores | R2 C22, C24 | M | — |
| Haiku 5.5 em papéis de leitura conferidos pelo pai | R2 C42; X | P | dono (reverte 2026-11-15) |
| Effort em escada | R2 C34 (não verificado no resumo; X) | M | — |
| Truncar saída na fonte; não mascarar a cada turno | R2 C28 | P | — |
| Testar compactação a 200–250k | R2 C30 | M | — |
| Aviso de custo de recache ao trocar modelo ou effort | R7 C9, C19 | P | — |
| Reavaliar o patch próprio de aquecimento de cache contra `cacheWarming: "idle"` do pi 1.5.1 | R7 C25; At | P | — |
| Métrica "turnos por tarefa" e teto de turnos por subagente | R7 C46 (84% da variância) | P | — |
| Política de quando usar code mode (só lote ≥ ~50 itens) | R7 C47 | P | — |
| Batch API em evals e varreduras | R2 C5 | M | — |
| Executor Sonnet + conselheiro Opus | R2 C39 (beta, modelos 4.x) | G | — |
| Orquestrador: A/B Opus 5.5 contra Fable | R2 C37, C38 | P | dono |
| Custo por tarefa aprovada no relatório do bench | R1 C11 | P | — |

## 5. Performance e terminal

Feito nesta auditoria: ver doc 02. Pendente:

| melhoria | evidência | esforço |
|---|---|---|
| Animação decorativa a 15–20 fps; spinner na cadência do glifo | R5 C55, C56 | P |
| Pausar timers sem foco ou em repouso | R5 C57 | M |
| Repintar só as linhas que mudam; cache de `render(width)` por bloco | R5 C4, C12; X (148 → 21 ms no oh-my-pi) | M |
| Virtualizar transcript longo | R5 C3; X (Claude Code fullscreen) | G |
| Detectar saída sincronizada por DECRQM e tratar tmux 3.7 | R5 C20; X | M |
| `module.enableCompileCache()` no arranque, medido com `hyperfine` | R5 C51; X (~10%, custa na primeira execução) | P |
| Imports sob demanda fora do caminho do prompt | R5 C52 | M |
| Aplicar os patches do pi-code uma vez por versão, não a cada lançamento | medido: 60 ms por lançamento; greps 283 ms (01) | M |
| `hook-dispatch.sh` sem reler `tool_response` grande | medido: 400 ms com 5 MB (01) | P |
| Espera limitada em toda consulta ao terminal (OSC 11, tamanho) | X (Codex bloqueou 15 s) | P |
| Telemetria de quadro por fase atrás de variável de ambiente | R5 C4 | P |
| HUD: os achados de `calm-statusline.mjs` e `claude-hud-*.mjs` | 01 | P |
| Hook Status: corrigir timeout recorrente (29×) e span sempre 0 ms | 01 | P |

## 6. UI e ergonomia

Detalhe no doc 03. Além dele:

| melhoria | evidência | esforço |
|---|---|---|
| Modo sem movimento completo e rótulo de texto em todo estado | R5 C44 (Primer), C58 | P |
| Diff legível sem depender de vermelho e verde (sinal `+`/`−`, fundo) | R5 C40 | P |
| Prompt de permissão mostrando a consequência | R5 C47 (93% aprovam) | M |
| Caixa de "precisa de você" cobrindo subagentes | R3 C14; doc 04 | M |
| Marcação de resultado não lido em runs de background | R7 C12, C23 | M |
| Colapso de detalhes por turno concluído | R7 C15 | M |
| `/status` listando agentes, skills e hooks quebrados e matchers que nunca casam | R7 C4 | P |
| Notificação OSC 777 | R7 C14 | P |

## 7. Qualidade, testes e observabilidade

| melhoria | evidência | esforço |
|---|---|---|
| Cobertura de TS medida e publicada; piso só depois de medir | 01 | M |
| CI rodando testes de `claude-home/patches`, de `skills/*/scripts/tests` e os scripts shell | 01 | P |
| Testes para `compact-at-400k.ts`, `cache-prefix-probe`, `footer-no-stats`, `no-web-search` | 01 | M |
| Decidir `.project-phase` (hoje ausente = `launched`, com piso de 80% por arquivo não medido) | 01 | P (dono) |
| "Reddening" automático: reverter produção, teste novo deve falhar | R7 C61 (X: só a técnica foi confirmada) | M |
| `code-reviewer` com severidade Important / Pre-existing / Nit | R7 C2, C57 | P |
| Contar quantas vezes o `completion-gate` bloqueou | R7 C55 | P |
| Casos de falha plantada para os revisores, com taxa de captura | R7 C49 | M |
| Replay de sessão gravada como teste de hooks e extensões, sem modelo | R7 C50 | M |
| Atributos OTel GenAI em pai e filhos | R7 C52–C54; `docs/sync-observabilidade.md:119` | M |
| Relatório retrospectivo de transcripts: turnos, laços, edições sem verificação | R7 C55 | M |
| Rotação do log de diagnóstico (hoje 1 geração de 1 MiB) | 01 | P |
| Reduzir ~100 WARN falsos de `tool:bash` | 01 | P |
| Bench: tratar estouro do verificador como erro; agente sem root; teste com `reward.txt` plantado | R1 C36 | P |
| Bench: k ≥ 3 e veredito < 3 pp rejeitado sem intervalo | R1 C25, C32, C33 | P |

## 8. Manutenção e atualidade

| melhoria | evidência | esforço |
|---|---|---|
| Triar patches que o upstream já cobre (`todo-collapse`, limite de tokens do `/goal`, `run/` contra bash em background) | At (a) | M |
| Subir pi-code para 1.10.1 depois da triagem; destravar a checagem de versão em `permission-control/apply.mjs` e `bin/pi` | At (a); X | G |
| Reduzir a dependência de patch em `node_modules` (74 arquivos-alvo): mover para extensão o que a API do pi permite | At (b)7 | G |
| Passada única de atualizações menores (semgrep, diff-cover, biome, harden-runner, mcpvault, computer-use-linux) | At (c) | P |
| CI em Node 26 sem subir o piso do instalador | At (c) | P |
| Limite de 500 linhas e orçamento de bytes por `SKILL.md` no gate | R7 C33 (fonte não relida; X) | P |
| Conferir `/skill:` antes do próximo major do pi-code | At (b)9 | P |

## 9. Multiagente

Planos no doc 04. Independentes do gerenciador:

| melhoria | evidência | esforço |
|---|---|---|
| Validar `writes` disjuntos antes de lançar faixas paralelas | R3 C4, C50; X | M |
| Custo e turnos por run visíveis no painel de frota | R3 C18, C19 | P |
| Handback com campo "trabalho de background ainda rodando" | R7 C15 | P |
| Medir o ponto de equilíbrio de delegar (≥ 6 turnos ou > 100k de contexto) com sessões reais | R2 C24; R7 C46 | M |
| Expor os provedores de busca aos agentes genéricos ou roteá-los sempre aos scouts | esta auditoria: 6 faixas ficaram só com keenable | P |
| Repor créditos do Exa ou tirá-lo da lista de provedores | X | P (dono) |

## 10. Não vale fazer agora

- Multiagente por padrão em código; mais subagentes "para garantir" (−39% a −70% em trabalho sequencial).
- Índice vetorial do repositório antes de medir uso do codegraph.
- Trocar o formato de edição.
- Classificador próprio de "auto mode": o dono já decidiu por bypass com lista de negação; sandbox rende mais.
- A2A, ACP ou MCP Tasks como barramento interno.
- Subir pi-code de uma vez sem triar os 12 patches; Python 3.15 e Node 26 como piso.
- Voz, app móvel e controle remoto.
- AGENTS.md ou CLAUDE.md gerado por LLM; cota dura de "150–200 instruções".
- Esforço máximo permanente; Fable como padrão sem A/B.
