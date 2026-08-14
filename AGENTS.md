# AGENTS.md — regras deste repositório

Vinculante para qualquer contribuidor, humano ou agente. Onde este arquivo e a
[spec](.specs/nycode-rs/spec.md) divergirem, a spec vence.

## Proveniência — leia antes de qualquer coisa

**O código-fonte vazado do Claude Code e qualquer derivado dele — mirrors,
`claw-code`, forks "OpenClaude" — estão proibidos como referência, em qualquer
circunstância.** A proveniência não está resolvida, o material é alvo ativo de
DMCA, e alguns mirrors foram observados com malware. Consultá-lo contamina a
cadeia de proveniência deste repositório de forma irreversível.

Referências permitidas: `pi` (MIT), `grok-build` (Apache-2.0), `codex`
(Apache-2.0), `opencode` (MIT), `goose` (Apache-2.0), com as obrigações de
atribuição cumpridas no [`NOTICE`](NOTICE).

## Padrão externo — SOTA-2026 v1.1.0, nível L2

Padrão: SOTA-2026 v1.1.0 (`base-software-rules`, mantido fora deste
repositório). Nível de conformidade: **L2 (standard)** — o `CONFORMANCE.md`
do padrão define L2 como "qualquer serviço, biblioteca ou produto do qual
outra pessoa ou sistema dependa"; este repositório já publica release
([`release.yml`](.github/workflows/release.yml)) e documenta instalação no
`README.md` — não é protótipo (L1). Decisão registrada em
[ADR-0032](docs/architecture/decisions/0032-adota-padrao-externo-sota-2026-nivel-l2.md).

Este repositório não copia o texto do padrão: cita o ID da regra e diz onde
ela já está satisfeita ou onde ainda falta instrumento. Um número que
existisse em dois lugares seria, por definição, um dos dois já errado — o
mesmo princípio que este `AGENTS.md` já aplicava aos próprios gates antes de
o padrão externo existir.

### O que já satisfaz uma regra do padrão

| Regra deste `AGENTS.md` | ID do padrão | Nota |
|---|---|---|
| Cobertura de teste (seção acima) | `GATE-03` / `GATE-02` | Pisos idênticos aos do padrão |
| Layout — teto de arquivos por diretório (seção acima) | `ADV-01` | Mais rígido — o padrão só torna isso consultivo |
| Toda action fixada por SHA verificado (ADR-0030) | `SP-06` | Satisfeito |
| `gitleaks` no `ci-local.sh` (seção "CI local") | `GATE-12` | Satisfeito |
| `cargo deny check` no `ci-local.sh` | parte de `GATE-13` | Cobre licença e CVE conhecida |
| Não negociáveis de código (seção acima) | análogo a `SEC-11` | Satisfeito, mais estrito |
| NFR-8, segurança antes de performance | filosofia fail-closed do padrão | Sem ID específico |
| Teto de 500 linhas por arquivo, com ratchet (seção acima) | `GATE-07` / `ARCH-11` | Satisfeito desde 2026-08-14; `RAT-04` cobre o legado de 4 arquivos |
| Teto de PR assistido por IA (seção acima) | `GATE-11` / `AI-01` | Satisfeito desde 2026-08-14; só no CI, ver a exceção documentada em "CI local" |
| `test_map` gerado e citado aqui (seção acima) | `AI-10` | Satisfeito desde 2026-08-14; inventário por crate, não mapeamento 1:1 — ver a seção |
| Fronteira de arquitetura, allowlist do grafo de crates (seção acima) | `GATE-15` / `ARCH-04` / `ARCH-05` | Satisfeito desde 2026-08-14; fronteira de crate, não de módulo interno — ver a seção |
| Idade mínima de dependência nova (seção acima) | `SP-04` | Satisfeito desde 2026-08-14; só no CI, mesma exceção do teto de PR |
| Cobertura de diff (seção acima) | `GATE-01` | Satisfeito desde 2026-08-14; só no CI, piso de 80% |

### O que ainda não tem instrumento

Sem gate automatizado hoje — cada um citado no roadmap
([`docs/product/ROADMAP.md`](docs/product/ROADMAP.md)) com o ID que fecha:
mutation score por crate (`GATE-04`), complexidade cognitiva e ciclomática
por função (`GATE-05`, `GATE-06`), duplicação (`GATE-08`), e trilha
test-first automatizada (`GATE-16`).

