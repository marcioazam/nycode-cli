# Onboarding — NyCode CLI

Do clone ao primeiro teste passando. Alvo: 10 minutos (`OB-04` do padrão
externo SOTA-2026) — **não cronometrado ainda com alguém de fora**, então é
meta declarada, não medição. A forma honesta de validar isto é fazer alguém
que nunca tocou o repositório rodar os passos abaixo do zero, não estimar
olhando para eles.

## Pré-requisitos

- Rust via [`rust-toolchain.toml`](../rust-toolchain.toml) — `rustup` resolve
  a versão pinada (`1.96.0`) automaticamente ao entrar no diretório.
- `git` 2.x.
- Linux ou macOS. (O confinamento do shell usa bubblewrap no Linux e Seatbelt
  no macOS — nenhum dos dois precisa de instalação manual para compilar e
  testar; só passa a valer em runtime.)

## Passos

```bash
git clone https://github.com/marcioazam/nycode-cli.git
cd nycode-cli

# Sem isto os gates existem no repositorio e nao valem no seu clone —
# scripts/ci-local.sh --check-hooks recusa em voz alta se voce esquecer.
git config core.hooksPath .githooks

cargo test --workspace --all-features
```

Se o `cargo test` passou, você está pronto para editar. Antes do primeiro
commit real, rode o nível rápido do CI local pelo menos uma vez para
confirmar que as ferramentas auxiliares (`actionlint`, `zizmor`, `pinact`,
`gitleaks`) também estão instaladas — o `pre-commit` vai exigi-las de
qualquer forma:

```bash
scripts/ci-local.sh --fast
```

## Onde ler antes de mudar algo

1. [`AGENTS.md`](../AGENTS.md) — as regras deste repositório, vinculantes.
2. [`docs/GLOSSARY.md`](GLOSSARY.md) — os termos, para não reinventar
   vocabulário que já existe.
3. [`docs/INDEX.md`](INDEX.md) — o mapa de onde cada coisa é decidida.
4. A [spec normativa](../.specs/nycode-rs/spec.md) — antes de qualquer
   comportamento novo, não depois.

## Primeira contribuição

Comportamento novo começa em spec ou spec de feature
([modelo](specs/SPEC_TEMPLATE.md)), segue teste-primeiro (RED, GREEN,
REFACTOR), e passa por `scripts/ci-local.sh --full` antes do push — o
`pre-push` já roda isso, então não há como esquecer. Ver
[`CONTRIBUTING.md`](../CONTRIBUTING.md) para o fluxo mecânico completo.

## Se algo aqui estiver desatualizado

Este documento não tem gate automatizado de atualidade. Se um passo falhar
exatamente como escrito, o defeito é deste arquivo — corrija-o na mesma
mudança que descobriu o problema, não depois.
