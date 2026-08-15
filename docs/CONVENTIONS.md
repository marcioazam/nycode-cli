# Convenções de nomenclatura e organização

Este documento não inventa convenção nova — descreve a que já é praticada
neste repositório, pra ficar explícita em vez de conhecimento tribal. Toda
contagem abaixo foi verificada contra o código real no momento em que este
documento foi escrito (2026-08-14), não citada de memória.

## Módulo com filhos: `foo.rs` + `foo/`

Quando um módulo Rust ganha submódulos, o idioma deste repositório é manter
o arquivo do módulo pai (`foo.rs`) ao lado do diretório dos filhos (`foo/`),
em vez de mover tudo para `foo/mod.rs`. Confirmado em 11 pares reais no
workspace, incluindo aninhamento (um par pode existir dentro de outro):

- `crates/nycode-agent/src/agent.rs` + `agent/`
- `crates/nycode-agent/src/tools/bash.rs` + `tools/bash/`
- `crates/nycode-agent/src/policy/confinement.rs` + `confinement/`, que por
  sua vez contém `confinement/process.rs` + `confinement/process/` e
  `confinement/sandbox.rs` + `confinement/sandbox/`
- `crates/nycode-agent/src/session/store.rs` + `session/store/`
- `crates/nycode-cli/src/interactive.rs` + `interactive/`
- `crates/nycode-cli/src/screen.rs` + `screen/`

`foo/mod.rs` também é aceito quando não há um `foo.rs` de conteúdo próprio
para manter ao lado — a regra não é "nunca `mod.rs`", é "não duplique a
decisão quando o par já existe".

## Arquivo de teste

Três formas coexistem, cada uma com escopo diferente — nenhuma substitui as
outras (ver `test_map`, gerado por `scripts/gen-test-map.sh`, pra o
inventário completo por crate):

- **Inline, `#[cfg(test)] mod tests` no mesmo arquivo da implementação.**
  Dominante: 110 arquivos em `crates/` no momento em que este documento foi
  escrito. É o padrão-padrão — comece aqui a menos que haja razão pra um dos
  outros dois.
- **Arquivo dedicado, `<nome>_test.rs` ou `<nome>_tests.rs`.** Minoria (9
  arquivos, ex.: `crates/nycode-agent/src/agent_test.rs`,
  `crates/nycode-cli/src/screen/screen_test.rs`), usado quando a suíte é
  grande o bastante pra atrapalhar a leitura do arquivo de implementação, ou
  quando módulos de fixture são compartilhados entre vários arquivos de
  teste (`agent_test.rs` serve `outcome_test.rs` e `compaction_test.rs`,
  por exemplo — por isso `test_map` não tenta mapear arquivo-fonte para
  teste específico, seria falso nesses casos). Reconhecido como teste por
  `is_production()` em `scripts/diff-coverage-gate.sh:36-38`, junto com
  `tests.rs` e `fakes.rs`.
- **Integração, em `tests/`.** Testa o binário como um processo externo
  chamaria, não a API interna do crate.

## Script de gate: `<nome>-gate.sh` + `<nome>-gate-test.sh`

Todo gate de CI deste repositório é um script em `scripts/`, nomeado
`<área>-gate.sh`, com uma bateria de teste dedicada `<área>-gate-test.sh`
rodada **antes** do gate em qualquer sequência de CI (`ci-local.sh --full`
e `ci.yml` — "os auto-testes dos gates vêm antes dos gates: um gate quebrado
que aprova é pior que um gate que reprova, porque não deixa rastro").
Confirmado: 11 dos 12 gates em `scripts/` seguem o par exato; a exceção é
`parity-gate.sh`, que depende de um harness externo e por isso não tem uma
bateria sintética equivalente.

Gates que precisam separar lógica pura (testável sem ferramenta externa) da
execução real usam o mesmo sinalizador de sourcing:

```bash
if [[ "${1:-}" == "--source-only" ]]; then
  return 0 2>/dev/null || exit 0
fi
```

visto em `scripts/mutation-gate.sh`, `scripts/dependency-age-gate.sh`,
`scripts/diff-coverage-gate.sh` e `scripts/complexity-gate.sh` — o teste
faz `source` do script real com essa flag e chama as funções puras
diretamente, sem duplicar a lógica de decisão num segundo lugar.

## Nome de documento

- **Maiúsculo, na raiz de `docs/`**, para documento transversal que não
  pertence a uma árvore estruturada: `GLOSSARY.md`, `THREAT_MODEL.md`,
  `RUNBOOK.md`, `ONBOARDING.md`, `SLO.md`, `CONVENTIONS.md` (este arquivo).
- **Minúsculo, dentro de árvore com propósito próprio**:
  `architecture/ARCHITECTURE.md` é exceção deliberada (maiúsculo mesmo
  dentro de árvore, porque é o documento âncora daquela árvore);
  `product/ROADMAP.md` idem. `architecture/decisions/NNNN-titulo.md` e
  `specs/NNN-slug/spec.md` seguem o padrão de numeração das seções abaixo,
  não maiúsculo/minúsculo simples.
- **ADR**: `NNNN-título-curto-em-kebab-case.md`, numeração sequencial de
  4 dígitos, nunca reaproveitada mesmo se um ADR for descontinuado
  (`docs/architecture/decisions/README.md` mantém o índice).
- **Spec de feature**: `docs/specs/NNN-slug-em-kebab-case/`, 3 dígitos —
  distinto da numeração de 4 dígitos dos ADRs porque são namespaces
  diferentes (feature vs. decisão).

## Nome vago é sinal de parada

Já registrado em `AGENTS.md`, seção "Layout — teto de sete arquivos por
diretório", e vale para nomenclatura de qualquer coisa, não só diretório:
se o único nome que serve é `utils`, `helpers`, `misc`, `common`, `core`,
`shared` ou `base`, o nome ainda não foi encontrado — pare e peça decisão de
arquitetura em vez de esconder o problema numa gaveta. Não repetido aqui em
detalhe para não divergir; esta seção só aponta pra lá.