### Waiver

Desvio de regra `MUST` do padrão exige waiver formal: ADR em
`docs/architecture/decisions/` com regra, escopo, razão, controle
compensatório, dono e expiração de no máximo dois trimestres — mesmo
mecanismo do `CONFORMANCE.md` do padrão. Vale para os gates que entrarem daqui
para frente.

**Não vale retroativamente para a cobertura**: a política deste repositório
de nunca abrir exemption `below-floor` (ver "Cobertura de teste" acima) é
decisão permanente, não uma exceção temporária — por isso não usa o mecanismo
de waiver, que por definição expira.

### Spec normativa fora do padrão de template

A spec vive em [`.specs/nycode-rs/spec.md`](.specs/nycode-rs/spec.md), não em
`docs/specs/`, como o template do padrão sugeriria. Desvio deliberado e
documentado: mover o arquivo quebraria os links relativos que 31 ADRs já
fazem para ele. `docs/specs/NNN-slug/` continua para spec de feature.

## Segurança primeiro, performance em segundo — NFR-8

Quando as duas se opõem e não há forma que atenda às duas, **a segurança define o
que é aceitável e a performance se acomoda ao que sobra**
([ADR-0011](docs/architecture/decisions/0011-seguranca-antes-de-performance.md)).
A regra existe porque os orçamentos de performance deixaram de ter folga: com 50x
de margem ninguém precisava escolher, com 4,4x precisa.

Uma regra de prioridade sem consequência é decoração, então esta tem quatro:

- **O número de performance vem do build padrão de release, com todo controle de
  segurança ativo.** Medir outro artefato é medir outro programa e reportar o
  número dele.
- **Controle de segurança que torna um orçamento inalcançável move o orçamento.**
  Nunca o contrário. O número medido que motivou entra no ADR junto.
- **A detecção de confinamento (FR-11) e a resolução de credencial (FR-10) não
  são adiadas nem puladas para caber no startup.** Adiar a detecção para o
  primeiro uso da ferramenta é a otimização mais óbvia contra o orçamento, e está
  fechada: FR-11 exige que a ausência de confinamento seja dita, e dizer depois
  de o usuário já ter decidido agir não é dizer.
- **Código que baixa artefato de terceiro verifica o digest antes de executar**,
  com o esperado fixado em arquivo versionado e a adoção de um novo passando por
  diff de PR. Vale para tarball ([`perf-baseline.txt`](scripts/perf-baseline.txt))
  e vale para action: toda `uses:` nos workflows é um SHA de 40 caracteres com
  comentário de versão verificado
  ([ADR-0030](docs/architecture/decisions/0030-toda-action-de-terceiro-e-fixada-por-sha-verificado.md)).
  Uma action é código de terceiro executado com um token do repositório — a
  mesma regra, na mesma fronteira.

No CI a precedência é literal: o job `perf` declara `needs: [supply-chain]`, então
o resultado de performance não é produzido enquanto a política de dependências não
passa. A ordem do bloco em "Antes de dizer que terminou" é a mesma.

## Cobertura de teste — NFR-5

Dois pisos, ambos duros, ambos falhando fechado
([ADR-0003](docs/architecture/decisions/0003-pisos-de-cobertura-95-agregado-90-por-arquivo.md)):

| Escopo | Piso |
|---|---|
| Agregado do workspace | **95,0%** de linhas |
| Cada arquivo em `crates/*/src/**` com linha instrumentada | **90,0%** de linhas |

```bash
cargo llvm-cov --workspace --all-features --json --output-path coverage.json
scripts/coverage-gate.sh coverage.json
```

Os pisos só alcançam o que o relatório contém, então o gate recusa antes deles um
relatório mais velho que qualquer fonte e um relatório que não menciona algum
arquivo de produção
([ADR-0010](docs/architecture/decisions/0010-o-gate-de-cobertura-exige-relatorio-completo-e-fresco.md)).
Editou código depois de medir? Meça de novo — ausência do relatório não é
aprovação.

Quatro consequências práticas:

- **Não abra exemption `below-floor` para passar no gate.** Ela dispensa código
  medido de alcançar o piso, e a tabela em
  [`scripts/coverage-exemptions.txt`](scripts/coverage-exemptions.txt) não tem
  nenhuma — a intenção é que continue. Escreva o teste que falha primeiro e veja
  se a linha ainda é necessária.
