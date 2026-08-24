# Changelog

Todas as mudanças relevantes deste projeto são documentadas aqui.
Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) ·
[Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [Não lançado]

### Adicionado

- **Registros de sessão passam a exigir MAC válido e TTL.** Linhas sem MAC,
  expiradas, futuras ou de outro workspace não entram no contexto do modelo;
  linhas sem MAC produzem erro explícito (AGT-07).

- **O session store recusa ids inseguros e symlinks, e serializa append
  concorrente por sessão.** A ponta em cache é invalidada quando outra
  instância altera o arquivo (AGT-07).

- **Sessão nomeada, com id escolhido, fork e import.** `--name`,
  `--session-id`, `--fork`, `--import`; `/session`, `/copy`, `/new`, `/reload` (B27, B28, FR-22).

- **`--system` e `--append-system` substituem ou acrescentam o prompt de
  sistema.** Arquivos `.nycode/SYSTEM.md` / `APPEND_SYSTEM.md` e os
  equivalentes na config do usuário entram quando a flag falta. Instruções
  e skills continuam anexadas (B26, FR-21).

- **`--tools` e `--no-tools` restringem o catálogo enviado ao modelo.**
  Pedido sem ferramentas declara `tool_choice: none`. A allowlist não é
  permissão; nome desconhecido recusa a sessão (B8, B25, FR-18).

### Alterado

- **O teto de tamanho de PR assistido por IA conta apenas código.** O limite
  passa a ser 800 linhas e 25 arquivos de código; Markdown, texto e demais
  documentos ficam fora da contagem (`GATE-11`/`AI-01`).

- **O consentimento MCP fixa também a definição que o servidor declara.**
  Depois do handshake o conjunto é pinado; troca pede de novo (C6,
  ADR-0028). Nome com `__` ou o separador do registro é recusado.

- **Instruções vêm também dos ancestrais e da config do usuário, e uma
  skill pode se recusar ao modelo.** `AGENTS.override.md` substitui os
  outros arquivos de instrução só naquele diretório (B23). O catálogo
  declara os campos da spec Agent Skills; `disable-model-invocation`
  tira a skill do prompt e a mantém carregada (B24).

- **Alt+Enter durante o turno enfileira o próximo pedido, sem
  direcionar o corrente.** Enter continua injetando no turno
  (`with_steering`). Alt+Enter só é interceptado no `steer()` com o
  turno em curso; fora dele, continua quebrando linha (B22).

- **`grep`, `find` e `ls` aceitam `limit` por chamada, e o resultado
  de ferramenta pode encerrar o turno.** Sem `limit`, vale o teto da
  ferramenta; acima do teto recorta; zero recusa (B20). Se todas as
  chamadas da rodada pedirem `terminate`, o turno acaba sem nova ida
  ao modelo (B21).

- **`edit` aceita substituições disjuntas, `bash` tem prazo por
  chamada, e `read` devolve imagem** (B17, B18, B19).

- **O resumo de compactação pede seções nomeadas, o marcador leva a
  cauda, e `/fork` registra o ramo abandonado.** O pedido de resumo
  fixa `Objetivo`, `Restricoes`, `Progresso`, `Decisoes`, `Proximos
  passos` e `Contexto critico`, nesta ordem — prefixo estável para o
  cache (B10, NFR-7). O marcador passa a carregar a cauda retida, e
  reconstruir a sessão para nele: o que veio antes já está dentro
  (B11). `/fork` grava um aviso do que ficou no ramo, em vez de só
  trocar o caminho (B12). O aviso não interrompe a reconstrução — o
  prefixo compartilhado continua no caminho novo.

- **A compactação dispara por limiar de ocupação antes do pedido.** A
  ocupação ancora no último usage real e estima só a cauda (B9). Sem janela
  no catálogo, o comportamento antigo permanece: só o erro dispara. O
  erro continua sendo a rede de segurança (ADR-0027). O corte ainda retém
  N mensagens; o gatilho é que deixa de esperar o turno perdido.

- **Imagem some do fio quando o catálogo diz que o modelo não tem visão,
  e o raciocínio fica no histórico como texto.** Sem declaração no
  catálogo, o pedido leva o anexo — o comportamento antigo. `Some(false)`
  troca a imagem por um marcador, e anexos seguidos viram um só. O
  raciocínio deixa de ser descartado no registro do turno: vai como texto,
  para uma troca de modelo (FR-19) não mandar bloco assinado a quem não
  assina. Costura de B15/B16 da spec 002, em `adapt.rs` e `transform.rs`.

- **O envio ao provedor descarta turno interrompido e fecha chamada órfã.**
  Um assistente que parou em erro ou cancelamento fica no histórico (o
  usuário viu o texto) e não volta no pedido — o provedor recusa o
  incompleto. Chamada sem resultado ganha síntese; resultado sem chamada
  some. É a costura de A6/B13/B14 da spec 002, em `transform.rs`.
  `--continue` desempata sessões com o mesmo mtime pelo identificador, não
  pela ordem do diretório.

- **O ROADMAP deixa de tratar a paridade real como bloqueada.** A Frente 0
  fechou o instrumento em modo completo no CI; o que resta das Ondas 2 a 5
  da spec 002 é produto. `ARCHITECTURE.md` deixa de chamar a TUI de FR-1
  pendente — o renderizador já está no binário desde a Onda A.

### Adicionado

- **O job `parity` do CI obtém a referência com digest conferido e compara
  de verdade.** O tarball do commit que o NOTICE fixa (`581d75a`), o Node
  22.19.0 e o catálogo de modelos gerado da referência têm sha256 em
  [`scripts/parity-reference.txt`](scripts/parity-reference.txt); o job
  confere cada um antes de extrair (NFR-8). Sem `PARITY_REFERENCE` o
  `parity-gate.sh` continua em modo instrumento — só o `--full` local, que
  é sem rede. O fixture deixa de tratar `README.md` no prompt de sistema
  como pedido de leitura, e o dialeto soma o usage por rodada da
  referência, que é o que o candidato já publica acumulado.

- **A referência de paridade é apontada por `models.json` num diretório
  efêmero ([ADR-0035](docs/architecture/decisions/0035-a-referencia-de-paridade-e-apontada-por-models-json.md)).**
  `Harness::reference` deixa de oferecer `ANTHROPIC_BASE_URL` — variável que o
  `pi` 0.84.1 ignora — e passa a gravar a definição de modelo que ele de fato
  lê, redirecionada por `PI_CODING_AGENT_DIR`. O `baseUrl` é a origem sem
  `/v1`, porque o SDK posta em `/v1/messages`. O teste
  `the_reference_harness_reaches_the_local_gateway_instead_of_the_real_api`
  asserta a contabilidade constante do fixture (`input = 1234`): ausência de
  chamada externa provada pela presença da local, não por "não deu 401".

- **Nota de pesquisa: o mecanismo que a referência lê para apontar a um
  gateway local.** [`sources/research_pi-gateway-local.md`](sources/research_pi-gateway-local.md).
  O `pi` 0.84.1, no commit que o NOTICE fixa, ignora `ANTHROPIC_BASE_URL` e
  resolve o endpoint pela definição de modelo em `models.json`, num diretório
  redirecionável por `PI_CODING_AGENT_DIR`. Confirmado por um comando cuja
  saída foi lida: o `pi` falou com o `nycode-parity-fixture` local
  (`msg_fixture`, `input: 1234`) e, no controle sem o arquivo, voltou à API
  real da Anthropic com `401` de `request_id` genuíno. O `baseUrl` que funciona
  no dialeto `anthropic-messages` é a origem sem `/v1` — o SDK posta em
  `/v1/messages`. Fecha o ponto de decisão da Frente 0 da spec 002: não é
  preciso repinar o NOTICE, interceptar por DNS, nem abrir waiver.

- **Proteção de branch em `main`, configurada no GitHub
  ([ADR-0034](docs/architecture/decisions/0034-protecao-de-branch-exige-ci-verde-sem-aprovacao-separada.md)).**
  Até esta data `main` não tinha proteção nenhuma (confirmado via API antes
  de configurar). Exige os 12 checks de CI atuais, `strict` (branch
  atualizada com `main` antes do merge), bloqueia force-push e deleção.
  Deliberadamente sem exigência de aprovação humana separada — mantenedor
  único (`.github/CODEOWNERS`), então essa exigência seria auto-aprovação,
  não revisão de verdade; revisar se um segundo colaborador regular
  aparecer. Item que ficava fora do escopo autônomo desde o início da
  adoção do SOTA-2026 — fechado só depois de confirmação explícita do
  usuário sobre qual nível de proteção configurar.

- **Três documentos que fecham lacunas de uma checklist pedida diretamente
  pelo usuário, fora do padrão SOTA-2026.** `docs/CONVENTIONS.md` (novo) —
  nomenclatura e organização de arquivo/pasta/documento já praticadas neste
  repositório (idioma `foo.rs`+`foo/`, 11 pares confirmados; teste inline
  dominante, 110 arquivos, vs. arquivo dedicado `*_test.rs`, minoria, 9
  arquivos; par `<área>-gate.sh`+`<área>-gate-test.sh`, 11 de 12 gates),
  escritas em vez de tribais. `docs/architecture/ARCHITECTURE.md` ganhou a
  seção 13 ("Idiomas e práticas de linguagem, Rust 2026") — os padrões
  reais de código (error handling `thiserror`-nas-libs/`anyhow`-nos-binários,
  runtime tokio construído sob demanda, `serde` com `deny_unknown_fields`
  vs. `rename_all`, trait object pra plugável vs. genérico pra fixo),
  grounded em citações verificadas, não recomendação genérica; também
  satisfaz o pedido de "melhores práticas de arquitetura 2026" enquadrando
  o padrão de traits plugáveis como ports-and-adapters, sem criar documento
  paralelo. `AGENTS.md` ganhou uma seção amarrando NFR-8 (segurança antes
  de performance) e `THREAT_MODEL.md` numa política explícita: toda review
  avalia as duas, sempre — não só quando entram em conflito.

- **Suporte a container (`Dockerfile`, `.dockerignore`), pedido direto do
  usuário — fora do padrão SOTA-2026, sem ID de regra.** Multi-stage:
  builder `rust:1.96-slim-bookworm`, runtime
  `gcr.io/distroless/cc-debian12:nonroot`, os dois fixados por digest. A
  escolha da imagem final segue diretamente do que o próprio código deste
  repositório exige: `release.yml` compila para `x86_64-unknown-linux-gnu`
  (glibc dinâmico) e `nycode-ai` usa `reqwest` com
  `rustls-platform-verifier`, que lê o trust store do sistema operacional
  em runtime — `scratch`/`distroless/static` não têm libc nem trust store
  nenhum, então ficam descartados. Binário compilado com `cargo auditable`
  (embute a árvore de dependências resolvida no próprio binário). Usuário
  não-root fixado por UID numérico (`65532:65532`). Novo job `docker` no CI
  builda a imagem, linta com `hadolint` (digest calculado nesta adoção,
  mesmo padrão de `jscpd`/`codemetrics`) e roda um smoke test — **nunca
  publica**; é canal de distribuição adicional, não o principal, e
  publicar exige pedido explícito do usuário.

- **Gate de complexidade cognitiva e ciclomática por função, com ratchet
  (`GATE-05`/`GATE-06` do padrão SOTA-2026).** Ciclomática (McCabe) conta
  ponto de decisão de forma achatada; cognitiva (SonarSource) pesa mais a
  aninhada — duas funções com o mesmo número de ramos podem pontuar bem
  diferente se uma aninha e a outra não. O gate cobre as duas, teto de 15
  em cada. Diferente dos gates PR-only já existentes, complexidade é
  propriedade do estado atual de uma função, não do que um PR introduziu,
  então roda contra a árvore inteira em `scripts/ci-local.sh --full`, mesmo
  lugar de `layout-gate.sh`/`file-length-gate.sh`. Com ratchet igual ao
  teto de 500 linhas: oito funções que já excediam um dos dois tetos no dia
  em que o gate nasceu entraram no baseline com os valores exatos daquele
  dia — não podem crescer, e a entrada cai quando a função encolhe ou some.
  Medido com `codemetrics` (github.com/richardwooding/codemetrics), binário
  Go com backend tree-sitter para Rust, escolhido pelo usuário sobre `cccc`
  depois de uma pesquisa que comparou maturidade, ergonomia de gate
  (`--diff`/`--baseline` nativos) e categoria de ferramenta (binário
  baixado com digest conferido, mesma classe de `actionlint`/`zizmor`/
  `gitleaks` já usados aqui) entre os candidatos.

- **Gate de duplicação de código, teto de 5% (`GATE-08` do padrão
  SOTA-2026).** Medido com `jscpd` v5 (motor Rust nativo,
  github.com/kucherenko/jscpd). O próprio `--threshold`/`--exit-code` do
  binário não faz o que o `--help` sugere — com o reporter `console`
  presente, `--exit-code` reprova assim que existe qualquer clone,
  ignorando o teto por completo, confirmado testando teto de 1% e teto de
  99% contra a mesma árvore (mesmo `exit 1` nos dois). O gate lê o
  `jscpd-report.json` (reporter `json`) e faz a própria comparação, em vez
  de confiar na decisão do binário. Mesmo escopo do gate de complexidade:
  roda contra `crates/` inteiro em `scripts/ci-local.sh --full`, não é
  exceção só-CI. Sem ratchet — a duplicação medida no dia em que o gate
  nasceu (1,95% de linhas) já ficava abaixo do teto. `jscpd` não publica
  `checksums.txt` assinado como `codemetrics`; o digest da instalação por
  download foi calculado por este repositório na adoção, não conferido
  contra um valor de terceiro — nota registrada explicitamente no
  `AGENTS.md`, não deixada implícita.

  Com este gate, todo item do roadmap SOTA-2026 (ADR-0032) tem instrumento
  ou waiver formal — resta só a proteção de branch/`CODEOWNERS` no GitHub,
  que segue exigindo confirmação explícita do usuário.

- **Waiver formal para `GATE-16` do padrão SOTA-2026 ([ADR-0033](docs/architecture/decisions/0033-gate-16-fica-sem-instrumento-conflito-com-hook-e-squash-merge.md)).**
  Uma implementação foi desenhada (classificação por linha, distinguindo
  `#[cfg(test)]` inline de produção, já que o idioma dominante deste
  workspace mistura os dois no mesmo arquivo) e revisada
  adversarialmente antes de qualquer commit. A revisão achou que o gate,
  como o guia do padrão especifica, conflita com duas políticas que este
  repositório já adotou: o hook `pre-commit` roda `cargo test` e por isso
  já impede um commit RED (teste quebrado) de existir sem `--no-verify`,
  proibido pelas regras deste projeto; e squash-merge apaga a separação
  RED/GREEN de `main` no momento do merge — mesmo uma implementação
  correta nunca alcançaria "checável meses depois", o objetivo declarado
  do gate. `GATE-16` continua sem instrumento até uma das duas políticas
  mudar deliberadamente; waiver expira em 2027-02-14.

- **Gate de cobertura de diff, piso de 80% (`GATE-01` do padrão SOTA-2026).**
  Mede só as linhas de produção adicionadas ou modificadas pelo PR, não o
  agregado do projeto — um arquivo grande e bem testado absorve, no
  agregado, o erro de arredondamento de uma função nova sem teste nenhum.
  Construído sobre `cargo llvm-cov report --lcov`, que reaproveita os dados
  de perfil já gerados pelo passo de cobertura no mesmo job, sem rerodar os
  testes. Roda no job `coverage` do CI, condicionado a
  `github.event_name == 'pull_request'` — terceira exceção documentada a
  `scripts/ci-local.sh --full`, mesma razão das outras duas: a base certa de
  comparação só é conhecida dentro de um pull request.

- **Gate de mutation testing por diff, zero mutante sobrevivente (`GATE-04`
  do padrão SOTA-2026).** Cobertura pergunta "essa linha rodou?"; mutation
  testing pergunta "se essa linha estivesse errada, algum teste
  perceberia?" — pergunta estritamente mais forte, por isso o padrão trata
  mutation score como a prova e cobertura como o piso. Mutar o workspace
  inteiro não cabe num gate de PR (2144 mutantes contados no dia em que este
  gate foi desenhado); `cargo mutants --in-diff` restringe aos mutantes
  dentro do que o PR de fato tocou, mesmo princípio do gate de cobertura de
  diff aplicado a um instrumento diferente. Não ratcheta contra o legado do
  resto do workspace — como o escopo já é só o diff, não há legado dentro do
  escopo por definição. Roda no job `mutation` do CI, condicionado a
  `github.event_name == 'pull_request'` — mesma razão das outras exceções: a
  base certa de comparação só é conhecida dentro de um pull request.

  TDD contra a lógica de decisão pura (sem `cargo`) e, para provar a fiação
  de ponta a ponta, contra um crate sintético mínimo criado em dois commits
  — um placeholder e a implementação real — para existir um diff genuíno
  entre eles; a primeira tentativa usava `HEAD~0`/`HEAD` sobre um único
  commit, sem diff nenhum para escopar. `taiki-e/install-action@cargo-mutants`
  fixado por SHA (ADR-0030), com a mesma exceção de `--verify-comment` já
  registrada em `.pinact.yaml` para as outras ferramentas dessa action.

- **Gate de idade mínima de dependência nova, 30 dias (`SP-04` do padrão
  SOTA-2026).** Só verifica dependência genuinamente nova (nome ausente no
  `Cargo.lock` da base do PR) — bump de versão e crate interno não contam.
  Consulta a API do crates.io (com `User-Agent` identificável, exigido pela
  política deles) e reprova nome não encontrado no registro ou publicado há
  menos de 30 dias. Roda no mesmo job `pr-size` do CI, nunca em
  `scripts/ci-local.sh --full` — a base certa de comparação só é conhecida
  em contexto de PR, e a checagem é rede por natureza (`audit`, a exceção a
  "sem rede em verificação").

  TDD contra repositórios git sintéticos e, para a checagem de registro,
  contra a API real do crates.io (`libc`/`cfg-if`, que nunca saem do ar, em
  vez de uma dependência "recente" que envelheceria e quebraria o teste).
  Três defeitos reais encontrados e corrigidos no processo: um bug de teste
  (saída de `jq` sem `-r` produzia JSON com aspas duplicadas), um bug de
  produção (`git ls-tree` retorna caminho com prefixo `crates/`, não o nome
  nu do crate — a exclusão de crate interno não excluía nada) e o mesmo
  defeito de locale já corrigido em `gen-test-map.sh`: `comm` exige a mesma
  colação de `sort`, que diverge por locale sem `LC_ALL=C` fixado.

- **Lacunas de `docs/` do padrão externo SOTA-2026 fechadas: `GLOSSARY.md`,
  `business-rules.md`, `THREAT_MODEL.md`, `RUNBOOK.md`, `ONBOARDING.md`,
  `SLO.md`.** O glossário embutido em `ARCHITECTURE.md` virou
  [`docs/GLOSSARY.md`](docs/GLOSSARY.md) — único, expandido, referenciado em
  vez de duplicado. `business-rules.md` não repete a tabela de FR/NFR de
  `REQUIREMENTS.md`; captura as regras que atravessam requisitos individuais
  (`BR-N`), como segurança-antes-de-performance e proveniência proibida.
  `THREAT_MODEL.md` é a vista de alto nível sobre o checklist de segurança
  já existente da fronteira de confiança, sem duplicar as linhas. `SLO.md`
  adapta o conceito para um CLI sem serviço no ar: os indicadores são os
  pisos de performance e cobertura já travados no CI, sem política de error
  budget (não há burn-rate sem tráfego de produção).

- **Gate de fronteira de arquitetura, allowlist do grafo de dependência
  entre crates (`GATE-15`/`ARCH-04`/`ARCH-05` do padrão SOTA-2026).** O
  Cargo já recusa um ciclo verdadeiro; o que faltava era pegar uma
  dependência nova entre crates — legal para o Cargo, mas que muda a direção
  pretendida da arquitetura sem ninguém decidir isso explicitamente. Cada
  crate deste workspace é tratado como um contexto delimitado (`ARCH-04`):
  não há fatia mais fina que o Cargo exponha mecanicamente para checar, então
  a fronteira verificada é de crate, não de módulo interno.

  [`scripts/architecture-boundary-allowlist.txt`](scripts/architecture-boundary-allowlist.txt)
  lista as sete arestas reais do grafo atual (`nycode-agent -> nycode-ai`,
  `nycode-mcp -> nycode-agent`, e as cinco de `nycode-cli` para os crates que
  ele compõe). Uma dependência real sem entrada na lista reprova; uma
  entrada cuja dependência sumiu também reprova — a lista descreve o grafo
  real, nunca aspiração. TDD contra workspaces sintéticos, dez casos, verde
  de primeira.

- **`test_map` gerado na raiz do repositório (`AI-10` do padrão SOTA-2026).**
  Investigação inicial mostrou que este repositório não tem relação 1:1 entre
  arquivo-fonte e teste — `crates/nycode-agent/src/agent_test.rs` é um módulo
  de fixture compartilhado, importado também por `outcome_test.rs` e
  `compaction_test.rs`, nenhum dos quais protege só o arquivo cujo nome
  ecoa. Um mapa que afirmasse esse mapeamento seria falso em vários casos
  reais, e a própria regra AI-10 avisa que um mapa errado é pior que nenhum.

  Em vez disso, [`scripts/gen-test-map.sh`](scripts/gen-test-map.sh) gera um
  inventário honesto por crate — onde vivem os testes inline
  (`#[cfg(test)]`), os arquivos de teste dedicados (`mod *_test;`) e os
  testes de integração — sem afirmar qual protege qual arquivo específico.
  `--check` reprova se o [`test_map`](test_map) commitado ficou
  desatualizado; roda em `scripts/ci-local.sh --full` e no job `layout` do
  CI, TDD completo contra árvores sintéticas (12 casos, verde de primeira).

- **Gate de teto de PR assistido por IA (`GATE-11`/`AI-01` do padrão
  SOTA-2026).** Detecção mecânica de "assistido por IA": qualquer commit no
  intervalo com rodapé `Assisted-by:` põe o PR inteiro sob o teto de 400
  linhas alteradas / 15 arquivos (`Cargo.lock` excluído — churn mecânico do
  `cargo`). Roda só no job `pr-size` do CI, nunca em
  `scripts/ci-local.sh --full` — exceção documentada, porque a base certa de
  comparação (o alvo real do PR) só é conhecida dentro do contexto de um
  pull request via `github.base_ref`, e pode não ser `main` num PR
  empilhado sobre outro.

  Rodando o gate contra a própria PR desta fatia de trabalho
  ([#8](https://github.com/marcioazam/nycode-cli/pull/8)) confirmou que ela
  já excede o teto — 619 linhas em dois commits, antes mesmo deste terceiro.
  Achado esperado e não corrigido retroativamente: dividir o histórico já
  publicado exigiria reescrita, e o próprio ADR-0032 previu PRs subsequentes
  para o que não coubesse na primeira fatia. A partir daqui, cada item novo
  do roadmap entra numa PR própria — este, por exemplo, foi empilhado numa
  branch separada em vez de crescer a PR #8.

- **Gate de teto de 500 linhas por arquivo, com ratchet para o legado
  (`GATE-07`/`ARCH-11`/`RAT-04` do padrão SOTA-2026).** Quatro arquivos já
  excediam o teto no dia em que o gate entrou —
  `crates/nycode-agent/src/agent_test.rs` (775), `.../hooks_test.rs` (705),
  `crates/nycode-agent/src/agent/dispatch.rs` (515) e
  `crates/nycode-cli/src/session/mod.rs` (512) — e um gate que bloqueasse
  direto teria quebrado o CI em arquivos sem relação com a mudança que o
  introduziu. Em vez disso, [`scripts/file-length-baseline.txt`](scripts/file-length-baseline.txt)
  registra o tamanho de cada um no dia do baseline: o arquivo pode ficar do
  jeito que está, não pode crescer, e a entrada cai — reprovando o gate —
  quando o arquivo encolhe para dentro do teto ou some. Arquivo de teste
  conta igual a arquivo de produção, diferente do gate de layout: o teto mede
  o quanto um agente edita com confiança de uma vez, e isso não muda por o
  arquivo ser teste.

  [`scripts/file-length-gate.sh`](scripts/file-length-gate.sh) e seu
  auto-teste entram em `scripts/ci-local.sh --full` (job `layout` do CI),
  antes do próprio gate, no mesmo precedente dos outros gates locais.

- **Conformidade formal com o padrão externo SOTA-2026 (base-software-rules),
  nível L2.**
  ([ADR-0032](docs/architecture/decisions/0032-adota-padrao-externo-sota-2026-nivel-l2.md))
  Regras já vinculantes deste repositório (cobertura, layout, pinning de
  action) ganham ID citável do padrão; lacunas reais (mutation testing,
  complexidade, duplicação, cobertura de diff, `test_map`) ficam nomeadas em
  [`docs/product/ROADMAP.md`](docs/product/ROADMAP.md) em vez de invisíveis.
  Novo: `CLAUDE.md` (ponte para `AGENTS.md`), `SECURITY.md`,
  `CONTRIBUTING.md`, `.github/CODEOWNERS`. Rodapé de commit assistido por IA
  muda de `Co-Authored-By` para `Assisted-by: <agente>:<modelo>` — o primeiro
  é campo de crédito de autoria humana, e usá-lo para atribuição de máquina
  corrompe esse dado.

- **CI endurecido para SOTA 2026: 52 achados medidos, zero em severidade média
  e alta.** O `AGENTS.md` já dizia que artefato de terceiro verifica digest
  antes de executar, com o esperado fixado em arquivo versionado —
  `perf-baseline.yml` cumpre isso à risca. E os três workflows executavam doze
  referências a action de terceiro sem fixar nenhuma. `zizmor` mediu o custo
  real: 31 `unpinned-uses` de severidade alta, 10 `artipacked` (credencial
  persistida no checkout), 10 `excessive-permissions`, 1 `cache-poisoning`
  (cache restaurado no workflow que publica). `actionlint` achou uma perna de
  release que quebraria hoje: `macos-13` é label de runner aposentado.

  Corrigido: toda `uses:` é SHA de 40 caracteres com comentário verificado
  ([ADR-0030](docs/architecture/decisions/0030-toda-action-de-terceiro-e-fixada-por-sha-verificado.md)),
  `persist-credentials: false` em todo checkout, `permissions: contents: read`
  no topo de cada workflow com escalada só onde publica, cache removido do
  `release.yml`, `macos-13` → `macos-15-intel`. Três exceções documentadas em
  `.pinact.yaml`, não silenciosas: `dtolnay/rust-toolchain@stable` e as tags
  móveis de `taiki-e/install-action` usam, por desenho do mantenedor upstream,
  um esquema sem tag semver — continuam fixadas por SHA, só sem verificação
  automática contra uma tag que não existe.

  Também novo: `merge_group` no gatilho (a fila de merge é a peça do lado
  remoto que impõe o mesmo bloqueio que os hooks locais impõem do lado do
  desenvolvedor), `concurrency` com cancelamento, `timeout-minutes` por job, e
  `.github/dependabot.yml` para manter os pins vivos — fixar sem atualizador
  trocaria um risco por outro.

  As quatro ferramentas — `actionlint`, `zizmor`, `pinact`, `gitleaks` — agora
  rodam no nível rápido de [`ci-local.sh`](scripts/ci-local.sh) e no job
  `workflows` do CI, reprovando se ausentes. `zizmor.yml` nasce sem `rules:`
  de supressão, e a política é que continue assim: um achado médio ou alto
  vira correção, não entrada de exceção.

  Fica de fora, registrado e não silencioso: `softprops/action-gh-release`
  poderia virar `gh release create` (achado informacional, sugestão de
  redução de dependência, não correção de segurança) — fora do escopo desta
  rodada porque reescreveria comportamento do caminho de publicação, e essa
  decisão merece escrutínio próprio.

- **O inventário do que a referência entrega e este repositório não.** Sessenta
  deltas, lidos do `pi` no commit que o [`NOTICE`](NOTICE) fixa, triados em quatro
  baldes na [spec 002](docs/specs/002-paridade-e-sota-2026/spec.md): o que se
  adota, o que se adota modificado, o que se recusa e por quê, e o que fica
  adiado com o gatilho que o reabre.

  O achado que motivou o épico não é uma feature ausente. São **oito capacidades
  que este repositório declara ter e não tem**, e o caso limite é o controle de
  raciocínio: `Sampling` carrega `thinking_budget`, `Client::with_sampling` existe
  para configurá-lo, e nenhum dos dois tem chamador fora de teste. Os dois
  dialetos OpenAI mencionam `sampling` só dentro de helper `#[cfg(test)]` — a
  função que monta o corpo do pedido nunca o consulta.

  Os pisos de cobertura não pegam essa classe por construção: eles medem se a
  linha rodou, e o teste a roda. O `with_sampling` tem cobertura acima do piso e
  zero chamadores. Daí a verificação nova que a spec 002 acrescenta, que é sobre
  chamador de produção e não sobre linha executada.

- **Cinco ADRs**: [0025](docs/architecture/decisions/0025-o-nivel-de-raciocinio-e-um-conceito-do-harness.md)
  nível de raciocínio como conceito do harness,
  [0026](docs/architecture/decisions/0026-o-preco-vem-do-catalogo-descoberto.md)
  preço vindo do catálogo descoberto,
  [0027](docs/architecture/decisions/0027-a-compactacao-dispara-por-limiar-e-o-erro-e-a-rede.md)
  compactação por limiar com o erro rebaixado a rede de segurança,
  [0028](docs/architecture/decisions/0028-o-consentimento-fixa-a-definicao-declarada.md)
  consentimento fixando a definição declarada, e
  [0029](docs/architecture/decisions/0029-a-integracao-com-editor-fala-acp.md)
  integração com editor por ACP.

- **FR-21 no produto**, por emenda de escopo: integração de editor sai do
  não-escopo. O que **não** foi reaberto é a sessão remota sobre socket — o modo
  maduro do ACP é subprocesso local sobre entrada e saída padrão, sem socket
  escutando e sem decisão de autenticação de rede pendente.

- **CI local com bloqueio de merge, e uma definição só de verde.** Cobertura e
  performance já falhavam fechado; layout, ordem test-first e documentação eram
  convenção escrita e mais nada. Convenção sem instrumento é decoração — o mesmo
  argumento que este repositório usou para fechar o gate de paridade.

  [`scripts/ci-local.sh`](scripts/ci-local.sh) tem dois níveis: o rápido
  (formatação, clippy, testes, ~1 min) roda a cada commit, e o completo — a
  sequência inteira do `AGENTS.md` — é exigido no merge e no push, imposto pelos
  hooks versionados em `.githooks/`. O hook **executa** o CI em vez de confiar em
  resultado anterior: um verde de dez minutos atrás pode ser de outra árvore.

  A ativação é manual por clone (`git config core.hooksPath .githooks`) porque o
  git não tem como saber que o repositório traz hooks. `--check-hooks` recusa em
  voz alta quando não estão ativos: um hook que ninguém ativou é pior que nenhum,
  porque parece proteger.

- **Teto de sete arquivos de código por diretório, com gate.** Duas pastas já
  passavam: `policy` e `session`, com oito cada. As duas foram divididas por
  responsabilidade antes de o gate entrar — `policy/confinement` reúne o que
  decide até onde o comando alcança depois de começar, e `session/provider` reúne
  quem serve o modelo e como o pedido chega até ele.

  Uma subpasta por diretório, e não duas: o corte mais simples que resolve o
  gatilho. E segue o idioma dominante daqui, `foo.rs` mais `foo/`, que nove
  módulos já usam — forçar `foo/mod.rs` renomearia nove módulos contra o estilo
  da casa sem ganhar nada.

  [`scripts/layout-gate.sh`](scripts/layout-gate.sh) nasce sem arquivo de
  exemption, e a falha nomeia o diretório, lista os arquivos e avisa que nome
  vago (`utils`, `helpers`, `common`) não resolve — uma falha que só diz
  "estourou" empurra justamente para a gaveta.

- **Argumento de ferramenta que chega pela metade é reparado, e o reparo é dito.**
  Um `tool_use` viaja como fragmentos de JSON. Quando o turno era cortado — prazo,
  gateway que parou de enviar, cancelamento — o que sobrava virava `Value::Null`
  **em silêncio**, e a ferramenta recebia nulo sem que nada registrasse que houve
  truncamento.

  O reparo é conservador, e nisto diverge da referência. Fechar a aspa de uma
  string interrompida é o reparo óbvio e é o errado: `{"path":"src/ma` viraria
  `{"path":"src/ma"}`, e a escrita aconteceria num caminho que o modelo nunca
  pediu — com cara de pedido legítimo. Aqui o valor que estava sendo escrito é
  **descartado**, não completado: o que chegou inteiro se aproveita, o que faltou
  fica faltando, e a ferramenta recusa por argumento ausente, que é uma falha que
  se lê. E o agente avisa que reparou, porque um stream truncado não pode virar
  uma chamada de aparência normal — o usuário atribuiria ao modelo uma decisão
  que foi do transporte.

- **Valor certo no tipo errado deixa de virar o padrão em silêncio.** Um modelo
  emite `{"limit": "10"}` com alguma frequência. As ferramentas leem com `as_u64`,
  que devolvia `None`, e caíam no padrão sem dizer nada: o modelo pedia dez
  linhas, recebia outra coisa, e nada no turno registrava a diferença.

  Agora o argumento é lido no tipo que o schema declara — número em texto,
  booleano em texto, escalar onde cabe lista. A coerção não inventa valor:
  `"talvez"` continua não sendo número e a ferramenta recusa como recusaria antes,
  e `10.5` num campo inteiro fica como está em vez de ser arredondado por conta
  própria.

  Ela roda **antes** do hook e do gate, e a ordem é de segurança e não de
  conveniência: o que a política inspeciona e o que o usuário aprova precisa ser
  exatamente o que roda. Coagir depois trocaria o argumento sob uma decisão já
  tomada.

- **Retenção de cache passa a ter três estados, e a longa passa a ser pedível.**
  `Sampling` carregava um booleano: ligado ou desligado. A retenção estendida é
  um terceiro estado, com outra tarifa — e o repositório já sabia disso do lado
  errado. `Usage::cache_write_1h_tokens` existia, `catalog::cost` já o cobrava ao
  dobro da tarifa de entrada, e **nada no repositório conseguia pedir a retenção
  que produziria esse número**: o modelo de custo tratava um estado inalcançável.

  Agora `CacheRetention` tem `Off`, `Short` e `Long`. O dialeto Anthropic leva a
  retenção dentro do próprio marcador (`ttl: "1h"`); os dois dialetos OpenAI a
  declaram ao lado da chave (`prompt_cache_retention: "24h"`). O padrão continua
  sendo a curta: a longa se paga em sessão com intervalos grandes entre turnos, e
  ligá-la por omissão cobraria de todo mundo o que serve a poucos.

  A chave também passou a ser cortada ao limite de 64 caracteres do formato, e
  **pelo começo**: um id de sessão termina no que o distingue, e cortar a cauda
  colidiria duas sessões de mesmo prefixo num balde só — o erro exato que a chave
  existe para evitar.

  Fica de fora, declarado: `prompt_cache_options.mode`. Ele serve para desligar o
  cache implícito, e a referência só o emite quando o **modelo** declara aceitá-lo
  — modelos mais antigos recusam o pedido inteiro por causa dele. O catálogo deste
  repositório ainda não declara capacidade por modelo; emiti-lo às cegas trocaria
  uma economia por uma falha. Reabre quando o catálogo trouxer capacidades.

- **`Retry-After` em data HTTP deixa de ser descartado.** A RFC 9110 admite as
  duas formas e provedores grandes usam a data; este cliente lia só os segundos.
  Um cabeçalho descartado vira `None`, o cliente cai no backoff local e volta
  antes do que o servidor pediu — contra a fila que o servidor está justamente
  tentando drenar.

  A objeção registrada no código era o relógio: interpretar a data exige um
  confiável nos dois lados, e errar produziria espera arbitrária. Ela é
  respondida por duas guardas, e não por confiar mais no relógio. Uma data já
  passada — cliente adiantado, ou resposta que demorou — vira espera zero, e não
  um número enorme por subtração invertida; e o teto de `max_delay` continua
  limitando o resultado, como já limitava a forma em segundos.

  Sem dependência nova: `IMF-fixdate` é de largura fixa, e uma crate de data
  paga-se em bytes no binário auto-contido que o NFR-3 orça. As duas formas
  obsoletas da RFC ficam de fora — quem envia é obrigado à fixdate, e escrever
  analisador para o que nenhum gateway de 2026 emite custaria o mesmo binário
  sem cobrir caso nenhum.

- **Os dois estouros de janela que o provider reporta sem erro nenhum (FR-5).**
  Status 200, stream bem formado, e nada para o gatilho de compactação olhar —
  é a forma mais cara de degradação silenciosa que o fio tem, porque o harness
  entrega os dois ao usuário como se fossem resposta.

  O primeiro é o turno que **para no limite sem emitir conteúdo**: só acontece
  quando o prompt ocupou a janela inteira e não sobrou espaço para gerar. Antes
  ele voltava como texto vazio com `stop_reason` de limite. Agora o histórico é
  compactado e o turno se refaz — não há resposta a preservar. Parar no limite
  **com** texto continua sendo outra coisa, um teto de saída, e não dispara
  compactação: confundir os dois gastaria o orçamento no problema errado e ainda
  jogaria fora o texto que chegou.

  O segundo é o usage que declara **entrada acima da janela do modelo**: o
  provider truncou o começo da conversa e respondeu assim mesmo. Aqui a resposta
  vale e não se joga fora; o que muda é que o truncamento passa a ser dito, e o
  histórico compacta para o próximo turno caber. A janela vem do catálogo
  descoberto e de nenhum padrão embutido — sem número declarado não há
  comparação, e inventar um faria o harness acusar truncamento em todo endpoint
  que simplesmente não publica o tamanho. Ela acompanha a troca de modelo pela
  mesma razão que a tarifa: comparar o usage do modelo novo contra o limite do
  antigo dá um número errado com a mesma cara de um certo.

### Corrigido

- **O `ci-local.sh` chamava o `pinact` com a CLI da versão anterior, e a linha
  de instalação que ele mesmo imprime entrega a nova.** `pinact run
  -fix=false -no-api` é a forma da v2; a v3 removeu as duas flags e responde
  `flag provided but not defined: -fix`. Como `require_tool` manda instalar com
  `@latest`, quem seguia a instrução do próprio gate ficava com um binário que o
  gate não sabia dirigir — e o passo falhava por incompatibilidade de CLI, não
  por action desfixada. Num clone novo isso trava `--fast` inteiro, e portanto o
  `pre-commit`.

  Agora é `pinact run --check`: reprova sem reescrever arquivo e sem rede, que é
  exatamente o que a divisão de trabalho já documentada pedia — a verificação
  com rede (`--verify`, o par SHA/tag conferido contra o upstream) é a que o job
  `workflows` pede pelo `verify: true` da `pinact-action`, que já está na v3.0.0.
  O CI remoto, então, sempre rodou a v3; era o local que tinha ficado atrás,
  contra a regra de que os dois lados rodam o mesmo gate.

  Confirmado que o gate continua capaz de reprovar, e não só de passar: contra um
  workflow com `actions/checkout@v4` a nova invocação sai com 1 e nomeia a linha.

- **O `ROADMAP.md` declarava o produto pronto e afirmava uma causa de bloqueio
  que já era falsa.** Lido sozinho, ele dizia que as ondas A, B e C fecharam e
  que só restavam dois itens em "Depois" — sem citar nenhuma das quatro ondas
  que a [rastreabilidade da spec 002](docs/specs/002-paridade-e-sota-2026/traceability.md)
  registra como abertas desde o mesmo dia. Pela regra do
  [`docs/INDEX.md`](docs/INDEX.md) isso é defeito de um dos dois lados, nunca
  diferença tolerada, e o lado errado era o roadmap.

  Havia uma afirmação pior que a omissão: o roadmap dizia que a paridade
  completa "espera um gateway configurado". Deixou de ser verdade quando o
  `nycode-parity-fixture` passou a servir um gateway determinístico e local; o
  bloqueio real, descoberto ao rodar, é a referência não ler
  `ANTHROPIC_BASE_URL`. Um documento que nomeia a causa errada é pior que um
  que se cala, porque manda o próximo leitor resolver o problema que não
  existe.

  E duas contradições diretas. O roadmap recusava temas com "entra quando
  alguém pedir", enquanto o plano da spec 002 já os traz como o delta B36, na
  Onda 5; a recusa fica registrada, marcada como superada — apagá-la esconderia
  que a decisão mudou. E "Fora do roadmap" listava "interface gráfica ou de
  editor" como non-goal, o que lido hoje excluiria a Onda 4: a `spec.md` do
  produto já tinha sido emendada com a distinção que faltava aqui — falar com um
  editor por protocolo padronizado não é ter interface de editor, porque quem
  desenha a interface é o editor.

  O roadmap agora **aponta** para a rastreabilidade em vez de repetir o estado
  dela. Duplicar o estado por onda criaria a segunda cópia que fica errada
  primeiro, que é a mesma classe de defeito de origem.

- **A permissão sumia do rodapé de quem trabalha num caminho fundo.** A linha era
  montada inteira e depois cortada pela direita, e a permissão é o último campo:
  num terminal de 80 colunas bastava o caminho do workspace passar de dezenove
  caracteres para `somente-leitura` desaparecer. O usuário ficava numa sessão que
  recusa escrita sem nada no rodapé dizendo por quê — um estado que some por
  causa da largura do terminal é a degradação silenciosa que o NFR-4 proíbe.

  Agora quem cede espaço é o caminho, e cede pelo começo: `…/um-projeto` no lugar
  de `/home/alguem/source/um-projeto`. O começo é onde os projetos de uma máquina
  se parecem; o fim é o que os distingue. Os campos de comprimento fixo — sessão,
  modelo, contagem e permissão — não cedem.

  O defeito era coberto e invisível: todos os testes do rodapé mediam largura
  200, onde nada trunca. Apareceu de lado, num teste de sessão que monta o rodapé
  a partir de um diretório temporário e passou a falhar quando `TMPDIR` ficou oito
  caracteres mais longo que `/tmp` — a mesma falha que num terminal real teria
  passado por decoração.

- **O desligamento por entrada padrão do fixture matava o gate de paridade.** O
  fixture passou a encerrar ao ver o fim da entrada padrão — o que resolve a
  cobertura, porque processo morto por sinal não grava perfil. Só que o
  `parity-gate.sh` sobe o fixture em segundo plano, e ali a entrada padrão é
  `/dev/null`: EOF na primeira leitura. O gateway morria depois de anunciar a
  porta e antes do primeiro pedido, e o gate acusava o candidato de falha de
  transporte que era do próprio instrumento — a forma mais cara de erro num gate,
  porque a acusação parece vir do que ele deveria medir.

  O desligamento negociado agora é pedido por `--shutdown-on-stdin`, e a bateria
  de testes o pede. Quem sobe o fixture em segundo plano não precisa saber que
  existe uma entrada padrão para segurar.

- **O gateway de fixture aparecia com zero por cento de cobertura sem ter deixado
  de ser testado.** A bateria o desligava com sinal, e um processo morto por sinal
  nunca grava o arquivo de perfil: a casca de E/S do gateway constava no relatório
  como código que ninguém executou, quando cinco testes a exercitavam. O
  desligamento agora fecha a entrada padrão, e o faz em `Drop` — numa chamada ao
  fim de cada teste, uma asserção que falha nunca chegaria lá, e o perfil se
  perderia justamente na execução que interessa investigar.

  O caminho de saída sem sinal já estava escrito no fixture e nunca tinha rodado:
  faltava a feature `sync` do tokio no manifesto do crate, então o binário não
  compilava.

- **Cancelar um comando deixava vivo o que ele tinha iniciado.** O `kill_on_drop`
  do tokio manda `SIGKILL` ao processo direto, e só a ele — o mesmo defeito que o
  [ADR-0021](docs/architecture/decisions/0021-terminar-e-sinalizar-o-grupo-nao-o-lider.md)
  fechou no caminho do prazo e deixou aberto no do cancelamento, afirmando que
  ele "cobre o `drop` do future". Cobria metade: o líder.

  O teste que existia não pegava porque o comando largado nele escreve por conta
  própria, e ali matar o líder basta. Com um comando cujo neto é quem escreve, a
  sentinela foi de 16 para 62 bytes **depois** de o comando ser largado — escrita
  no workspace que o modelo estava inspecionando, depois de a ferramenta ter dito
  que interrompeu.

  A guarda dispara enquanto o filho ainda não foi colhido, e é isso que torna o
  número seguro de sinalizar: o zumbi reserva o PID, que é também o identificador
  do grupo. No caminho normal ela é desarmada, porque depois da colheita o número
  deixou de ser nosso e sinalizá-lo alcançaria quem o herdou.

- **Trocar de modelo no meio da sessão podia derrubar a conversa inteira.** O
  `openai-responses` emite `call_id` que passa de 450 caracteres e contém `|`; a
  Anthropic aceita `^[a-zA-Z0-9_-]+$` com no máximo 64. Os três dialetos ecoavam
  o identificador cru, e o `set_backend` mantém o histórico de propósito — é o
  que a troca de modelo precisa. Uma sessão que acumulasse chamadas de ferramenta
  sob um dialeto e trocasse para o outro mandaria identificadores que o provedor
  recusa, e a recusa é **da conversa inteira**, não da chamada: a sessão pararia
  de funcionar sem que nada no histórico estivesse errado.

  A reescrita acontece na montagem do corpo, e não na recepção, porque o
  `call_id` precisa voltar intacto para quem o emitiu — normalizar na entrada
  quebraria o caso comum, que é não trocar de dialeto. É determinística e sem
  estado: o bloco de uso e o resultado que responde a ele passam pela mesma
  função na mesma montagem, então o par continua casando sem mapa de sessão. O
  resumo que entra quando o identificador é longo demais é do original e não do
  já limpo — dois identificadores que só diferem fora do alfabeto colidiriam
  depois da limpeza, e dois usos com o mesmo identificador são uma conversa
  recusada por outro motivo.

- **As skills não podiam ser carregadas.** O bloco de skills publicava nome e
  descrição sem o caminho do `SKILL.md`, então o modelo sabia que a skill existia
  e não tinha como buscar o corpo dela. Deixar o corpo de fora é certo e continua
  — despejar todos gastaria a janela com instrução que a maioria dos turnos não
  usa —, mas a economia só funciona se houver como carregar depois.

- **Duas das cinco dimensões do harness de paridade não podiam ler a
  referência.** O dialeto de referência procurava `tool_use` com `name` e
  `input`, e `message` com `usage` na raiz — que é o formato de fio da Anthropic,
  o mesmo que o nosso próprio dialeto já trata. O `pi --mode json` emite
  `tool_execution_start` com `toolName` e `args`, e `message_end` com
  `stopReason` e `usage.input`/`usage.output` dentro de `message`. Uma varredura
  no código da referência confirma que ela nunca emitiu evento de stream chamado
  `tool_use`: o nome existe lá como bloco de conteúdo da Anthropic, que é a
  semelhança que enganou.

  Apontado ao `pi` de verdade, o resultado não seria divergência de
  comportamento: a sequência de ferramentas ficaria vazia e a contabilidade de
  tokens daria `0/0` em toda execução, por motivo estrutural. Um gate que reprova
  sempre pelo mesmo motivo errado é um gate que alguém desliga.

  Os dezoito testes do dialeto não podiam perceber isso porque validavam o
  parser contra um formato inventado no próprio teste. Os novos leem uma
  transcrição montada a partir do que a referência documenta em
  `packages/coding-agent/docs/json.md` e `docs/session-format.md`, com a origem
  citada no fixture — a diferença entre testar contra o que existe e testar
  contra o que se imaginou.

  O vocabulário de parada passa a ser traduzido em vez de comparado verbatim: a
  referência diz `stop` onde nós dizemos `end_turn`, e comparar as duas grafias
  marcaria divergência em toda execução bem-sucedida. Um valor fora da tabela
  passa inteiro, pela mesma razão que o nosso stream preserva
  `StopReason::Unrecognized`.

  O dialeto saiu de `runner.rs` para `dialect.rs`: rodar um harness e fotografar
  o disco muda por um motivo, traduzir o que cada harness publica muda por outro.

- **Um comando que deixa processo em segundo plano deixou de ser reportado como
  estouro de prazo.** `sleep 30 & echo pronto` sai na hora e com sucesso, mas o
  neto herda a ponta de escrita do `stdout` e a segura: a drenagem esperava um
  EOF que não vinha, o turno ficava preso os trinta segundos inteiros, e o modelo
  recebia `comando excedeu 30s e foi interrompido`. Uma execução bem-sucedida
  reportada como falha é pior que uma lenta, porque o passo seguinte é decidido
  sobre um fato falso.

  O grupo passa a ser terminado no instante em que o líder sai, em paralelo com a
  drenagem
  ([ADR-0024](docs/architecture/decisions/0024-o-grupo-morre-quando-o-lider-sai-nao-quando-o-cano-cala.md)).
  O que havia antes tentava fazer isso depois do `join` das duas coisas, e não
  podia funcionar: o `join` não completa enquanto a drenagem não termina, então o
  sinal que a destravaria só sairia depois de ela ter se destravado sozinha. E
  não funcionava nem se a ordem estivesse certa — o término partia do `Child`, e
  depois do `wait` o tokio já colheu o filho, então não havia mais PID a
  sinalizar. O comentário no código afirmava a garantia que nenhuma das duas
  metades entregava.

  O identificador do grupo passa a ser guardado antes da espera, que é enquanto
  ele existe. A saída já escrita não se perde: fechar a ponta de escrita não
  descarta byte que já está no cano.

### Adicionado

- **`edit` passou a casar e a gravar num arquivo com CRLF.** O modelo escreve
  `old_string` com `\n`, sempre. Num arquivo com CRLF o casamento exato nunca
  dava certo, e a resposta era `nao encontrado; confira espacos e indentacao` —
  que manda procurar uma diferença invisível e queima uma rodada. Basta um `.bat`
  ou um `.csproj` no repositório para o caso aparecer.

  Ao gravar, a terminação original volta. Converter para LF transformaria a
  edição de uma linha num diff de arquivo inteiro no `git`, e quem revisa
  perderia de vista o que mudou. Arquivo misto fica byte a byte como estava:
  normalizar ali reescreveria as linhas que já eram LF, que é justamente o
  estrago que se quer evitar.

  Não há tratamento de BOM, e a ausência é deliberada. Escrevi um e descobri
  medindo que ele não muda nenhum desfecho — o BOM fica no começo do conteúdo e
  atravessa a substituição sozinho, com os testes passando com e sem o código.
  Os testes ficaram; o código saiu.

- **Cota esgotada e problema de faturamento falham na hora.** Os dois chegam com
  429, o mesmo status da vazão, e a vazão é o caso que passa com espera. Cota não
  passa: o backoff gastava o orçamento inteiro de retentativa para repetir, no
  fim, a mesma mensagem que a primeira tentativa já trazia — com o usuário
  olhando para uma tela parada durante a espera.

- **Um orçamento de raciocínio não come mais o teto inteiro.** Neste provedor o
  raciocínio divide o `max_tokens` com a resposta, e um orçamento sem folga
  produz um turno que pensa e não responde: gastou tokens, demorou, e devolveu
  nada. Agora o teto sobe para caber os dois, com mil tokens reservados para a
  resposta. Quem cede é o teto e não o orçamento — encolher o raciocínio daria
  menos do que foi pedido sem dizer, e abaixo de mil tokens o provedor recusaria
  o pedido de qualquer forma.

- **`stdin` canalizado entra no prompt em modo headless.** `cat README.md |
  nycode -p "resuma isto"` é a convenção de todo utilitário Unix, e sem ela o
  binário só entrava num pipeline por `$(cat ...)` e pela briga de escape do
  shell que isso traz. O `stdout` já carregava só a resposta; faltava a outra
  ponta.

  O texto canalizado vai depois do prompt, porque o que o usuário digitou é a
  instrução e o que veio pelo cano é o material sobre o qual ela age — invertido,
  um arquivo longo empurraria a instrução para o fim de uma mensagem enorme. Um
  cano sozinho vira o prompt inteiro. O teto de 256 KiB existe para que
  `cat enorme.log | nycode` não vire uma `String` do tamanho do arquivo antes de
  qualquer decisão sobre ele.

- **`grep` aceita `context` e `literal`.** Sem contexto, toda busca útil vira
  busca seguida de `read` — duas rodadas para responder o que uma resolve. E um
  padrão como `foo(bar)` é um grupo de captura em regex, então procurar o texto
  exato dependia de o modelo escapar certo na primeira tentativa; agora o erro de
  padrão inválido também diz que existe `literal`.

  O motor do ripgrep já suportava os dois, então a mudança é passar parâmetro. O
  que exigiu cuidado foi o teto: ele passou a contar **linhas emitidas** em vez
  de casamentos, porque sobre casamentos um contexto de cinco multiplicaria a
  resposta por onze sem nada perceber. Linha que casa sai com `:` e linha de
  contexto com `-`, que é a convenção do `grep` e é o que diz ao modelo qual das
  onze ele procurou. Contexto acima de cinco é recortado em vez de recusado —
  recusar custaria uma rodada para conseguir o que cinco linhas já davam.

- **`post-tool-use` passou a disparar, e o FR-7 fechou.** O ADR-0009 desenhou
  quatro eventos de hook; este era o que faltava, e o que o mantinha adiado era
  uma pergunta de contrato: quanto da saída de uma ferramenta chega ao hook. Ela
  não tem tamanho conhecido por ninguém no caminho — `bash` derrama o excedente
  para arquivo, um servidor MCP devolve o que quiser —, e o hook dispara uma vez
  por chamada de ferramenta contra um orçamento de RSS de 14 MiB.

  O contrato é o começo da saída, cortado em 64 KiB, **mais o número de bytes de
  que esse começo veio**
  ([ADR-0022](docs/architecture/decisions/0022-o-post-tool-use-recebe-a-saida-cortada-e-o-tamanho-dela.md)).
  Nenhuma das duas metades serve sozinha: sem o corte o payload tem o tamanho da
  saída de uma ferramenta, e sem o tamanho o hook decide sobre um pedaço
  acreditando ter lido tudo. O corte reusa o `capped::Capped`, que já é o par
  "pedaço guardado + tamanho de origem" do repositório. O payload carrega também
  se a ferramenta marcou erro: achatar isso deixaria um hook de auditoria
  adivinhando pelo texto se o comando funcionou.

  O evento **não veta**, e uma recusa que chegue nele é registrada em voz alta e
  ignorada — quando ele roda, o arquivo já foi escrito. Ele também só dispara
  depois de a ferramenta ter rodado de fato: um veto do `pre-tool-use`, uma
  recusa do gate ou um nome desconhecido não produzem evento, porque anunciar
  uso de ferramenta onde não houve uso faria o registro descrever o que não
  aconteceu.

  No caminho, um defeito que o evento novo tornaria comum: a escrita do payload
  no `stdin` do hook acontecia **fora** do prazo. O buffer de um cano no Linux é
  de 64 KiB, e acima disso `write_all` espera o hook ler — um hook que não lê o
  stdin penduraria a chamada de ferramenta sem teto nenhum. Já valia para um
  `write` de conteúdo grande.

- **O provider passou a ser configurável por arquivo, que é o que o FR-9 promete
  desde sempre.** O requisito estava declarado entregue e não estava: um provider
  alternativo se escolhia por flag e por variável de ambiente, e o `por arquivo`
  do texto não existia em lugar nenhum do caminho de produção. A única leitura de
  arquivo na camada de IA era o cache do catálogo de modelos, que é outra coisa.

  O bloco `provider` do `settings.json` aceita `base_url`, `dialect`, `model` e
  `max_tokens`, e a ordem é flag, depois arquivo, depois o padrão embutido. A
  flag vence porque é a exceção declarada na hora: quem apontou a máquina para um
  gateway interno ainda precisa conseguir usar o de fábrica numa execução sem
  editar o arquivo e lembrar de desfazer.

  A escolha é por campo e não pelo bloco inteiro. Trocar só o `base_url` mantém o
  diálogo e o modelo padrão, e `--model` sozinho não arrasta o endpoint de volta.
  Um bloco atômico obrigaria a repetir os quatro campos para mudar um, que é a
  forma de o arquivo envelhecer errado quando um padrão do binário muda.

  O padrão saiu do `default_value` do `clap` para que isso fosse possível: com
  ele, toda invocação chega preenchida e não há como distinguir o que o usuário
  pediu do que veio de fábrica — o arquivo nunca seria consultado. A ausência da
  flag é o sinal, e é o que `session::settings::resolve` decide.

  Endpoint em branco e teto de tokens zero são recusados na leitura, não aceitos
  como se fossem o padrão: os dois montam a sessão e só falham na primeira ida ao
  modelo, longe da causa.

- **`grep` passou a ser regex de verdade, e as três ferramentas de busca passaram
  a respeitar o `.gitignore`.** A busca era `haystack.contains(&needle)`: um
  modelo que escrevesse `fn \w+\(` recebia zero resultados sem nada dizer que o
  padrão não fora interpretado — a pior forma de falhar, porque parece que o
  termo não existe. Agora o motor é o do ripgrep, como biblioteca
  ([ADR-0019](docs/architecture/decisions/0019-a-busca-usa-o-motor-do-ripgrep-como-biblioteca.md)),
  e um padrão inválido diz o que está errado.

  A lista fixa de sete diretórios saiu. Ela errava dos dois lados: não conhecia
  o diretório de saída que um projeto configurou, e escondia um `dist/` que
  alguém versionou de propósito. Quem decide agora é o `.gitignore` do
  repositório, que é a declaração que o projeto já mantém. Fora dela ficam só o
  `.git` e o `.gitignore` global do usuário — este último desligado porque faria
  a mesma pergunta ter respostas diferentes em duas máquinas.

  A varredura passou a ser preguiçosa: a busca para de ler ao atingir o teto de
  resultados, em vez de materializar até 20.000 caminhos antes de examinar o
  primeiro casamento. Continua determinística, porque uma ordem que muda entre
  execuções invalida o cache de prompt (NFR-7) e faz o harness de paridade
  acusar divergência que não existe. E a detecção de binário passou a ser por
  byte nulo em vez de falha de UTF-8 — um arquivo cheio de nulos é UTF-8 válido
  e antes passava.

  Custo medido: 1,42 MiB de binário, de 12.101.720 B para 13.587.008 B, contra
  um piso de 16.777.216 B. Sobram 3,04 MiB. O `pi` resolve o mesmo problema
  baixando os binários do `rg` e do `fd` do GitHub sem verificar digest e
  prependando o diretório ao `PATH` de todo comando de shell; como biblioteca não
  há artefato para verificar.

- **`read` ganhou `offset` e `limit`, e o truncamento passou a dizer como
  continuar.** O schema só aceitava `path`, então acima de 256 KiB o resto do
  arquivo era **inalcançável por essa ferramenta**: o aviso dizia que cortou e
  não havia próxima chamada a fazer. Agora a leitura é por faixa de linhas, a
  numeração é absoluta, e o aviso diz `use offset=N para continuar` — um turno a
  menos por arquivo grande. Um `offset` além do fim diz que a linha não existe,
  em vez de responder vazio e fazer o modelo concluir que leu tudo.

  A faixa é montada linha a linha durante a leitura, e não recortada depois: um
  arquivo minificado é uma linha só, e lê-lo inteiro para depois cortar traria o
  megabyte para a memória antes do corte.

  A detecção de binário passou a ser por byte nulo. `\0` é UTF-8 válido, então a
  recusa por falha de decodificação deixava passar exatamente o arquivo que
  menos serve ao modelo.

  `grep` e `find` seguiram o mesmo princípio: o aviso de teto diz o que
  restringir — `path`, `glob`, ou um padrão mais específico — em vez de só
  constatar o corte, que fazia o modelo repetir a mesma busca esperando resposta
  diferente.

### Corrigido

- **Conectar um servidor MCP deixou de invalidar o prefixo cacheado (NFR-7).** O
  catálogo era ordenado por nome, com o ponto de corte do cache na última
  ferramenta do array. Uma ferramenta de servidor chamada `docs__search` cai
  entre `bash` e `edit`: ela não era acrescentada ao fim, era **inserida no
  meio**, deslocando o resto e fazendo o ponto de corte passar a cobrir outra
  coisa. O resultado é o oposto do que o cache existe para fazer — o turno
  inteiro repaga.

  Agora o catálogo é particionado: nativas primeiro, extensões depois, cada
  grupo ordenado por nome, e o marcador vai na última **estável**. Uma extensão
  nova só aparece depois do corte e não conta. Sem nenhuma estável não há
  marcador, porque marcar a primeira extensão faria o ponto de corte se mover
  junto com o que ele deveria excluir. A distinção é declarada pela própria
  ferramenta, e não inferida do nome.

- **A compactação deixou de apagar o rastro do que já tinha sido feito.** O
  marcador dizia que houve compactação e mais nada, então o modelo relia os
  mesmos arquivos para descobrir onde estava — exatamente o trabalho que a
  compactação acabara de economizar, gasto de novo no turno seguinte. Agora o
  marcador carrega adiante os caminhos lidos e os modificados, a uma linha por
  arquivo, com teto de sessenta e a contagem do que não coube.

  As listas são cumulativas: o marcador da compactação anterior está dentro do
  trecho que a seguinte descarta, e é lido de volta — sem isso a segunda
  compactação apagaria o que a primeira preservou. Um arquivo que mudou não
  aparece também como lido, porque o modelo o reabriria antes de mexer nele de
  novo.

  Fica de fora, e é decisão e não esquecimento: o resumo em prosa do trecho
  descartado. Gerá-lo exige uma chamada ao modelo dentro do que hoje é uma
  função pura sobre mensagens, o que muda o contrato da compactação e o caminho
  de retentativa automática. Isso é spec própria.

- **O backoff de retentativa passou a ser espalhado.** Ele era exponencial puro,
  então `N` sessões que receberam o mesmo 503 esperavam exatamente o mesmo tanto
  e batiam no backend juntas de novo — que é como uma falha transitória vira
  permanente. Metade da espera continua fixa, para preservar o crescimento que o
  backoff existe para dar, e metade é sorteada. A entropia vem do subsegundo do
  relógio: espalhar retentativa não é uso criptográfico, e uma crate a mais
  custa binário que o NFR-3 não tem para gastar nisto.

- **A gravação de sessão passou a esperar o disco.** O `write` volta quando o
  núcleo aceitou os bytes, não quando o disco os tem, e uma queda de energia
  entre uma coisa e outra deixa uma linha pela metade. A linha pela metade não
  termina em newline, então o próximo append cola o registro seguinte no
  fragmento e perde dois em vez de um — o descarte de linha corrompida que já
  existia cobre uma linha, não duas.

- **O `--probe-startup` passou a reportar fases nomeadas.** O gate media a
  sessão montada e dava um número só, que diz que regrediu sem dizer onde:
  credencial, varredura do workspace, índice de sessão, catálogo e MCP têm
  causas e correções diferentes, e um salto de 2 ms é ação imediata se for a
  varredura e é o esperado se for um servidor novo. Sai em `stderr`, em
  microssegundos — no regime deste binário, uma etapa de 300 µs arredondada para
  `0ms` é uma etapa invisível.

- **O renderizador diferencial ganhou um contador de descartes.** Um gate de
  tempo não distingue "ficou lento" de "voltou a redesenhar tudo", e o segundo é
  o defeito que o ADR-0008 existe para não ter. O contador não conta o descarte
  causado por escrever no scrollback, que é consequência esperada: contá-lo o
  faria subir a cada linha de progresso, que é o mesmo que não medir nada.

- **O rodapé passou a mostrar o tamanho do erro de cache, e não só a taxa.** Um
  turno com 90% de acerto sobre um contexto de cem mil tokens repaga dez mil, e
  o rodapé mostrava `cache 90%`. Agora mostra também `repagou 10.0k`: o número
  que faz alguém olhar para o que está reescrevendo o começo do contexto.
  Repagamento abaixo de mil tokens não conta — é a granularidade do ponto de
  corte, e contá-la faria o rodapé acusar desperdício em toda sessão saudável.
  Compactar zera o baseline, porque ali o prompt seguinte é conteúdo novo;
  trocar de modelo não zera, porque ali o prompt é o mesmo e é cobrado de novo
  de verdade.

### Corrigido

- **Terminar um comando ou hook deixava um processo órfão rodando.** O
  `kill_on_drop` mata o processo direto, e só ele. Sob `bubblewrap
  --unshare-pid` isso é um defeito específico e medido: o `bwrap` externo morre
  e o processo dentro do namespace de PID, que lá dentro é PID 1, segue vivo e
  escrevendo no workspace. A suíte provou com um orçamento de 60 segundos: a
  escrita continuou pelos 60. Um hook roda a cada chamada de ferramenta, então
  o que escapava se acumulava na sessão, depois de o harness ter dito ao modelo
  que interrompeu.

  Agora o filho nasce líder de um grupo de processo próprio e terminar é
  sinalizar o **grupo**, não o líder
  ([ADR-0021](docs/architecture/decisions/0021-terminar-e-sinalizar-o-grupo-nao-o-lider.md)).
  Vale também sob bubblewrap: grupo de processo é herdado no `fork` e o perfil
  não passa `--new-session`, então o processo dentro do namespace de PID fica no
  grupo do `bwrap` externo e o sinal ao grupo o alcança. A referência nunca teve
  o defeito porque nunca confiou em matar o líder: o spawn dela é `detached` e o
  término vai ao grupo desde sempre.

- **Um filho destacado deixou de sobreviver à morte do próprio harness.** O
  ADR-0021 fechou o caso de quem larga o future — prazo e cancelamento — e
  declarou o preço: um filho destacado não está no grupo de frente do terminal,
  então `Ctrl+C` não chega a ele. Sobrava o caso em que o processo `nycode`
  inteiro morre. Num `SIGTERM`, num terminal fechado, **nenhum `drop` roda**:
  nem o `kill_on_drop`, nem o término do grupo. O comando sobrevivia ao harness
  escrevendo no workspace, e um hook dispara a cada chamada de ferramenta, então
  o que escapava se acumulava.

  Agora existe o registro dos filhos destacados que o processo subiu e ainda não
  colheu, varrido quando o sinal chega
  ([ADR-0023](docs/architecture/decisions/0023-o-registro-de-filhos-destacados-morre-com-o-processo.md)).
  Ele não é um estático global: é um valor com dono, porque varrer a instância
  do processo dentro da suíte mataria os filhos dos testes correndo ao lado — e
  sem essa costura a varredura ficaria sem o teste que prova a morte do neto.

  A baixa sai **junto com a colheita, nunca depois dela**, e o compilador
  garante a ordem porque a anotação é declarada depois do `Child`. É o que
  impede o defeito mais sério possível aqui: enquanto o líder não foi colhido, o
  zumbi reserva o PID, que é também o identificador do grupo, então a varredura
  só alcança processo que este harness subiu. Um registro que só crescesse
  guardaria número que o sistema já entregou a outra pessoa.

  Quem dispara a varredura é uma tarefa do runtime e não um handler de sinal:
  `tokio::signal` já resolve a parte que precisa ser async-signal-safe. `SIGINT`
  entra na lista só onde ninguém já o usa — em headless ele cancela o turno, e
  numa sessão interativa chega como tecla.

- **A saída que passava do teto deixou de ser jogada fora.** O corte guardava a
  cauda e descartava o resto, então um erro que ficasse acima dos 64 KiB era
  inalcançável: a cauda podia não ter a causa, e não havia onde olhar. Agora o
  excedente vai para um arquivo em `/tmp/nycode/`, e o aviso diz o caminho. O
  arquivo recebe a saída inteira e não só o pedaço cortado — mandar o modelo
  para um pedaço seria mandá-lo para o lugar errado.

### Adicionado

- **A compactação passou a resumir o que descarta.** O marcador levava os
  caminhos dos arquivos tocados, o que responde "no que eu mexi"; faltava "onde
  eu estava". Agora um pedido de uma vez só ao modelo produz o resumo, que entra
  na frente das listas. O pedido vai **sem ferramenta e com o cache desligado**:
  quem pede um resumo não quer que o modelo vá ler arquivo, e marcar para cache
  um conteúdo de uso único cobraria escrita que o turno seguinte não reusa.

  A falha desse pedido não impede a compactação, e isso é o desenho e não a
  exceção: compactar acontece quando a janela estourou, que é exatamente quando
  uma chamada a mais tem a maior chance de falhar. Sem resumo, o marcador com as
  listas vale por si.

- **`session-start` e `session-end` passaram a disparar.** O ADR-0009 desenhou
  quatro eventos de hook e só `pre-tool-use` rodava. Os dois de ciclo de vida
  não precisam de payload de ferramenta: o primeiro dispara depois do
  consentimento e antes do primeiro turno, o segundo depois de o último ter
  passado. O quarto, `post-tool-use`, esperou o contrato do payload e entrou
  logo depois — está no topo desta seção.

- **Os números que governam o agente saíram do binário.** Turnos recentes
  preservados na compactação, teto de idas e voltas de ferramenta e prazo de
  comando eram constantes. Isso serve enquanto o padrão serve, e deixa de servir
  na primeira sessão em que não serve — um repositório de arquivos grandes
  precisa de outra janela, uma suíte lenta precisa de outro prazo, e quem
  descobre isso não tinha o que fazer além de recompilar. Agora vêm de
  `~/.config/nycode/settings.json`.

  Do **usuário**, nunca do workspace, pela razão que o ADR-0016 já registrou: um
  `.nycode/settings.json` do repositório seria auto-certificante, porque a
  ferramenta `write` sob permissão ampla esticaria o próprio prazo e o próprio
  teto de turnos — justamente os limites que existem para contê-la. Campo
  ausente é o padrão, campo desconhecido é recusado em voz alta, e zero em
  qualquer um é recusado em vez de obedecido: seria uma sessão que não faz nada,
  e o usuário procuraria o defeito noutro lugar.

### Segurança

- **A credencial parou de sair em texto claro para fora da máquina.** `Config::new`
  aceitava qualquer `base_url` com esquema `http(s)`, e um servidor MCP por HTTP
  declarado no `.mcp.json` do repositório clonado não era validado de forma
  nenhuma. Nos dois casos o binário anexa a credencial ao destino, e o destino
  vinha de um lugar que o usuário não necessariamente conferiu. Agora `http://`
  só vale para loopback, e o resto exige TLS. O gateway local — que é o padrão do
  produto — continua funcionando sem certificado, porque exigi-lo ali obrigaria
  cada usuário a emitir um para falar consigo mesmo.

  A regra mora em `nycode_ai::destination` e é a mesma nos dois pontos. Ela lida
  com as formas que escondem o host de uma leitura ingênua: `http://127.0.0.1@evil.com/`
  fala com `evil.com`, e ler o começo do authority daria loopback.

- **A chave de API deixou de precisar aparecer no `ps`.** `--api-key` põe o
  segredo no `argv`, onde qualquer processo da máquina o lê, e no histórico do
  shell depois disso. Entrou `--api-key-file`, consultado antes do ambiente e do
  cofre. Como o valor é um caminho, `/dev/stdin` e substituição de processo —
  `--api-key-file <(pass show gateway)` — funcionam sem caso especial. As duas
  flags se excluem, para não inventar uma precedência que o usuário teria de
  adivinhar.

  Um arquivo comum que outras contas da máquina possam ler é recusado, com a
  mesma justificativa do `ssh` e uma mensagem que diz o `chmod` a rodar: mover a
  credencial do `argv` para o disco só ajuda se o disco não for público. O teste
  de modo não vale para `/dev/stdin` nem para pipe, que negá-los recusaria
  justamente o uso mais seguro. Um arquivo ilegível é erro e não ausência —
  cair para o ambiente escolheria outra credencial em silêncio.

- **O confinamento do macOS parou de ser relatado como equivalente ao do Linux.**
  `bwrap` monta um namespace e liga só o que foi pedido; o perfil Seatbelt abre
  em `(allow default)` e nega uma lista. A primeira política contém também o que
  ninguém previu, a segunda contém só o que alguém lembrou de listar, e as duas
  respondiam `is_enforced() == true` — que era tudo que o aviso e a resposta ao
  modelo consultavam. `Confinement::strength()` passa a distinguir três posturas,
  o aviso em `stderr` diz "confinamento PARCIAL" no macOS, e a resposta ao modelo
  carrega `[confinamento parcial: a politica permite por omissao e nega uma lista]`.

  O perfil em si não foi endurecido, e a
  [segunda emenda ao ADR-0005](docs/architecture/decisions/0005-sandbox-de-so-por-processo-auxiliar.md)
  registra por quê: um `(deny default)` exige enumerar cada capacidade que um
  build legítimo usa, e nada disso é verificável sem um Mac. Publicar o perfil
  fraco dizendo que é fraco é honesto; publicar um forte não testado não é.

- **O shell confinado deixou de ser shell de login.** `bash -lc` carregava
  `/etc/profile` e o perfil do usuário dentro do confinamento, devolvendo ao
  processo filho variáveis e funções que a allowlist de ambiente acabara de
  tirar — e cobrando o arranque do perfil em cada comando. Agora é `bash -c`; o
  `PATH` completo, que era o que o `-l` dava de útil, a allowlist já entrega.

- **O catálogo parou de mandar a credencial em dois formatos ao mesmo tempo.**
  A busca de modelos enviava `x-api-key` e `Authorization: Bearer` na mesma
  requisição, independentemente do dialeto. Agora usa o cabeçalho do dialeto
  configurado, e só ele.

- **O kill-switch do [ADR-0001](docs/architecture/decisions/0001-subscription-oauth-is-a-flagged-accepted-risk.md)
  foi auditado e o resultado registrado em vez de disfarçado.** `State::blocked()`
  não é chamado em lugar nenhum, porque o caminho de assinatura é inteiramente
  declarativo: nenhum token é adquirido ou usado, então não há rejeição a
  detectar. A mitigação real hoje é essa inércia, e ela virou verificação — o CI
  reprova se qualquer arquivo fora do módulo passar a referenciar `subscription::`,
  obrigando quem implementar o fluxo a ligar o kill-switch junto.

- **Uma extensão declarada pelo repositório deixou de rodar só por alguém ter
  aberto o diretório.** O `.mcp.json` e os executáveis de `.claude/hooks/` são
  lidos da raiz do workspace — o diretório que um `git clone` acabou de
  preencher com conteúdo de terceiro — e os dois terminavam em `Command::new`
  sem passar por decisão nenhuma. Clonar e abrir executava. Agora cada
  declaração pede consentimento, e o registro vive **fora** do workspace
  ([ADR-0016](docs/architecture/decisions/0016-extensao-do-workspace-exige-consentimento.md)):
  dentro dele seria auto-certificante, porque a ferramenta `write` sob permissão
  ampla concederia a própria confiança.

  A impressão digital é SHA-256 e cobre coisas diferentes conforme o caso. De um
  servidor MCP, a linha de comando, que é a mesma coisa que a pergunta mostra.
  De um hook, o **conteúdo do executável** enquanto o que se mostra é o caminho
  — senão reescrever o script sob um nome já confiado passaria livre, que é a
  forma que o rug pull toma ali. Trocar qualquer um dos dois faz a pergunta
  voltar.

  Sem interlocutor, nega e degrada: a extensão não sobe, a sessão segue, e o
  `stderr` diz o que foi recusado e o que teria rodado. É a mesma regra que o
  `Approver::Never` já aplicava a chamada de ferramenta, e nenhum pipeline
  existente quebra por causa dela. As chaves de ambiente aparecem na pergunta;
  os valores nunca, porque são segredo do usuário e um prompt os despejaria na
  tela e no scrollback.

- **Hook e servidor MCP passaram a rodar confinados, e o confinamento ganhou
  duas políticas.** A ADR-0005 declarava que o buraco do `McpTool` fechava "pela
  mesma via", e `sandbox::wrap` era chamado num único lugar do workspace. Ao
  fechá-lo, descobriu-se que a consequência era inaplicável como escrita:
  `workspace-write` nega rede, e um servidor MCP existe para falar com uma API —
  confiná-lo assim não o protege, o inutiliza. Daí a segunda política
  ([ADR-0017](docs/architecture/decisions/0017-duas-politicas-de-confinamento.md)):
  o shell e o hook escrevem no workspace e não alcançam rede, o servidor alcança
  rede e não escreve no workspace. As duas assimétricas porque os riscos são.

- **Um link simbólico no repositório deixou de contornar a contenção de
  caminho.** `ToolContext::resolve` normalizava componentes e barrava `..` e
  caminho absoluto, e `<raiz>/atalho` satisfazia `starts_with` por construção —
  então `read` lia o alvo e `write` o sobrescrevia. Pior: o mesmo valia para
  `AGENTS.md`, cujo conteúdo entra no **prompt de sistema** na abertura da
  sessão, sem nenhuma chamada de ferramenta, sem gate e sem o modelo precisar
  cooperar. A normalização continua léxica onde precisa ser, porque `write` cria
  arquivo que ainda não existe, e ganhou a canonicalização do ancestral
  existente mais próximo. Vale para as ferramentas e para instrução, skill e
  comando.

- **Extensão deixou de herdar o ambiente do harness.** Nem o servidor MCP nem o
  hook chamavam `env_clear`, então o filho recebia `NYCODE_API_KEY` e o resto
  das credenciais do usuário — para um processo que o repositório escolheu e
  que alcança a rede. Agora recebem uma allowlist mínima mais o que a
  configuração declarar.

- **O comando de shell era o terceiro filho, e era o que faltava.** A correção
  acima alcançou o hook e o servidor MCP e deixou `bash` de fora, que é o pior
  dos três: o comando é composto pelo modelo a partir de conteúdo do
  repositório, então um `AGENTS.md` que peça "rode `env`" entregava a chave do
  gateway sem contornar camada de política nenhuma — o gate autorizou `bash`, e
  `bash` foi o que rodou. As três cópias da lista viraram uma, em
  `policy::environment`, e o comando passa a receber `PATH`, `HOME`, `LANG`,
  `LC_ALL`, `TERM` e `TMPDIR`.

  Fechar sem saída faria o usuário exportar a variável dentro do próprio
  comando, então a lista é extensível por `~/.config/nycode/environment.json`.
  Do usuário, nunca do workspace: um `.nycode/` do repositório reabriria o
  ambiente que ele mesmo não deveria ver, pela razão que o ADR-0016 já
  registrou. Arquivo ausente ou corrompido é o mínimo, nunca o ambiente inteiro.

- **O teto de saída do shell passou a valer sobre a memória, e não só sobre o
  que o modelo lê.** `Command::output` lê os dois canos até o fim antes de
  devolver, então o corte em 64 KiB acontecia depois de a saída inteira já estar
  residente: um `cargo build` verboso, um `find /` ou um `yes` cresciam o
  processo sem limite, contra um orçamento de RSS de 14 MiB. É o mesmo defeito
  que `capped::read` já tinha corrigido na leitura de arquivo — "todo teto
  limitava o que chega ao modelo, e nenhum limitava o que entra na memória" — e
  o shell era o caso que sobrou. Agora a leitura é incremental e o processo
  segura no máximo o dobro do teto, qualquer que seja o tamanho da saída.

  Duas consequências visíveis. O que sobra passou a ser a **cauda** e não o
  começo, porque num comando o que decide o passo seguinte está no fim — o erro
  do compilador, o resumo do teste —, e a mensagem de truncamento diz qual ponta
  sobreviveu, senão o modelo leria a primeira linha do bloco como a primeira
  linha do comando. E os dois canais passaram a ser drenados junto com a espera
  pelo processo: ler um de cada vez trava quando o outro enche o buffer do cano,
  que no Linux é menor que a saída de um build.

- **Saída de ferramenta deixou de poder redesenhar o terminal.** Nada do que
  chegava à tela passava por limpeza de sequência de escape, e saída de
  ferramenta é conteúdo que o harness não escreveu — de um comando que o modelo
  compôs, de um arquivo do repositório, de um servidor MCP. Com o escape intacto
  esse texto sobe linhas, apaga o que está nelas e escreve por cima: o que
  estava ali pode ter sido a pergunta de aprovação, e o usuário responde a um
  prompt que o conteúdo desenhou. Um `\r` sozinho basta para a sobrescrita.

  Agora o scrollback da sessão interativa e as linhas de progresso passam por
  `tool::sanitize`, que remove as cinco famílias de escape, os controles C0 e
  C1, e os controles de direção de escrita — estes últimos porque fazem uma
  linha ser exibida em ordem diferente da que está gravada, e um agente que
  revisa código precisa ler o que está gravado. `\t` e `\n` ficam. A limpeza
  acontece **antes** do corte de largura, senão um escape partido ao meio
  chegaria à tela como texto.

  Três fronteiras deliberadas. O painel não passa pela limpeza, porque o escape
  ali é composto pelo próprio harness. A ferramenta `read` também não: um script
  que contém escape precisa chegar ao modelo com ele, e a saída de `read` não
  vai para a tela. E a resposta do modelo em `stdout` continua literal, porque é
  o que o contrato de pipe promete.

- **A contenção de caminho passou a valer até a abertura, e não só até a
  validação.** `ToolContext::resolve` decidia certo e devolvia um `PathBuf`, e
  `read`, `write` e `edit` reabriam por caminho depois — então bastava um
  componente virar link simbólico entre uma coisa e outra para a decisão deixar
  de valer. Em `edit` a janela ia da leitura até a escrita, com a contagem de
  ocorrências no meio; em `write`, da criação dos diretórios até a escrita. Um
  repositório que o agente clonou pode conter o processo que faz a troca.

  Agora a resposta é um descritor: `tool::contain` resolve o caminho uma vez sob
  `RESOLVE_BENEATH` e devolve o arquivo aberto, sem segunda resolução para
  envenenar. `RESOLVE_BENEATH` e não `O_NOFOLLOW` de propósito — um link que
  aponta para dentro da raiz é uso legítimo e continua funcionando
  ([ADR-0018](docs/architecture/decisions/0018-a-contencao-de-caminho-e-imposta-na-abertura.md)).
  Diretório intermediário passou a ser criado componente a componente a partir
  da raiz, porque `create_dir_all` resolve link em cada nível na hora em que
  chega nele, e criar diretório fora do workspace já é escrever fora dele.

  Onde `openat2` não existe — núcleo anterior ao 5.6, filtro de chamadas de
  contêiner, sistema que não é Linux — a abertura volta a ser por caminho, com a
  validação léxica como única garantia. O módulo distingue "o núcleo não conhece
  a chamada" de "o núcleo recusou o caminho": tratar recusa como ausência de
  suporte cairia no caminho sem contenção justamente quando ela funcionou.

  Custo medido: 71 KB de binário, de 12.030.616 B para 12.101.720 B, porque o
  `rustix` já estava na árvore por `crossterm` e `keyring` e só o módulo `fs`
  entrou.

- **A resposta de um servidor MCP ganhou teto, e os argumentos passaram a ser
  conferidos antes de sair.** A resposta era montada com `join` e ia inteira
  para a janela de contexto: um servidor que devolvesse o índice inteiro
  empurrava para fora o histórico que interessa, e um servidor é código de
  terceiro que o repositório declarou — o tamanho da resposta não é escolha do
  usuário. O teto é o mesmo da saída de comando, 64 KiB, e diz quanto ficou de
  fora. Ele vale sobre o que sai, não sobre o que entra: o SDK já desserializou
  a resposta quando o corte acontece, e limitar o quadro no transporte é o que
  faltaria para o teto ser de memória também.

  E o schema que o servidor declara deixou de ser só declaração. Ele era
  encaminhado ao modelo e nunca conferido, então um argumento obrigatório
  faltando virava erro de desserialização do outro lado, com a mensagem que
  aquele servidor escolheu escrever, a um processo de distância da causa. Agora
  presença do obrigatório e tipo do primeiro nível são conferidos antes da
  chamada. Não é validação completa e o módulo diz que não é: schema aninhado,
  `oneOf` e `enum` passam, porque um validador de JSON Schema inteiro é uma
  árvore de dependências para transformar um erro remoto legível num erro local
  legível. O que o módulo não entende, ele deixa passar — recusar o
  desconhecido transformaria cada schema exótico numa ferramenta quebrada.

- **`--allow-writes` deixou de conceder shell e ferramenta de terceiro.** O nome
  prometia escrita de arquivo e o efeito era trocar o gate por um que permitia
  tudo, inclusive `bash` e o catálogo inteiro de todo servidor MCP. A concessão
  virou um valor de três estados, e `--allow-all` é a flag separada para quem
  quer a maior.

- **Injeção no perfil do Seatbelt.** A raiz do workspace era interpolada crua
  numa string SBPL, e aspa e barra invertida são legais em nome de diretório no
  macOS: um caminho fechava o literal e o resto virava política, devolvendo ao
  comando o que a política acabou de negar.

- **O modelo passou a saber quando um comando rodou solto.** A ADR-0005 exigia
  duas coisas quando não há confinamento — aviso ao usuário e o fato na resposta
  do modelo — e só a primeira existia, condicionada a `--allow-writes`. A sessão
  interativa usa o gate `Ask`, que chega a `bash` por aprovação no prompt sem
  flag nenhuma: quem aprovava o fazia acreditando que o comando estava contido.

- **Nenhum portador de credencial revela mais o segredo em `{:?}`.** `Config`,
  `Credential` e o `env` de `ServerConfig` derivavam `Debug`. A higiene estava
  correta e nada vazava hoje; a trava é contra a próxima linha de log.

- **Um hook que falha voltou a ser ruidoso**, como a ADR-0009 exigia e o código
  não fazia: o código de saída era descartado, então um hook de política
  quebrado era ignorado em silêncio. E os eventos que ainda não disparavam
  deixaram de ser descobertos e anunciados no cabeçalho enquanto não
  disparassem — um controle que se anuncia e não existe é pior que a ausência
  dele.

- **Transcritos de sessão saíram do alcance do `git add -A`.** O store grava em
  `.nycode/` dentro da árvore versionada, e o transcrito carrega todo prompt e o
  conteúdo de todo arquivo lido no turno.

  A auditoria que originou tudo isto está em
  [`docs/specs/001-fronteira-de-confianca/`](docs/specs/001-fronteira-de-confianca/spec.md),
  com a matriz que liga cada achado ao requisito e ao teste que o protege.

### Adicionado

- **NFR-8 — segurança precede performance, com consequência e não como slogan.**
  As duas estavam em níveis documentais diferentes sem que ninguém tivesse
  decidido isso: performance era NFR-1 a NFR-3, cada um com orçamento e gate,
  enquanto segurança não era NFR nenhum — aparecia como FR-10 e FR-11, como
  `unsafe_code = "forbid"`, e como o job `supply-chain`. Enquanto os orçamentos
  tinham 50x de folga a assimetria era teórica, porque ninguém precisava
  escolher. Apertá-los é justamente a condição em que a tentação de pagar com
  segurança aparece.

  A regra vale por três verificações e não por declaração: os números de
  performance vêm do build padrão com todo controle ativo; um controle que torne
  um orçamento inalcançável move o orçamento, com o número medido registrado
  junto; e código que baixa artefato de terceiro confere o digest antes de
  executar. No CI a precedência é literal — o job `perf` declara
  `needs: [supply-chain]`, então o resultado de performance não é sequer
  produzido enquanto a política de dependências não passa
  ([ADR-0011](docs/architecture/decisions/0011-seguranca-antes-de-performance.md)).

  Uma otimização legítima fica fechada por isso: adiar a resolução de credencial
  ou a detecção de confinamento para o primeiro uso da ferramenta é a economia
  mais óbvia contra um orçamento de startup, e FR-11 exige que a ausência de
  confinamento seja dita — dizer depois de o usuário já ter decidido agir não é
  dizer.

- **Cada métrica de performance ganhou um segundo piso, relativo a um
  concorrente nomeado.** O orçamento de startup era 100 ms e a medição, 0,6 ms:
  uma regressão de cinquenta vezes passava no gate. É palavra por palavra o
  defeito que o [ADR-0003](docs/architecture/decisions/0003-pisos-de-cobertura-95-agregado-90-por-arquivo.md)
  já diagnosticou em cobertura — um piso muito abaixo do valor real deixa de ser
  piso e vira decoração —, e a resposta é o mesmo desenho: dois pisos, valendo o
  mais apertado.

  A diferença é que performance de harness só significa alguma coisa contra
  alguém. Ser mais rápido que a alternativa já instalada é a razão declarada de
  este projeto existir em Rust, e nenhum piso absoluto detecta o caso em que o
  concorrente melhora e nós não. O baseline é o `codex-cli`, escolhido porque é
  o único CLI de IA relevante reescrito em linguagem nativa e, ao mesmo tempo,
  uma das cinco referências permitidas — o mais rápido e o permitido são o mesmo
  projeto, então a escolha não custa nada em proveniência. Ele vive versionado
  em [`scripts/perf-baseline.txt`](scripts/perf-baseline.txt) com versão, data e
  digest, é medido por este repositório com o método do próprio gate, e é
  remedido pelo workflow agendado `perf-baseline.yml`, que abre PR quando o
  número se move. O CI de PR não fala com a rede
  ([ADR-0012](docs/architecture/decisions/0012-performance-e-medida-contra-um-concorrente-nomeado.md)).

- **FR-20 — `--image` anexa uma imagem ao pedido.** O arquivo é lido e embutido
  em base64, nunca referenciado por URL: uma URL faria o gateway buscar o
  arquivo, o que muda quem alcança a rede e o que o operador consegue auditar —
  e uma imagem local não teria URL nenhuma. Os três dialetos recebem o formato
  nativo de cada um; no Chat Completions o conteúdo vira lista, e só quando há
  imagem, porque mudar a forma sem necessidade invalidaria o cache de prompt.

  O tipo vem dos bytes e não da extensão: um `.png` que na verdade é JPEG faz o
  backend recusar com uma mensagem que não diz por quê. Um `RIFF` que não é WebP
  — um WAV, um AVI — é barrado aqui em vez de três camadas adiante. Arquivo
  ilegível, formato desconhecido ou acima do teto de 5 MiB param antes do turno,
  porque descobrir isso depois teria custado uma ida ao gateway para nada.

### Alterado

- **O gate de performance compara o menor tempo observado, não a mediana.** Não
  é preferência de estimador: num runner compartilhado a mediana mede a
  contenção e o mínimo mede o programa. Repetindo a mesma amostragem numa
  máquina em load average 89, o mínimo da chegada do processo ficou entre 465 µs
  e 560 µs — dispersão de 1,2x — enquanto a mediana foi de 1.033 µs a 3.580 µs,
  dispersão de 3,5x. Com a mediana o gate reprovava um binário sem nenhuma
  regressão, que é o modo de falha mais caro que um gate tem: uma vez que ele
  falha por ruído, alguém o desliga.

  O baseline mudou junto, e tinha que mudar: comparar o nosso mínimo com a
  mediana do concorrente inflaria a razão a nosso favor. `startup_median_us`
  virou `startup_fastest_us` e passou de 13.090 µs para 3.446 µs — o menor de
  quatro amostragens, que é o número mais favorável ao concorrente e portanto o
  mais honesto para calcular a nossa barra. Com ele, a margem relativa de
  startup caiu de ÷5 para ÷3: no pior caso observado a razão é 6,2x, e ÷5
  deixaria 1,2x de folga contra os 2x de ÷3.

- **O digest do artefato do concorrente saiu do sentinela.**
  `artifact_sha256` valia `nao-fixado` e `source_url` apontava para a página de
  releases, o que travava o workflow agendado por desenho — não havia contra o
  que conferir. Agora aponta para o `.tar.gz` do
  `codex-x86_64-unknown-linux-musl` da release `rust-v0.147.0`, com o digest do
  arquivo como ele chega da rede.

  O `perf-baseline.yml` ganhou o passo de extração que faltava: ele conferia o
  digest e executava o arquivo baixado direto, o que funcionaria para um binário
  cru e falha para um tarball. A ordem agora é conferir, extrair, executar —
  desempacotar antes de conferir já seria rodar o desempacotador sobre bytes não
  verificados. O `codex-package_SHA256SUMS` publicado não serve de contraparte
  porque cobre só os archives `*-package-*` e não menciona o binário puro; não
  havendo contra o que conferir a não ser o que este repositório fixou, adotar
  versão nova é uma alteração de digest visível em diff de PR, que é o controle
  que o NFR-8 exige.

- **Os ADRs 0011 a 0017 foram renumerados.** Três arquivos reivindicavam o 0011
  e três o 0012, cada um sobre um assunto diferente, resultado de trabalhos
  paralelos que escolheram "o próximo número" ao mesmo tempo — um "ver ADR-0012"
  podia apontar para confinamento, para performance ou para cancelamento. O par
  segurança/performance ficou com 0011 e 0012 porque o 0013 já citava esse 0012
  e reapontá-lo custaria mais do que deslocar os outros; extensão e confinamento
  desceram para 0016 e 0017, com as citações corrigidas nos dois sentidos.

- **O gate de performance passou a medir a sessão montada.** Ele aferia NFR-1 e
  NFR-2 com `nycode --version`, que o `clap` resolve dentro de `Cli::parse()` e
  encerra antes do runtime, da credencial, do disco e do MCP — tudo que os dois
  requisitos descrevem ficava fora da amostra, e o comentário no topo do
  `main.rs` fechava o círculo justificando o atalho com o gate que media o
  atalho. A rota `--probe-startup [MS]` monta a sessão de verdade, segura-a
  parada pelo tempo pedido e sai sem gastar um turno; o intervalo é parâmetro
  porque a latência quer sair na hora e o pico de memória quer esperar o
  runtime e as conexões MCP assentarem.

  Os números que isso revela: 2.901 µs para montar a sessão contra 589 µs de
  `--version`, e 8.364 KB de RSS ocioso contra 5.096 KB. O segundo já passava do
  piso absoluto de 8.192 KB que o [ADR-0012](docs/architecture/decisions/0012-performance-e-medida-contra-um-concorrente-nomeado.md)
  fixara — não por regressão, mas por o piso ter sido calibrado sobre uma carga
  que nunca aloca a sessão. A carga nova ganhou pisos próprios, 15.000 µs e
  14.336 KB, e o `--version` continua medido como chegada do processo por ser a
  única métrica com par comparável no concorrente
  ([ADR-0013](docs/architecture/decisions/0013-o-gate-mede-a-sessao-montada-e-nao-o-version.md)).

- **O gate de performance ganhou bateria própria.** `perf-gate-test.sh` monta
  repositórios sintéticos e exige o código de saída de cada caso — 0 aprova, 1 é
  violação de piso, 2 é erro de uso — como `coverage-gate-test.sh` já fazia. O
  volante é o baseline: como vale o piso mais apertado entre o absoluto e o
  relativo, um baseline minúsculo aperta o relativo e reprova qualquer medição,
  o que exercita cada piso sem depender de a máquina estar ociosa. A bateria já
  se pagou: encontrou o gate transformando "o binário não monta sessão" numa
  falha de instrumento, saindo 2 onde devia sair 1.

- **`observer.rs` e `events.rs` viraram `output/`.** São os dois destinos do que
  um turno produz e mudam juntos: acrescentar um evento ao contrato JSON exige
  decidir o que o texto mostra no lugar dele.

- **`nycode-mcp/session.rs` foi repartido.** Estabelecer a conexão e conversar
  sobre ela mudam por motivos diferentes — ali o que varia é transporte,
  arranque e degradação por servidor; aqui é o formato do resultado de uma
  chamada. `connect`, `attach` e `connect_all` desceram para `session/connect.rs`
  quando os prazos novos levaram o arquivo ao teto de 500 linhas.

- **`main.rs` foi repartido.** Ele estava no teto de 500 linhas e o `src/` no de
  8 arquivos, então a flag nova não cabia sem reagrupar. Saíram o vocabulário de
  códigos de saída (`exit.rs`), que muda quando o `stop_reason` do gateway muda,
  e a escolha de superfície (`route.rs`), que é função pura dos argumentos e do
  ambiente. O `catalog.rs` desceu para `session/`, onde é o único a usá-lo, e a
  exibição de caminhos virou `session/paths.rs`.

- **FR-19 — `/model` troca de modelo sem derrubar a conversa.** Sem argumento
  lista o que o endpoint serve, porque o usuário não tem como adivinhar o
  identificador aceito; com argumento troca, recusando antes um id que o
  catálogo não conhece — aceitar só falharia no próximo turno, quando o gateway
  recusasse, longe da causa. Sem catálogo obtido nada é recusado, porque
  transformar a indisponibilidade em erro de uso seria pior.

  O histórico fica: continuar a mesma conversa com outro modelo é o ponto —
  recomeçar já dava para fazer abrindo outra sessão. A fábrica de backend fecha
  sobre a configuração já resolvida, então trocar de modelo não significa
  reautenticar.

### Corrigido

- **Um `--resume` longo que estourasse o contexto derrubava o processo.** O modo
  headless persistia fatiando `history()` a partir da contagem de mensagens que
  vieram do disco. A compactação automática dispara dentro do próprio turno e
  reescreve o histórico — primeira mensagem, marcador de elisão e os últimos
  turnos —, então uma sessão retomada com quarenta mensagens virava oito e o
  índice quarenta caía fora do slice. O perfil de release usa `panic = "abort"`,
  e a queda acontecia **depois** de as ferramentas já terem escrito no disco.
  `unwrap` e `panic!` são `deny` de clippy, mas indexação de slice escapa do
  lint.

  Abaixo do limiar de queda o resultado era pior por ser silencioso: os índices
  deslocam, e a sessão gravava um recorte que não corresponde às mensagens
  novas — incluindo o marcador de elisão, que é artefato da janela de contexto e
  não algo que a conversa produziu.

  Clampar o índice pararia a queda e manteria o recorte errado. A correção é o
  agente registrar o que o pedido acrescentou, num diário que a compactação não
  toca: `messages` é o contexto que vai ao modelo e pode encolher, `produced()`
  é o que aconteceu e vai para o arquivo de sessão. Quem persiste deixa de fazer
  aritmética de índice sobre uma lista que outra camada reescreve.

- **Responder numa sessão gravada antes dos identificadores apagava a conversa
  da leitura.** Um arquivo v1 não tem `id` em registro nenhum, então `tip` não
  achava ponta, o `append` gravava a mensagem nova como **raiz**, e a leitura
  passava a seguir a árvore a partir dela — o índice de `id` não enxerga
  registro v1, e a caminhada terminava na primeira parada. `--resume` numa
  sessão antiga devolvia só a última mensagem, e o modelo recebia uma conversa
  sem passado.

  O que torna isto caro é que nada se perdia no disco: o arquivo continua
  append-only e íntegro, com todas as mensagens lá. A perda existia só na
  leitura, que é onde ninguém procura. A correção é o prefixo — a corrida de
  registros sem `id` que abre o arquivo entra na frente do caminho reconstruído.

  O teste que cobria compatibilidade v1 só **lia** um arquivo v1 e nunca
  acrescentava a um, que é justamente o caso de uso da compatibilidade.

  A reconstrução da conversa saiu de `store.rs` para `store/tree.rs`: é lógica
  pura sobre registros já carregados, os testes dela já viviam em arquivo
  separado, e o `store` fica com o I/O.

- **O total de tokens publicado omitia `reasoning_tokens`.** A soma do usage era
  uma lista de atribuições escrita à mão, e ela cobria cinco dos seis campos de
  `Usage`. O campo não é morto — os dois decodificadores OpenAI o preenchem e
  têm teste para isso —, então o modo `--output-format json` publicava
  `"reasoning_tokens": 0` para um turno em que o gateway tinha medido outro
  número, e o rodapé da sessão interativa contava a mesma coisa.

  A soma passou a viver junto do tipo, como `AddAssign` em `Usage`, e
  desestrutura o valor recebido: um campo novo em `Usage` não compila até que
  alguém decida ali como ele soma. A alternativa seria outra lista à mão, com o
  mesmo modo de falha esperando o próximo campo.

- **Um turno que nunca disse como terminou era reportado como concluído.** O
  laço do agente fechava a lacuna com `unwrap_or(StopReason::EndTurn)`, o que
  contradizia por escrito o módulo logo abaixo: `event.rs` abre dizendo que a
  projeção preserva o que o gateway emitiu e nunca inventa um `EndTurn`, e tem
  teste para isso. A garantia era desfeita uma camada acima, onde nada olhava.

  A consequência era observável: `exit::code_for` mapeia `EndTurn` para
  `ExitCode::SUCCESS`, então um turno cujo motivo de parada nunca chegou saía
  com código 0, indistinguível de uma resposta completa para o script que
  encadeia `nycode`. Agora vira `Unrecognized("ausente")`, que já cai no código
  de saída reservado e sobrevive intacto até o stream de eventos JSON.

- **O dialeto `openai-completions` não executava ferramenta nenhuma.** O chunk
  de `finish_reason` precisa fechar as chamadas que ficaram abertas *e* encerrar
  a mensagem, mas `StreamDecoder::decode` devolve um evento por linha do wire: o
  `return` que emitia o `ToolCallEnd` engolia o `MessageEnd`, e não existe uma
  segunda linha com `finish_reason` para recuperá-lo — o chunk de usage vem com
  `choices` vazio. O turno chegava ao agente sem `stop_reason`,
  `Turn::wants_tools` respondia `false`, e o laço devolvia `Outcome` descartando
  as chamadas que o modelo tinha pedido. Com chamadas paralelas o dano dobrava:
  um único `pop()` fechava uma e as outras nunca saíam de `open_tools`.

  O mesmo caminho perdia mais duas coisas em silêncio. O array `tool_calls` era
  lido só na primeira posição, então a segunda chamada de um chunk paralelo
  sumia antes de ser anunciada; e o fragmento de abertura era tratado como "ou
  id e nome, ou argumentos", quando o backend manda os três juntos — o começo do
  JSON era descartado e o modelo recebia de volta um erro de parse que não tinha
  causado.

  A correção é uma só para os quatro defeitos: o decodificador ganhou fila, e o
  `trailing()` que existia para o usage do `responses` virou um `drain()` que o
  driver esvazia antes de puxar cada linha e de novo no encerramento. Um dialeto
  que empacota vários eventos numa linha passa a caber no contrato, em vez de
  ter que escolher qual deles perder.

  Nenhum teste pegava, e o que existia congelava o defeito:
  `assembles_a_tool_call_from_indexed_fragments` afirmava o `ToolCallEnd` e nunca
  que um `MessageEnd` tinha sido emitido, e `Kind::OpenAiChat` só aparecia em
  teste de nome de dialeto e de header — nada dirigia o dialeto através do
  agente. Cada uma das linhas defeituosas estava coberta.

- **O primeiro `Ctrl+C` transformava a sessão interativa num no-op silencioso.**
  `Cancel` era um latch de mão única, e a sessão compartilhava um único sinal
  com o agente por todos os turnos. Depois da primeira interrupção, cada pedido
  seguinte era empilhado no histórico, curto-circuitado antes de chegar ao
  gateway, mapeado para sucesso e gravado no arquivo de sessão — sem resposta,
  sem erro, e deixando no disco mensagens nunca respondidas que voltavam no
  `--continue`. O sinal passa a ser rearmado no topo de cada turno, porque
  cancelar é do turno e não da sessão
  ([ADR-0015](docs/architecture/decisions/0015-o-cancelamento-e-por-turno.md)).
  Nenhum teste pegava: todos os de cancelamento rodavam `run()` uma vez só.

- **Não havia prazo de rede nenhum, em lugar nenhum.** O cliente configurava
  `user_agent` e mais nada, então um gateway que aceitasse a conexão e parasse
  de emitir pendurava o turno para sempre — e a única saída era o `Ctrl+C` que o
  defeito acima inutilizava. A busca de catálogo, que roda no arranque antes de
  a interface abrir, travava o binário sem desenhar nada na tela.

  Os prazos são de ociosidade e não de duração, porque um turno com raciocínio
  estendido leva minutos e o teto que protege contra um gateway morto seria o
  mesmo que mataria a resposta longa: `connect_timeout` de 10s e `read_timeout`
  de 120s, que reinicia a cada chunk e portanto mede o intervalo entre eventos
  do SSE. Só o catálogo, que não é streaming, ganha prazo total
  ([ADR-0014](docs/architecture/decisions/0014-prazos-de-rede-do-cliente-de-wire.md)).
  O mesmo ADR registra a política de retentativa, que existia em código sem
  decisão registrada. Ociosidade no meio do stream virou `Error::StreamIdle`, e
  não `MalformedStream` — o corpo não veio quebrado, e dizer que veio mandaria o
  usuário depurar a coisa errada.

- **O `bash` afirmava ter interrompido um comando que seguia rodando.** O
  estouro de prazo apenas largava o future, e o `Child` do tokio desanexa o
  processo no drop em vez de matá-lo: a ferramenta respondia "excedeu 90s e foi
  interrompido" enquanto o comando continuava escrevendo no workspace que o
  modelo estava inspecionando. É o NFR-4 pelo avesso — afirmar uma ação que não
  aconteceu. O comando passa a ser marcado com `kill_on_drop`, o que cobre os
  dois caminhos que largam o future, o prazo e o cancelamento no despacho; o
  argv do `bubblewrap` ganhou `--unshare-pid`, de modo que terminar o comando
  leve junto o que ele iniciou; e onde não há confinamento a mensagem passa a
  dizer que netos podem sobreviver, em vez de prometer o que não cumpre.

- **O hook tinha o mesmo defeito do `bash`, e mais um.** O prazo de 5s largava o
  future sem matar o processo, e um hook dispara a cada chamada de ferramenta —
  o que fica para trás se acumula ao longo da sessão, ainda escrevendo no
  workspace. Ganhou `kill_on_drop`. O que não tinha par no `bash` é que o stdout
  do hook não tinha teto nenhum: o prazo limita tempo, não memória, e em cinco
  segundos um hook escreve muito mais do que cabe no orçamento do NFR-2. Agora
  são 64 KiB guardados, e o excedente é lido e descartado em vez de deixar de
  ser lido — parar de ler encheria o pipe e travaria o hook, que é o oposto de
  falhar aberto.

- **Um padrão de `find` podia pendurar a busca para sempre.** O glob casava `*`
  por retrocesso recursivo, sem memoização, e o padrão vem do modelo: um
  `*a*a*a*a*b` contra um nome longo é retrocesso catastrófico, chamado duas
  vezes por arquivo, e nenhuma ferramenta tem prazo de execução. Virou varredura
  de dois ponteiros que volta ao último `*` e o faz engolir mais um byte — O(n·m)
  e sem pilha.

  No mesmo caminho, dois tetos que não seguravam nada. `MAX_VISITED` só era
  conferido no topo do laço externo, e um diretório plano é uma iteração só do
  externo: cinco milhões de arquivos passavam direto. E tanto a varredura quanto
  o `ls` coletavam o diretório inteiro num `Vec` para só depois descartar o
  excedente, o que já havia custado a memória que o teto existe para poupar.
  Ambos passaram a guardar as `cap` menores entradas, que é o mesmo prefixo que
  a ordem estável já entregava.

- **Todo teto de tamanho de arquivo era conferido depois da carga.** `read`
  truncava em 256 KiB depois de `tokio::fs::read` no arquivo inteiro; `edit` não
  tinha teto e ainda fazia uma cópia completa na substituição; `--image` e os
  arquivos de instrução repetiam o padrão. O teto limitava o que chega ao modelo
  e nada limitava o que entra na memória, num processo cujo orçamento de RSS é
  30 MiB — um arquivo grande no workspace derrubava o agente antes de o corte
  acontecer. O módulo `capped` passou a ler com teto e a tirar o tamanho real do
  metadado, que é o que as mensagens de truncamento mostram. `edit` ganhou teto
  explícito de 2 MiB, com recusa nomeada em vez de estouro no meio da edição.

  Um efeito colateral do corte por byte: ele pode partir um codepoint. Isso é
  diferente de um binário — ali o inválido está só nos últimos bytes —, e
  confundir os dois faria `read` recusar como binário um texto acentuado
  perfeitamente legível.

- **Gravar a sessão custava O(N²).** A escrita era append-only, mas descobrir o
  pai relia e reparseava o arquivo inteiro a cada mensagem, e o append acontece
  por mensagem e não por turno: um turno com vinte ferramentas fazia vinte
  leituras completas. `load` lia duas vezes, uma para achar a ponta e outra para
  montar o caminho até ela. O `Store` passou a lembrar a ponta que ele mesmo
  gravou — ele é quem grava, então não precisa reler para redescobri-la —, e
  `load` reaproveita os registros que já tem em mãos.

- **Nenhuma operação MCP tinha prazo.** Nem o handshake, nem a listagem de
  ferramentas, nem a chamada. Um servidor que sobe e emudece pendurava a
  abertura da sessão antes de a interface desenhar qualquer coisa, e uma
  ferramenta travada pendurava o turno; o `Ctrl+C` salva quem está no terminal,
  e em headless não há quem o aperte. São 20s para o arranque e 120s para uma
  chamada, que pode ser legitimamente demorada. O silêncio virou `Error::Timeout`
  e não `Connect`, porque o remédio é outro: recusa é configuração errada,
  silêncio é servidor travado.

- **A bateria de testes sujava o próprio repositório.** O helper que roda o
  binário nos testes de ponta a ponta não fixava diretório de trabalho, e o
  corrente de um teste de integração é a raiz do pacote: cada execução deixava
  sessões e cache de catálogo em `crates/nycode-cli/.nycode/`, um diretório não
  ignorado que entraria no primeiro commit. O helper passa a rodar num
  temporário, e sessão e cache de catálogo entraram no `.gitignore` — hooks,
  skills e regras em `.nycode/` continuam versionáveis, que é o ponto deles.

- **No dialeto `openai-responses` a contagem de tokens se perdia inteira.** O
  decodificador absorvia o usage e aceitava a marca de heurística, mas nunca
  emitia o evento: `decode` devolve um evento por linha do wire, e o
  `response.completed` — que concentra `stop_reason` e usage — já gastava esse
  retorno com o fim do turno. O resultado era contagem zerada, taxa de cache
  sempre em zero contra o NFR-7, e a flag de usage estimado que o NFR-4 exige
  visível nunca chegando ao usuário. O decodificador ganhou como emitir um
  evento que só cabe depois do encerramento, drenado pelo laço do stream.

- **Um arquivo ausente do relatório de cobertura passava pelo gate como se
  tivesse sido aprovado.** Os dois pisos do
  [ADR-0003](docs/architecture/decisions/0003-pisos-de-cobertura-95-agregado-90-por-arquivo.md)
  iteravam sobre o que o relatório continha, então o que não estava lá não era
  reprovado: não era examinado. A demonstração foi acidental — o gate imprimiu
  97,95% e "ambos os pisos satisfeitos" com `context/commands.rs`, 369 linhas
  recém-escritas, nunca medida, porque o relatório era três minutos mais velho
  que o arquivo. Bastou editar código depois de medir, que é a ordem natural de
  quem roda a bateria local.

  O gate passou a recusar relatório mais velho que qualquer fonte e a exigir que
  todo arquivo de produção em disco apareça no relatório ou esteja declarado
  como `no-statements`
  ([ADR-0010](docs/architecture/decisions/0010-o-gate-de-cobertura-exige-relatorio-completo-e-fresco.md)).
  A tabela de exemptions ganhou treze declarações — glue de módulo e um tipo de
  erro cujo único código executável é derivado, que o instrumentador do rustc
  não marca — e continua sem nenhum `below-floor`, que é a entrada que dispensa
  código medido de alcançar o piso.

  O próprio gate deixou de ser código sem teste: `scripts/coverage-gate-test.sh`
  monta repositórios sintéticos e exige o código de saída em quinze casos. Um
  gate que perdeu a capacidade de falhar aprova o workspace inteiro em silêncio,
  e nada avisaria.

- **`is_production` tratava `tree_tests.rs` como código de produção.** O filtro
  reconhecia `*_test.rs` mas não `*_tests.rs`, então 220 linhas de
  `#[cfg(test)] mod` entravam na conta que deveria medir só o que elas protegem.

- **Uma tecla digitada no instante em que o turno terminava virava
  direcionamento do turno seguinte.** O `select!` do laço escolhia ao acaso
  entre ramos prontos, então uma linha submetida no momento exato do fim do
  turno podia ser lida como correção de rumo em vez do pedido que o usuário
  digitou. O laço passou a ser enviesado: se o turno terminou, ele fecha antes
  de ler mais eventos.

- **FR-17 — plan mode, com `/plan`.** Entrar troca o gate por somente-leitura e
  acrescenta ao sistema a explicação de por quê: sem ela o modelo tentaria
  escrever, receberia recusa, e gastaria rodadas descobrindo o que já era para
  saber. O gate é a contenção de verdade; a instrução só evita o desperdício.

  Trocar o gate e o sistema no meio da sessão foi o que isto exigiu do agente.
  Refazer a sessão para mudar de modo perderia o contexto que é justamente o
  insumo do plano. Sair devolve o gate que a sessão tinha e não um padrão: com
  `--allow-writes` ele permitia tudo, e voltar a perguntar seria mudar a sessão
  pelas costas do usuário.

- **FR-15 — a ferramenta `task`, que delega a um subagente.** Existe pela janela
  de contexto: uma busca que lê trinta arquivos para achar três linhas gasta a
  janela inteira do pai com o que ele não vai precisar de novo; delegada, ela
  devolve as três linhas e o resto morre com o filho.

  O filho não vê o histórico do pai — herdá-lo desfaria a razão de existir da
  ferramenta, porque o custo seria o mesmo. Ele herda a permissão, porque um
  subagente que pudesse mais que quem o chamou seria uma escada de privilégio. E
  não recebe a própria `task` no catálogo: a recursão é impedida pela
  construção, e não por um contador que dependeria de o modelo respeitá-lo. Um
  filho que termina sem produzir texto chega ao pai marcado como erro, não como
  sucesso vazio.

  É divergência deliberada da referência
  ([ADR-0007](docs/architecture/decisions/0007-subagentes-sao-in-process-divergindo-da-referencia.md)):
  o `pi` recusa subagentes e recomenda `tmux`. A recusa dele é sobre agentes
  concorrentes de longa duração; isto é uma chamada síncrona que devolve texto e
  acaba.

### Alterado

- **`grep`, `find` e `ls` passaram a viver em `tools/search/`.** Compartilham a
  varredura e mudam juntas: o que uma delas passa a ignorar, as outras precisam
  ignorar também, senão `find` oferece um caminho que `grep` nunca vai visitar.

- **FR-16 — hooks de ciclo de vida.** O terceiro mecanismo de extensão do
  ADR-0002 passou a existir: executáveis em `.nycode/hooks/` ou
  `.claude/hooks/`, um por evento, com contrato JSON em stdin e stdout
  ([ADR-0009](docs/architecture/decisions/0009-hooks-sao-executaveis-com-contrato-json.md)).
  `pre-tool-use` pode vetar, e a razão que ele devolve chega ao modelo como
  resultado corrigível — sem ela, ele só saberia que falhou e tentaria de novo
  do mesmo jeito.

  O hook é consultado antes do gate: uma política que só rodasse depois não
  conseguiria proibir nada que o gate permitisse. Falha aberto, de propósito —
  um hook que trava, quebra ou responde lixo não bloqueia a sessão, porque a
  alternativa transformaria um script quebrado num agente inutilizável. Quem
  quer bloqueio garantido usa o gate, que é código. Um arquivo sem bit de
  execução é rascunho e não hook: executá-lo produziria um erro a cada chamada.

### Corrigido

- **Um hook recém-instalado podia ser pulado em silêncio.** `execve` devolve
  `ETXTBSY` enquanto alguém ainda tem o executável aberto para escrita — um
  instalador, ou o editor do usuário salvando. Desistir na primeira tentativa
  pularia um hook que existe e está instalado, que é o pior desfecho possível
  para uma camada de política. Agora há uma segunda tentativa depois de 50ms.
  O sintoma apareceu como teste intermitente, uma falha a cada quatro execuções.

- **FR-18 — dá para falar com um turno em andamento.** Digitar durante um turno
  descartava o que foi escrito, sem dizer nada, e corrigir o rumo exigia
  cancelar e recomeçar — jogando fora o que as ferramentas já tinham feito. O
  que o usuário completa com Enter entra na fila e chega ao modelo na próxima
  rodada, com aviso do que foi acrescentado: uma mensagem que entra em silêncio
  faz o modelo mudar de rumo sem que o usuário saiba por quê.

  A injeção acontece entre rodadas e em nenhum outro lugar. Ali o histórico está
  fechado, com todo `tool_use` já pareado; injetar no meio quebraria o par e o
  backend recusaria a conversa inteira — há um teste que percorre o histórico
  inteiro verificando isso. A fila tem quatro lugares e diz quando enche:
  acumular dez correções para despejar de uma vez confundiria mais que ajudaria,
  e perder uma em silêncio faria o usuário achar que corrigiu o rumo.

- **FR-14 — a sessão virou uma árvore.** O formato de registro subiu para a v2 e
  cada linha ganhou `id` e `parent_id`
  ([ADR-0006](docs/architecture/decisions/0006-a-sessao-e-uma-arvore-no-mesmo-arquivo.md)).
  `/tree` lista os pontos de retomada e `/fork <n>` passa a gravar a partir de
  um deles — nada é reescrito, o arquivo continua append-only, e a ramificação
  existe porque dois registros passam a compartilhar o mesmo pai. O ramo
  abandonado continua legível pela própria ponta.

  Ler devolve o caminho até o último registro gravado, e não o arquivo inteiro:
  mandar ramos abandonados ao modelo os apresentaria como parte da conversa. Um
  arquivo v1 continua legível — sem `id`, a sessão é uma lista, que é a árvore
  em que ninguém ramificou. Um `parent_id` órfão ou em ciclo termina a leitura
  em vez de pendurar o processo.

  Só turnos do usuário são oferecidos como ponto de retomada: ramificar do meio
  de uma resposta deixaria um `tool_use` sem o `tool_result` par, e o backend
  recusa a conversa.
- **Comandos embutidos de sessão.** `/help`, `/tree`, `/fork`, `/compact`,
  `/export` e `/quit` agem sobre a própria sessão e nunca gastam um turno.
  Resolvidos antes dos comandos de arquivo: um `/tree.md` no repositório não
  pode sequestrar a navegação da sessão.

- **A sessão interativa pergunta antes de mutar.** A permissão era binária:
  somente-leitura, ou `--allow-writes` liberando tudo de antemão. Onde há a quem
  perguntar, isso obrigava a escolher entre sessão inútil e cheque em branco.
  O gate ganhou uma terceira decisão, `Ask`, e a pergunta mostra a ferramenta e
  os argumentos — "permitir `bash`?" não é decidível; o que importa é qual
  comando.

  Quem pergunta é o loop de agente e quem sabe perguntar é o laço de interface,
  e os dois correm ao mesmo tempo: um canal os une sem inverter a posse. Toda
  ambiguidade resolve para não — teclado fechado, interrupção, tecla sem
  significado, interface caída. Em modo headless não há a quem perguntar e o
  padrão continua negando, porque aprovar por omissão daria a um pipeline a
  permissão que ninguém concedeu. Uma recusa volta ao modelo como resultado
  corrigível, não como aborto: ele pode propor outro caminho em vez de o turno
  inteiro se perder.

- **NFR-7 — o cache de prompt passou a ser pedido.** O `Usage` já reportava
  `cache_read_tokens` e `cache_write_tokens`, e o corpo enviado nunca carregava
  `cache_control`: a métrica existia sem a causa, e media zero para sempre.
  Agora o prefixo estável — o prompt de sistema e as ferramentas — leva um ponto
  de corte, e o rodapé mostra a taxa de acerto. Só a última ferramenta é
  marcada: o ponto de corte cobre tudo que veio antes dele, e um por ferramenta
  gastaria os que o backend limita.

  Com o marcador, `system` vai como lista de blocos em vez de string — é a forma
  que o dialeto exige, e sem cache a string volta. Um teste amarra a condição
  que faz o cache valer: o prefixo é byte-idêntico entre turnos, porque um
  prefixo que muda é um cache que erra e o custo volta inteiro sem que nada
  indique isso.
- **`temperature`, `top_p`, `stop_sequences` e `thinking` no corpo do pedido.**
  Nenhum vai ao wire sem ser pedido: mandar um valor inventado seria escolher
  por um modelo cujo padrão o provedor calibrou.

- **FR-13 — slash commands.** Um arquivo `nome.md` em `.nycode/commands/` ou
  `.claude/commands/` vira `/nome`, com `$ARGUMENTS` e posicionais `$1` a `$9`.
  Um pedido repetido — revisar um diff, escrever um commit, rodar a bateria —
  deixa de ser algo que o usuário redigita e vira algo que o repositório
  versiona, no mesmo formato que os outros harnesses já usam.

  A expansão acontece no cliente e o resultado vira um prompt comum: o modelo
  não sabe que existiu um comando, o que mantém o vocabulário de wire intacto.
  Um comando desconhecido não gasta turno — lista os que existem, porque mandar
  `/revisr` ao modelo custaria uma ida ao gateway para descobrir um erro de
  digitação. `/usr/bin/env` num pedido continua sendo caminho, não invocação.

- **FR-11 — o shell roda confinado pelo sistema operacional.** Até agora a única
  contenção de `bash` era o timeout e o stdin fechado: o gate de permissão
  decidia *se* o comando rodava, e nada decidia *o que ele alcançava* depois de
  começar. Isso fazia de `--allow-writes` um cheque em branco, com a política do
  harness virando convenção que qualquer `cd ..` contorna.

  A política é a forma do `workspace-write` do Codex — leitura ampla, escrita
  restrita à raiz e ao diretório temporário, rede negada — aplicada por
  `bubblewrap` no Linux e por `sandbox-exec` no macOS
  ([ADR-0005](docs/architecture/decisions/0005-sandbox-de-so-por-processo-auxiliar.md)).
  Envolver o processo filho num executável do sistema é o que permite fazer isso
  sob `unsafe_code = "forbid"`, que elimina FFI para `sandbox_init` e
  `landlock_*`.

  Onde o confinamento não está disponível, o comando ainda roda e o usuário é
  avisado: a diferença entre "protegido" e "achou que estava protegido" é a
  única que importa aqui. `permission` e `sandbox` passaram a viver juntos em
  `policy`, porque só valem juntos.

- **As ferramentas `grep`, `find` e `ls` (FR-3).** O gate de permissão já as
  nomeava no conjunto somente-leitura e nenhuma existia, o que significa que uma
  sessão restringida ficava com uma única ferramenta. Agora negar `bash` deixa o
  agente restrito, não cego, e a escolha deixa de ser entre dar shell ou não ter
  agente. Um teste amarra os dois lados: tudo que o conjunto somente-leitura
  oferece passa pelo gate, e nada que muta passa.

  As três compartilham a varredura, que não sai da raiz, não segue link
  simbólico e não despeja `target/` nem `.git/` no contexto. Toda saída é
  ordenada e limitada — ordem instável invalidaria o cache de prompt do backend,
  e um padrão que casa com tudo produziria resposta maior que a janela. Um
  arquivo binário é pulado em vez de despejado, e nenhuma delas responde vazio
  quando não há resultado: "nenhuma linha casa" é informação, silêncio faz o
  modelo desconfiar da ferramenta.

- **FR-12 — modo de eventos JSON.** `--output-format json` publica um evento por
  linha em stdout: texto, raciocínio, início e fim de cada ferramenta, avisos de
  sessão, e um evento final com `stop_reason`, contabilidade de tokens e número
  de rodadas. Quem integra o binário deixa de ter de inferir isso de texto
  formatado para humano. Um turno que falha termina em `error` e não em
  `result`, para que um consumidor não trate falha como conclusão, e um
  `stop_reason` fora do vocabulário chega literal.
- **Paridade no CI (NFR-4, NFR-6).** `nycode-parity` ganhou binário e job. As
  duas dimensões que ficavam fixadas em vazio dos dois lados — sequência de
  ferramentas e contabilidade de tokens — passaram a ser lidas do modo de
  eventos de cada harness e traduzidas do dialeto de cada um: o formato divergir
  não é o defeito que o NFR-6 quer pegar, o contrato observável divergir é. As
  cinco dimensões são comparadas de fato.

  A comparação completa exige um gateway e o harness de referência; quando não
  estão configurados, [`scripts/parity-gate.sh`](scripts/parity-gate.sh) diz
  isso em voz alta em vez de passar em silêncio. O que continua travado nesse
  caso é que o próprio harness ainda detecta divergência, provado por testes que
  o alimentam com dois harnesses que deixam o disco, o código de saída e a
  sequência de ferramentas diferentes. O crate declarava recusar o antipadrão do
  harness que não pode falhar; agora há o que sustente a declaração.

- **Compactação sob pressão real.** `ApiError::is_context_overflow` reconhecia
  as duas formas de estouro e `compact` sabia cortar sem separar um `tool_use`
  do resultado dele, e nada ligava os dois. Agora um estouro de janela compacta
  o histórico e repete o turno em vez de abortar a tarefa no meio. O gatilho é o
  erro do gateway e não um palpite sobre tamanho; a tarefa original sobrevive ao
  corte, porque perdê-la faria o agente esquecer o que estava fazendo. Um
  histórico já no mínimo devolve o erro ao usuário em vez de tentar de novo, e o
  teto de duas compactações por pedido garante que um gateway respondendo
  estouro a tudo não faça o agente compactar até esquecer a tarefa.

  O `Observer` ganhou `on_notice`, e o aviso aparece mesmo em modo silencioso:
  compactar muda o que o modelo lembra, e sem o aviso o usuário fica sem
  explicação para um esquecimento.

- **FR-6 — o catálogo de modelos passou a ser consultado.** `catalog::fetch`
  existia, era testado e nunca era chamado; agora o `GET /v1/models` do próprio
  endpoint decide o que é um modelo válido. Um nome que o endpoint não serve é
  recusado antes de gastar um turno, com a lista do que existe — quase sempre é
  erro de digitação, e a alternativa era uma recusa do gateway três camadas
  adiante.

  O resultado fica em `.nycode/catalog.json` por seis horas, chaveado pela URL
  base: consultar a cada execução poria uma ida à rede no caminho de startup que
  o NFR-1 mede, e servir o catálogo de um gateway para outro faria o usuário
  escolher um modelo que o endpoint atual não tem. A validação só acontece
  contra um catálogo efetivamente obtido — recusar com base num cache vencido ou
  num gateway fora do ar transformaria indisponibilidade em erro de uso, e a
  indisponibilidade é dita em `stderr` em vez de passar em silêncio.

- **MCP fala o protocolo de verdade (FR-7, primeiro mecanismo).** O crate novo
  `nycode-mcp` implementa o trait `Transport` que o agente já esperava, sobre o
  SDK oficial `rmcp`
  ([ADR-0004](docs/architecture/decisions/0004-cliente-mcp-usa-o-sdk-oficial-rmcp.md)),
  com transporte stdio por processo filho e Streamable HTTP. A descoberta de
  `.mcp.json` — que existia, era testada e nunca era chamada — passou a rodar no
  startup, e as ferramentas dos servidores entram no catálogo com nome
  qualificado. `ServerConfig` ganhou `url` ao lado de `command`, mantendo o
  formato que os outros harnesses já gravam.

  Um servidor que não sobe vira aviso em `stderr` e a sessão segue: a
  alternativa transformaria toda extensão opcional em dependência obrigatória.
  Um resultado que o servidor marca como erro chega ao modelo marcado como erro,
  e uma resposta sem bloco de texto cai para o conteúdo estruturado em vez de
  virar resposta vazia.

  O protocolo é exercitado de verdade nos testes, contra um servidor MCP em
  processo ligado por canais em memória — handshake, `tools/list`, `tools/call`,
  recusa do servidor e erro de protocolo. Depender de ter um servidor instalado
  na máquina teria deixado justamente essa camada sem teste.

- **FR-1 — sessão interativa.** `nycode` num repositório agora abre uma sessão
  em vez de sair com código 2. O crate `nycode-tui`, que existia pronto e sem
  nenhum arquivo `.rs` que o referenciasse, ganhou o que faltava para ser usável:
  editor multilinha com histórico navegável e rascunho preservado, tradução de
  teclas isolada em `keys`, layout que conta células e não caracteres — um
  ideograma ocupa duas colunas —, e cabeçalho e rodapé em `panel`. O rodapé
  mostra tokens, taxa de acerto de cache e custo acumulado, e marca contagem
  estimada como estimada. O `Outcome` do agente passou a carregar o usage somado
  de todos os turnos do pedido, porque reportar só o último esconderia a maior
  parte da conta justamente nos pedidos com ferramenta.

  O modelo é o do scrollback e não o de tela alternativa
  ([ADR-0008](docs/architecture/decisions/0008-a-tui-usa-o-renderizador-proprio-sobre-o-scrollback.md)):
  rolagem, busca e cópia continuam sendo do emulador. Todo desenho vai em saída
  sincronizada, sem a qual o redesenho diferencial troca flicker de quadro
  inteiro por flicker de linha.

  Pedir sessão interativa sem terminal — `echo x | nycode` — é recusado com
  código 2 em vez de pendurar num prompt que ninguém pode responder.

  O laço não conhece o terminal: superfície e agente entram por trait, e a
  ligação com o TTY vive em `screen`. Foi o que permitiu cobrir a sessão inteira
  sem TTY e sem rede, e manter a tabela de exemptions vazia — a resposta que o
  [ADR-0003](docs/architecture/decisions/0003-pisos-de-cobertura-95-agregado-90-por-arquivo.md)
  exige quando um arquivo não alcança o piso é abrir costura, não dispensar o
  arquivo.

- **FR-4 — cancelamento de verdade.** `Ctrl+C` interrompe o turno em vez de
  matar o processo, e a sessão guarda o que já aconteceu. O trabalho difícil não
  era parar o stream, que é um drop: era fechar o que o turno abriu. O backend
  rejeita uma conversa em que um bloco `tool_use` não tem `tool_result`, então
  cancelar no meio de uma rodada precisa responder por toda chamada que não
  rodou — e o motivo chega ao modelo marcado como falha, porque "não executou" é
  diferente de "executou e não devolveu nada". Estourar o teto de iterações
  deixava a mesma pendência e passou a fechar do mesmo jeito. Um turno cancelado
  sai com 130, a convenção de shell para `SIGINT`; uma falha de wire continua
  não gravando nada, porque aconteceu antes de qualquer efeito no disco.

- **Emenda de escopo na [spec](.specs/nycode-rs/spec.md): FR-11 a FR-20 e
  NFR-7.** Confinamento do shell pelo sistema operacional, três modos de saída,
  slash commands, sessão em árvore, subagentes, hooks, plan mode, enfileiramento
  e direcionamento de mensagem, troca de modelo mid-session e entrada de imagem;
  mais estabilidade de prefixo para que o cache de prompt acerte. FR-3 passou a
  incluir o conjunto somente-leitura de busca e listagem, que o gate de permissão
  já nomeava sem que existisse.
- **RECON que fundamenta a emenda**, em
  [`research-sota-2026.md`](.specs/nycode-rs/research-sota-2026.md), com o
  material bruto em [`sources/`](sources/README.md).
- **Seis ADRs**: [0004](docs/architecture/decisions/0004-cliente-mcp-usa-o-sdk-oficial-rmcp.md)
  cliente MCP pelo SDK oficial `rmcp`;
  [0005](docs/architecture/decisions/0005-sandbox-de-so-por-processo-auxiliar.md)
  confinamento aplicado ao processo filho, sob a restrição de `unsafe_code =
  "forbid"`; [0006](docs/architecture/decisions/0006-a-sessao-e-uma-arvore-no-mesmo-arquivo.md)
  sessão em árvore preservando o append-only;
  [0007](docs/architecture/decisions/0007-subagentes-sao-in-process-divergindo-da-referencia.md)
  subagentes in-process, divergência registrada da referência;
  [0008](docs/architecture/decisions/0008-a-tui-usa-o-renderizador-proprio-sobre-o-scrollback.md)
  TUI sobre o scrollback, sem alt-screen;
  [0009](docs/architecture/decisions/0009-hooks-sao-executaveis-com-contrato-json.md)
  hooks como executáveis com contrato JSON e direito de veto.

- Baseline de documentação guiada por spec: [`docs/INDEX.md`](docs/INDEX.md),
  [`PRD.md`](PRD.md), [`ARCHITECTURE.md`](docs/architecture/ARCHITECTURE.md),
  [`REQUIREMENTS.md`](docs/requirements/REQUIREMENTS.md),
  [`ROADMAP.md`](docs/product/ROADMAP.md), índice e modelo de ADR, e modelo de spec.
- `AGENTS.md` na raiz, tornando as regras do repositório vinculantes para
  contribuidores agentes — e dogfooding do FR-8, que diz que o `nycode` lê esse
  arquivo.
- [ADR-0003](docs/architecture/decisions/0003-pisos-de-cobertura-95-agregado-90-por-arquivo.md):
  pisos de cobertura de 95% agregado e 90% por arquivo de produção.
- Cobertura das superfícies que antes não tinham teste: `impl Observer` e
  `finish` em `nycode-cli`, `impl Debug`, `with_message` e o roteamento de
  reasoning delta em `nycode-agent`, e `resolve_session` em `nycode-cli`.

### Alterado

- **Três buracos que abriam em silêncio nos gates foram fechados.** O NFR-2
  passava quando `/usr/bin/time` faltava — que é pacote separado no Debian e no
  Ubuntu e não vem na imagem do CI —, então o orçamento de memória podia estar
  sem gate nenhum sem que nada indicasse isso; agora falha fechado, com
  `PERF_ALLOW_NO_RSS=1` para tornar a dispensa explícita, e o job instala o
  pacote. A verificação de auto-contenção do NFR-3 pulava o alvo
  `aarch64-unknown-linux-gnu`, que na verdade compila num runner ARM nativo e
  podia ser verificado como os outros. E a cobertura contava como produção os
  arquivos que só existem para os testes, o que media o esforço de teste em vez
  do que ele protege — o gate agora exclui `*_test.rs`, `tests.rs` e `fakes.rs`
  do agregado e do piso por arquivo, e a limitação restante, os `mod tests`
  embutidos, está documentada em vez de escondida.
- **Política de dependências em [`deny.toml`](deny.toml), no job
  `supply-chain`.** Um aviso de segurança ou uma licença copyleft na árvore é um
  defeito que nenhum teste pega. `CDLA-Permissive-2.0` está na lista permitida
  com a razão: é licença de dados, cobre o bundle de certificados raiz que o
  rustls carrega, e não impõe obrigação sobre a distribuição do binário.
- **O produto passa a se chamar NyCode CLI e o repositório, `nycode-cli`.** O
  nome de exibição vale para títulos e prosa de documentação; o binário, as
  crates e as variáveis de ambiente continuam `nycode` e `NYCODE_*`, e nada que
  se refira ao `nylla-gateway` — header, IDs de modelo, `NYLLA_API_KEY` — foi
  tocado, porque o gateway é outro produto.
- **Pisos de cobertura elevados de 90%/80% para 95%/90%** em
  [`scripts/coverage-gate.sh`](scripts/coverage-gate.sh), com NFR-5 da
  [spec](.specs/nycode-rs/spec.md) atualizado. A tabela de exemptions segue vazia.
- `observer::Stdout` passou a ser genérico sobre os destinos de saída e de
  progresso. `Stdout::new(quiet)` mantém o comportamento anterior; a costura
  existe para que a apresentação seja verificável sem terminal.

### Corrigido

- **FR-4, FR-6 e FR-7 deixaram de ser declarados entregues.** Os três estavam
  marcados assim em [`REQUIREMENTS.md`](docs/requirements/REQUIREMENTS.md),
  [`PRD.md`](PRD.md) e [`README.md`](README.md) enquanto o código correspondente
  nunca era chamado pelo binário: não há handler de sinal e `Error::Cancelled`
  nunca é construído; `catalog::fetch` existe e nunca é invocado; `mcp::discover`
  e `McpTool` só rodam dentro dos próprios testes, o trait `Transport` não tem
  implementação real, e hooks não existiam em nenhuma forma. Cobertura de 98,6%
  não pegou nada disso, porque a cobertura mede o que o teste chama, não o que a
  produção chama. É a mesma classe de defeito que o NFR-4 proíbe no wire,
  aplicada à própria documentação.
- **Link quebrado na spec.** O cabeçalho apontava o "COMO" para um `design.md`
  que nunca existiu no diretório; agora aponta para os ADRs e a arquitetura.
- **NFR-2 dizia "30MB" na spec e "30 MiB" em todos os outros documentos.** A
  diferença é de 4,9% num número que a spec declara travado em CI. Padronizado
  em MiB, que é o que o gate mede.
- **A flag de retomada é `--continue`, como sempre esteve documentado.** O nome
  longo era derivado do campo `continue_session`, o que produzia
  `--continue-session` — uma interface que nenhum documento descrevia e que
  nenhum teste exercitava. O primeiro teste de `resolve_session` a encontrou.
