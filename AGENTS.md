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
  diff de PR.

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

## Antes de dizer que terminou

Na ordem, com a saída verificada e não presumida. Segurança antes de performance
também aqui: `cargo deny` roda antes do gate de performance, como o `needs:` do
CI impõe (NFR-8).

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features
cargo test --workspace --all-features
cargo deny check
scripts/coverage-gate-test.sh
cargo llvm-cov --workspace --all-features --json --output-path coverage.json
scripts/coverage-gate.sh coverage.json
cargo build --release
scripts/perf-gate-test.sh
scripts/perf-gate.sh
```

## Estilo

Português nos comentários, na documentação e nas mensagens ao usuário. Nomes de
teste em inglês, descrevendo o comportamento protegido e não o método exercitado
— o padrão do repositório é
`a_tool_failure_is_marked_as_an_error_for_the_model`, não `test_execute`. Um
comentário explica a restrição que o código não consegue mostrar; nunca narra o
que a linha seguinte faz.