- **`no-statements` é outra coisa e não dispensa ninguém.** Declara um arquivo
  que o instrumentador não alcança — glue de módulo, código só derivado — para
  que ele não escape por ausência. Ratcheta: no dia em que ganhar uma linha
  instrumentada, a entrada reprova o gate e o piso de 90% passa a valer.
- **Código intestável é problema de desenho, não de teste.** Se um arquivo não
  alcança o piso porque fixa `std::io::stdout()`, chama o relógio direto ou abre
  socket no construtor, a resposta é abrir uma costura — parametrizar o destino,
  injetar a dependência — não dispensar o arquivo.
- **Cubra o comportamento, não a linha.** Um teste que executa a linha sem
  assertar o que ela produz satisfaz o gate e não protege nada.

## Não negociáveis de código

- `unsafe` é `forbid` no workspace.
- `unwrap`, `expect`, `panic!` e `todo!` são `deny` de clippy em caminho de
  produção. Um `unwrap` é uma decisão, não um atalho. Módulos de teste levam
  `#[allow(clippy::unwrap_used, clippy::panic)]`.
- Nada degradado em silêncio (NFR-4). Um erro in-band, um `stop_reason` fora do
  vocabulário ou um usage estimado chega ao usuário como o gateway o emitiu.
- `stdout` carrega só a resposta; progresso vai para `stderr`. Quebrar isso
  quebra o uso em pipe.
- A feature `subscription-oauth` não pode entrar no build padrão, nem
  transitivamente. O CI verifica
  ([ADR-0001](docs/architecture/decisions/0001-subscription-oauth-is-a-flagged-accepted-risk.md)).

## Performance — NFR-1, NFR-2, NFR-3

Dois pisos por métrica, ambos duros, ambos falhando fechado
([ADR-0012](docs/architecture/decisions/0012-performance-e-medida-contra-um-concorrente-nomeado.md)).
O absoluto pega regressão nossa; o relativo pega o concorrente passando na
frente. O que vale é o mais apertado dos dois.

São duas cargas, e elas não se substituem
([ADR-0013](docs/architecture/decisions/0013-o-gate-mede-a-sessao-montada-e-nao-o-version.md)).
A **sessão montada** é o que NFR-1 e NFR-2 descrevem — credencial, workspace,
índice de sessão, MCP — e é a carga que pega regressão em qualquer um deles. A
**chegada do processo** é `--version`, que o `clap` resolve antes de tudo isso;
ela fica porque é a única com par comparável no concorrente.

| Carga | Métrica | Piso absoluto | Piso relativo | Medido |
|---|---|---:|---|---:|
| Sessão montada | menor tempo | 15.000 µs | — | 3.880 µs |
| Sessão montada | RSS de pico | 14.336 KB | — | 10.572 KB |
| Chegada do processo | menor tempo | 3.000 µs | ÷ 3 | 558 µs |
| Chegada do processo | RSS de pico | 8.192 KB | ÷ 2 | 5.896 KB |
| Binário | tamanho | 16.777.216 B | ÷ 5 | 13.728.800 B |

O tempo comparado é o **menor** observado, não a mediana: num runner
compartilhado a mediana mede a contenção e o mínimo mede o programa. Os dois
lados do quociente usam o mesmo estimador — comparar nosso mínimo com a mediana
do concorrente inflaria a razão a nosso favor.

A sessão montada não tem piso relativo: o concorrente não expõe sonda
equivalente, e um piso relativo sem medição do outro lado seria ficção. Repare
que o RSS dela, 10.572 KB, já passa do piso de 8.192 KB da chegada — os dois
números medem coisas diferentes, e reaproveitar um no lugar do outro reprova
sem que nada tenha regredido.

```bash
cargo build --release
scripts/perf-gate-test.sh
scripts/perf-gate.sh
```

O baseline é o `codex-cli`, medido por este repositório com o método do próprio
gate e versionado em [`scripts/perf-baseline.txt`](scripts/perf-baseline.txt) com
versão, data e digest. Três coisas que decorrem disso:

