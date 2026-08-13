# sources — paridade com a referência e SOTA 2026

Material bruto da pesquisa que fundamenta
[`docs/specs/002-paridade-e-sota-2026/`](../docs/specs/002-paridade-e-sota-2026/spec.md).

Duas frentes: leitura direta da referência no commit fixado, e levantamento
externo do que 2026 pede de um harness de terminal. Acesso em 2026-08-13.

## Aviso de proveniência

**Fonte contaminada, registrada para não ser reencontrada e usada sem aviso:**

- `https://gerl.dev/blog/agent-harness-taxonomy` — "The Harness Taxonomy",
  2026-04-07. O artigo declara explicitamente que uma das arquiteturas que
  cataloga deriva do código-fonte vazado do Claude Code, e cita números
  extraídos dele. Os
  [non-goals de proveniência](../.specs/nycode-rs/spec.md#non-goals-de-proveniência)
  proíbem esse material e qualquer derivado. **Nada deste épico se apoia nele.**

A distinção que evita paralisia: changelog público e documentação oficial de um
fornecedor não são material vazado. São publicação do próprio autor e podem ser
citados.

## Frente 1 — a referência

Fonte primária: checkout de `earendil-works/pi` no commit
`581d75a89cea21e50d6a26df840352f94427f633`, o mesmo que o
[`NOTICE`](../NOTICE) fixa. MIT.

### Superfície que a referência tem e este repositório não

- **Sete ferramentas embutidas**, das quais `grep`, `find` e `ls` vêm
  desligadas. `edit` recebe uma lista de substituições disjuntas numa chamada só,
  cada `oldText` casado contra o arquivo original. `bash` tem parâmetro de prazo
  e grava a saída completa num arquivo temporário quando corta. `read` devolve
  imagem e anota quando o modelo não tem visão. Todas as buscas têm teto de
  resultados.
- **Vinte e dois comandos de barra**, contra oito aqui. Os que agregam:
  `/import`, `/session`, `/copy`, `/name`, `/new`, `/reload`, `/clone`,
  seletor de `/resume`, rótulos na árvore.
- **Nível de raciocínio de primeira classe**: sete níveis nomeados, mapa por
  modelo, e rebaixamento ao nível suportado mais próximo quando o modelo não
  alcança o pedido.
- **Cache de prompt em cada dialeto pelo mecanismo do provider**: pontos de corte
  explícitos no formato Anthropic; chave derivada de sessão, retenção longa e
  modo explícito no formato OpenAI; ponto de cache no Bedrock.
- **Custo em moeda** calculado a cada atualização de usage, com faixas de preço
  por tamanho de contexto e a regra de que escrita de cache de retenção longa é
  cobrada ao dobro da tarifa de entrada.
- **Transformação de mensagem antes do envio**: descarta turno com parada de erro
  ou cancelamento, insere resultado sintético para chamada de ferramenta órfã,
  converte raciocínio de outro modelo em texto, degrada imagem em modelo sem
  visão, normaliza identificador de chamada.
- **Compactação por limiar** com reserva e cauda medidas em tokens, resumo de
  seções nomeadas, tratamento de turno partido, e um marcador que carrega a cauda
  retida — de modo que reconstruir o contexto nunca precisa ler o que veio antes.
- **Sumarização de ramo** ao abandonar um branch da árvore.
- **Detecção de contexto excedido** por vinte e quatro padrões de mensagem de
  erro, mais dois casos em que o provider reporta sucesso: entrada somada acima
  da janela declarada, e parada por limite com saída vazia.
- **Retry em duas camadas**, transporte e política, com classificação por
  allow-list de padrão transitório filtrada por deny-list de limite de conta.
- **Higiene de payload**: saneamento de par substituto UTF-16 incompleto antes de
  serializar, reparo em cascata do JSON parcial de argumento de ferramenta,
  coerção de argumento contra o schema.
- **Compatibilidade por modelo**, que transforma três dialetos em cerca de trinta
  e cinco providers por flags em vez de código novo.
- **Um resultado de ferramenta pode encerrar o turno.**
- **Instruções de projeto** lidas dos diretórios ancestrais e do diretório do
  usuário, com arquivo de override que substitui as demais camadas naquele
  diretório sem afetar as outras.
- **Ambiente de sessão exposto ao shell** por variáveis, com opt-out.
- **TUI**: autocomplete de comando, caminho e referência a arquivo; localizador
  aproximado; marcador de colagem grande como segmento atômico; anel de corte e
  desfazer com coluna pegajosa; atalhos remapeáveis por arquivo; temas com
  recarga a quente; markdown com tabela, lista de tarefa e realce injetado pelo
  consumidor; hiperlink, progresso na aba, cópia para área de transferência e
  marcadores de prompt; imagem no terminal por dois protocolos gráficos.

### O que a referência tem e não vale portar

- **`server`, `session-backends` e a emissão de spans de `telemetry` não são
  instanciados por nada** fora de teste dentro do próprio projeto dela. O pacote
  de servidor declara no próprio manifesto que é experimental e "pode ser
  removido sem aviso".
- **A pilha de sessão remota** é CBOR sobre framing de quatro bytes, com socket
  de domínio Unix como único transporte implementado. Não implementa ACP, MCP nem
  LSP — é protocolo próprio, versão 1, sem parentesco com padrão externo.
- **Resposta diferida e API de lote** existem como contrato completo — tipos,
  métodos, estado de parada — e nenhum dos dez dialetos implementa. Só o provider
  de teste.
- **A suíte de avaliação** é privada, tem duas tarefas, e não roda no CI dela.

### Onde este repositório já está à frente

- **Confinamento de sistema operacional.** A referência não tem, e diz por quê:
  "não inclui sistema de permissão embutido para restringir acesso a arquivo,
  processo, rede ou credencial". Ela terceiriza para container.
- **Ambiente limpo por allowlist.** O padrão de falha que o levantamento externo
  aponta como o achado de segurança mais acionável de 2026 é o confinamento que
  protege disco e rede e herda `AWS_*` e `GITHUB_TOKEN` verbatim. O
  [`environment.rs`](../crates/nycode-agent/src/policy/environment.rs) já fecha
  isso com `env_clear()` mais allowlist de seis variáveis.
- **Contenção de caminho na abertura**, sem precedente na referência.
- **Busca pelo motor do ripgrep como biblioteca.** A referência baixa os binários
  do GitHub sem verificar digest e os prepende ao `PATH` de todo comando.
- **Cliente MCP e subagentes**, ambos recusados por decisão na referência.

## Frente 2 — o que 2026 pede

Levantamento externo em quatro passes. Confiança medida 82%, acima do piso de
70% que autoriza seguir e abaixo dos 85% que dispensariam ressalva. A causa da
diferença está registrada abaixo.

### Agent Client Protocol

- `https://agentclientprotocol.com/protocol/overview` — a superfície mínima que
  um agente implementa são quatro métodos: `initialize`, `authenticate`,
  `new_session`, `prompt`, mais `session/update` como notificação. O protocolo
  reutiliza as representações JSON do MCP onde pode.
- `https://crates.io/crates/agent-client-protocol` e
  `https://lib.rs/crates/agent-client-protocol-tokio` — SDK em Rust, trait
  `Agent` assíncrona e `AgentSideConnection` sobre stdio. O crate companheiro
  teve release em abril de 2026.
- `https://blog.jetbrains.com/webstorm/2026/08/the-lsp-moment-for-ai-agents-webstorm-acp/`
  — adoção pela JetBrains, agosto de 2026, descrita como "o momento LSP dos
  agentes".
- Adoção corroborada por três fontes independentes: publicado pela Zed em agosto
  de 2025 sob Apache-2.0, registry em janeiro de 2026, 25+ agentes hoje.
- **Duas ressalvas consistentes em todas as fontes.** O VS Code não tem suporte
  nativo — a Microsoft padronizou em MCP e não se comprometeu com ACP. E o
  transporte remoto é declarado work in progress pelo próprio site: o modelo
  maduro é subprocesso local sobre JSON-RPC em stdio. É essa ressalva que faz o
  FR-26 não reabrir o não-escopo de sessão remota.

### Observabilidade — por que ficou adiada

- `https://github.com/open-telemetry/semantic-conventions-genai` — o conteúdo
  `gen_ai.*` foi movido do repositório principal para este em junho de 2026, e o
  novo **não tem release, tag nem URL de schema**; a seção correspondente do
  README é literalmente "TODO".
- `https://john-hodge.com/blog/opentelemetry-genai-semantic-conventions/` —
  análise datada de 2026-07-17: nenhum span, evento, métrica ou atributo de IA
  generativa está marcado estável. A recomendação, que é o que fundamenta o
  gatilho de reabertura registrado no [`plan.md`](../docs/specs/002-paridade-e-sota-2026/plan.md):
  "um schema externo em status de desenvolvimento nunca deveria ser o contrato do
  seu banco de dados".
- `https://code.claude.com/docs/en/monitoring-usage` — apesar disso, os três CLIs
  de maior circulação já emitem. A expectativa existe; o contrato estável não.

### Gestão de contexto

- `https://platform.claude.com/docs/en/build-with-claude/compaction` e
  `.../context-editing` — o provider passou a oferecer compactação e limpeza de
  resultado de ferramenta no servidor, com identificadores versionados.
  Registrado como adiado: amarra o desenho a um provider antes de a compactação
  local estar correta.
- `https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents`
  — recuperação sob demanda continua sendo a doutrina: manter identificador leve
  e carregar quando precisar, em vez de pré-processar. Para um harness que já usa
  o motor do ripgrep, busca por conteúdo e por nome cobrem a maior parte disso
  sem índice.
- `https://www.anthropic.com/engineering/harness-design-long-running-apps` — o
  contraponto mais útil da rodada, e vem de quem constrói: eles **removeram**
  reset de contexto, o construto de sprint e o avaliador por etapa, à medida que
  o modelo passou a fazer aquilo sozinho. A leitura acionável é que andaime que
  compensa fraqueza de modelo envelhece, e andaime que resolve problema de
  sistema — confinamento, isolamento, orçamento — não.

### Skills

- `https://agentskills.io/specification` — o formato virou padrão aberto em
  dezembro de 2025. Dois campos obrigatórios, `name` e `description`, e quatro
  opcionais: `license`, `compatibility`, `metadata` e `allowed-tools`, este
  último marcado experimental. Runtime e confinamento estão explicitamente fora
  do escopo da especificação: são problema do harness.
- Divulgação progressiva em três estágios é o padrão de consumo — nome e
  descrição no startup, corpo na ativação, recursos sob demanda. É o que este
  repositório já faz.

### Segurança

- `https://developers.openai.com/codex/agent-approvals-security` — o modelo de
  confinamento mais completamente documentado: escrita limitada ao workspace,
  rede desligada por padrão, e caminhos protegidos como somente-leitura mesmo
  dentro da área gravável.
- `https://owasp.org/www-community/attacks/MCP_Tool_Poisoning` — a causa-raiz
  nomeada: descrições de ferramenta são revisadas uma vez, na conexão, e as
  respostas entram no contexto sem checagem equivalente. O controle
  correspondente é fixar a definição na aprovação e alertar em qualquer desvio.
  É o que fundamenta o FR-20 e o [ADR-0028](../docs/architecture/decisions/0028-o-consentimento-fixa-a-definicao-declarada.md).
- `https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/` — a
  revisão tornou **obrigatório** que requisição iniciada pelo servidor só seja
  emitida enquanto ele processa uma requisição do cliente. Para um harness sem
  superfície gráfica, MCP Apps é declinável; essa regra não é.

### Limitação de método

Um dos dois motores de busca previstos pelo protocolo recusou todas as consultas
por limite de plano. A descoberta ficou mais estreita do que o protocolo pede, e
é a razão principal de a confiança global ser 82% e não cerca de 90%. A
consequência prática: a cobertura concentrou-se em dois fornecedores, e é
provável que haja movimento relevante em outros harnesses que este levantamento
não capturou com o mesmo detalhe.
