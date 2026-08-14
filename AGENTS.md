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
| `cargo deny check` no `ci-local.sh` | parte de `GATE-13` | Cobre licença e CVE conhecida; não cobre idade mínima de dependência (`SP-04`) |
| Não negociáveis de código (seção acima) | análogo a `SEC-11` | Satisfeito, mais estrito |
| NFR-8, segurança antes de performance | filosofia fail-closed do padrão | Sem ID específico |

### O que ainda não tem instrumento

Sem gate automatizado hoje — cada um citado no roadmap
([`docs/product/ROADMAP.md`](docs/product/ROADMAP.md)) com o ID que fecha:
cobertura de diff (`GATE-01`), mutation score por crate (`GATE-04`),
complexidade cognitiva e ciclomática por função (`GATE-05`, `GATE-06`), teto
de 500 linhas por arquivo (`GATE-07`), duplicação (`GATE-08`), tamanho de PR
de agente (`GATE-11`), idade mínima de dependência nova (`SP-04`), trilha
test-first automatizada (`GATE-16`), fronteira de import entre crates
(`GATE-15`), e `test_map` gerado (`AI-10`).

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
scripts/perf-gate-test.sh
scripts/layout-gate.sh
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