- **Número de terceiro escolhe contra quem medir, nunca vira valor de gate.** As
  suítes públicas divergem de ~32ms a ~37,7ms para a mesma métrica e nenhuma
  publica a versão medida. O baseline daqui vem de medição própria.
- **Não edite o baseline à mão para passar no gate.** Quem o atualiza é o
  workflow agendado, que remede e abre PR. Um baseline afrouxado é o equivalente
  em performance de uma exemption `below-floor` aberta para fechar o CI.
- **A folga não é uniforme.** 21,8x em startup contra 4,4x em memória. Memória é
  onde há menos margem sobre o concorrente, e é por isso que o piso relativo de
  RSS é ÷2 e não ÷5.
- **Meça a sessão montada, não o atalho.** Um caminho que sai antes do runtime,
  do disco e do processo não pode regredir, e um gate que o mede não pode
  reprovar. Se um requisito ficar difícil de medir, abra a costura —
  `--probe-startup` é isso — em vez de medir o que estava à mão.

## Documento antes de código

- Comportamento novo começa na [spec](.specs/nycode-rs/spec.md) ou numa spec de
  feature a partir do [modelo](docs/specs/SPEC_TEMPLATE.md).
- Escolha significativa vira [ADR](docs/architecture/decisions/README.md) — com
  a alternativa descartada e o que a faria ser revista, não só o que foi feito.
- Mudança relevante entra no [`CHANGELOG.md`](CHANGELOG.md).
- O mapa completo está em [`docs/INDEX.md`](docs/INDEX.md).

## Layout — teto de sete arquivos por diretório

Um diretório de código comporta no máximo **sete** arquivos. Passou disso, divide
em subpastas **por responsabilidade**, nunca por tipo técnico: separar structs de
traits deixa o mesmo problema, só que espalhado.

O número não mede beleza. Mede quanto alguém precisa segurar na cabeça de uma vez
para saber onde mexer — e vale igual para quem lê o repositório pela primeira vez
e para um agente decidindo onde pôr o arquivo seguinte.

Um módulo com filhos tem **diretório e arquivo**: `foo.rs` mais `foo/` é o idioma
dominante daqui e satisfaz a regra; `foo/mod.rs` também. Arquivo de teste não
conta contra o teto — contá-lo puniria quem testa mais.

**Nome vago é sinal de parada, não opção.** Se o único nome que couber for `utils`,
`helpers`, `misc`, `common`, `core`, `shared` ou `base`, a divisão ainda não foi
encontrada: pare e reporte que aquele diretório precisa de decisão de arquitetura,
em vez de esconder o problema numa gaveta.

Gate: [`scripts/layout-gate.sh`](scripts/layout-gate.sh). Sem arquivo de exemption,
e isso é decisão — ele nasceu limpo, e a primeira exceção seria a que ensina que
existe exceção.

## Teto de 500 linhas por arquivo — `GATE-07`/`ARCH-11`

Um arquivo `.rs` comporta no máximo **500** linhas — vale igual para arquivo de
teste e de produção, porque o teto mede o quanto um agente consegue editar com
confiança de uma vez, não beleza. Diferente do teto de arquivos por diretório,
este gate nasceu **com ratchet** (`RAT-04`): quatro arquivos já excediam o teto
no dia em que o gate entrou, e têm entrada em
[`scripts/file-length-baseline.txt`](scripts/file-length-baseline.txt) com o
número de linhas daquele dia. Um arquivo do baseline não pode crescer além do
registrado, e a entrada cai sozinha — reprovando o gate — quando o arquivo
encolhe para dentro do teto ou some. Arquivo novo acima do teto não entra
sozinho no baseline: precisa de linha adicionada à mão, o que força revisão
humana antes de aceitar mais um arquivo grande.

Gate: [`scripts/file-length-gate.sh`](scripts/file-length-gate.sh).

## Teto de PR assistido por IA — `GATE-11`/`AI-01`

Um PR assistido por IA comporta no máximo **400 linhas alteradas** e **15
arquivos**. `Cargo.lock` não entra na contagem — é churn mecânico do `cargo`,
nunca escrito à mão.

Detecção mecânica de "assistido por IA": qualquer commit no intervalo com
rodapé `Assisted-by:` (ver "Estilo" abaixo) põe o intervalo inteiro sob o
teto — o lado conservador da regra, e o único jeito mecânico de decidir dado
que a maioria dos commits deste repositório já carrega o rodapé. PR
inteiramente humano cai em `ADV-02`, que é só consultivo.

Gate: [`scripts/agent-pr-size-gate.sh`](scripts/agent-pr-size-gate.sh), job
`pr-size` do CI — **só no CI**, nunca em `scripts/ci-local.sh --full` (ver a
exceção documentada na seção seguinte).

## Mapa de testes — `AI-10`

[`test_map`](test_map), na raiz, gerado e mantido em dia — consulte-o antes
de mexer num arquivo para saber onde procurar o teste que o protege. Ele
**não** mapeia arquivo-fonte para teste específico: este repositório tem
módulos de fixture compartilhados entre vários arquivos de teste
(`agent_test.rs` é usado por `outcome_test.rs` e `compaction_test.rs`, por
exemplo), então essa relação 1:1 seria falsa em vários casos reais — e um
mapa errado ensina a confiar onde não devia, o que é pior que nenhum mapa. O
que existe é o inventário honesto, por crate: onde vivem os testes inline,
os arquivos de teste dedicados e os testes de integração.

Gerado por [`scripts/gen-test-map.sh`](scripts/gen-test-map.sh) — **nunca
edite `test_map` à mão**. `scripts/gen-test-map.sh --check` reprova se o
arquivo commitado ficou desatualizado; roda em `scripts/ci-local.sh --full`
e no job `layout` do CI.

## Fronteira de arquitetura — `GATE-15`/`ARCH-04`/`ARCH-05`

O Cargo já recusa um ciclo de verdade — o que este gate cobre é diferente:
uma dependência nova entre crates, legal para o Cargo, mas que muda a
direção pretendida da arquitetura sem ninguém decidir isso explicitamente.
Cada crate deste workspace é um contexto delimitado (`ARCH-04`); não há
fatia mais fina que o Cargo exponha mecanicamente para checar, então a
fronteira aqui é de crate, não de módulo interno.

[`scripts/architecture-boundary-allowlist.txt`](scripts/architecture-boundary-allowlist.txt)
lista toda aresta permitida (`origem -> destino`). Uma dependência real sem
entrada na lista reprova — precisa de linha adicionada à mão, o que força
revisão antes de aceitar mais uma aresta. Uma entrada cuja dependência sumiu
do `Cargo.toml` também reprova: a lista descreve o grafo real, não aspiração
("uma fronteira que existe só em documentação não é fronteira", `ARCH-06`).

Gate: [`scripts/architecture-boundary-gate.sh`](scripts/architecture-boundary-gate.sh).

## Idade mínima de dependência — `SP-04`

Uma dependência **nova** — nome que não existia no `Cargo.lock` da base do
PR — precisa de pelo menos **30 dias** de existência verificada no
crates.io. Entre 4% e 6% dos pacotes sugeridos por modelo são alucinados
(`AI-11`), e um nome recém-criado no registro não teve tempo de ser
identificado como tal pela comunidade. Bump de versão de dependência já
confiada não conta — não é o risco que isto cobre. Crate interno deste
workspace também não conta.

Gate: [`scripts/dependency-age-gate.sh`](scripts/dependency-age-gate.sh), no
mesmo job `pr-size` do CI — **só no CI**, pela mesma razão do teto de PR
assistido por IA (a base certa de comparação só é conhecida dentro de um
pull request) mais uma segunda: verificar existência no registro é
`audit`, a exceção documentada a "sem rede em verificação".

## Cobertura de diff — `GATE-01`

Pelo menos **80%** das linhas de produção adicionadas ou modificadas por um
PR precisam estar cobertas. Diferente do piso agregado e do piso por
arquivo (NFR-5, seção acima), que medem o estado do mundo: um arquivo
grande e bem testado absorve, no agregado, o erro de arredondamento de uma
função nova sem teste nenhum. O diff mede exatamente o que o PR introduziu.

Construído sobre `cargo llvm-cov report --lcov`, que reaproveita os dados
de perfil já gerados pelo passo de cobertura no mesmo job — não roda os
testes de novo. Gate: [`scripts/diff-coverage-gate.sh`](scripts/diff-coverage-gate.sh),
no job `coverage` do CI, condicionado a `github.event_name == 'pull_request'`
— mesma razão das outras duas exceções abaixo: a base certa de comparação
só é conhecida dentro de um pull request.

## CI local — a definição única de verde

[`scripts/ci-local.sh`](scripts/ci-local.sh) é a definição, e o workflow do
GitHub roda os mesmos gates. Um CI remoto que diverge do local ensina a ignorar o
local, e aí o único sinal que sobra é o mais lento.

```bash
git config core.hooksPath .githooks   # uma vez por clone
scripts/ci-local.sh --fast            # ~1 min, roda no pre-commit
scripts/ci-local.sh --full            # a sequência inteira, exigida no merge
```

**Merge sem `--full` verde é proibido.** Os hooks em [`.githooks/`](.githooks/)
impõem isso: `pre-commit` roda o rápido, `pre-merge-commit` e `pre-push` rodam o
completo. O hook **executa** o CI — não confia em resultado anterior, porque um
verde de dez minutos atrás pode ser de outra árvore.

Um clone sem `core.hooksPath` ativo não tem gate nenhum e parece ter;
`scripts/ci-local.sh --check-hooks` recusa em voz alta quando esse é o caso.

**Três exceções documentadas:** os gates de "Teto de PR assistido por IA",
"Idade mínima de dependência" e "Cobertura de diff" (seções acima) rodam só
no CI, nunca em `--full`. A base certa de comparação é o alvo real do PR
(`github.base_ref`), que só é conhecido dentro de um pull request — pode não
ser `main` num PR empilhado sobre outro. Localmente não há como adivinhar
isso sem arriscar comparar contra a base errada, e um gate que compara
contra a base errada é pior que nenhum. O segundo tem um motivo a mais:
verificar existência no registro é rede, e `verify-all`/`--full` são
deliberadamente sem rede.

**O próprio workflow é auditado**, no nível rápido: `actionlint` (sintaxe e
`shellcheck` dos `run:`), `zizmor` (segurança — action não fixada, permissão
larga, credencial persistida), `pinact` (todo `uses:` é SHA verificado, ADR-0030)
e `gitleaks` (segredo commitado). Ferramenta ausente reprova com a linha de
instalação na mensagem — mesmo precedente do `perf-gate` sem `hyperfine`:
requisito sem medição é requisito sem gate.

## Antes de dizer que terminou

`scripts/ci-local.sh --full` é o comando, e a lista abaixo é o que ele roda — na
ordem, com a saída verificada e não presumida. Segurança antes de performance
também aqui: `cargo deny` roda antes do gate de performance, como o `needs:` do
CI impõe (NFR-8).

```bash
# verifica core.hooksPath == .githooks antes de qualquer trabalho real
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features
cargo test --workspace --all-features
actionlint
zizmor --no-progress --collect all --min-severity medium .
pinact run -fix=false -no-api
gitleaks detect --no-banner --redact --exit-code 1
cargo deny check
scripts/coverage-gate-test.sh
scripts/layout-gate-test.sh
scripts/file-length-gate-test.sh
scripts/gen-test-map-test.sh
scripts/architecture-boundary-gate-test.sh
scripts/perf-gate-test.sh
scripts/layout-gate.sh
scripts/file-length-gate.sh
scripts/gen-test-map.sh --check
scripts/architecture-boundary-gate.sh
cargo llvm-cov --workspace --all-features --json --output-path coverage.json
scripts/coverage-gate.sh coverage.json
cargo build --release
scripts/perf-gate.sh
scripts/parity-gate.sh
```

## Estilo

Português nos comentários, na documentação e nas mensagens ao usuário. Nomes de
teste em inglês, descrevendo o comportamento protegido e não o método exercitado
— o padrão do repositório é
`a_tool_failure_is_marked_as_an_error_for_the_model`, não `test_execute`. Um
comentário explica a restrição que o código não consegue mostrar; nunca narra o
que a linha seguinte faz.

Rodapé de commit assistido por IA: `Assisted-by: <agente>:<modelo>`, nunca
`Co-Authored-By`. O campo `Co-Authored-By` certifica autoria humana — usá-lo
para atribuição de máquina corrompe esse dado (`AI-09` do padrão externo
adotado acima). Pelo mesmo motivo, nenhum agente adiciona rodapé de sign-off:
só um humano certifica a origem de uma contribuição (`AI-08`). Vale para
commits novos; o histórico existente não é reescrito.
