# Políticas de merge e tamanho

Os números dos tetos vivem nos `scripts/*-gate.sh` e no `GATES.md` do padrão
pinado. Este arquivo cita IDs; não os restata.

## Tamanho de PR assistido (`GATE-11`, `AI-01`)

O teto aplica-se a intervalo com `Assisted-by` no commit. O instrumento é
`scripts/agent-pr-size-gate.sh`, só no job `pr-size` do CI, contra a base
real do pull request. `Cargo.lock` e `test_map` não entram na contagem.
Decompor em vez de alargar o teto.

## Waiver com data (`GATE-14`)

Desvio de MUST precisa de linha em `scripts/waiver/registry.txt` e ADR com
os seis campos. `scripts/waiver/gate.sh` recusa data passada, ADR órfão e
lista `Waiver:` que não bate com o registro. Flake vai em
`scripts/flake-quarantine.txt`, hoje vazio.

## Agente não mergeia (`AI-03`)

Quem abriu o PR assistido não aprova nem mergeia o próprio PR. Identidade
de merge do agente não existe neste repo. Enquanto o dono humano for único,
`AI-03` e `GATE-17` ficam em waiver ([ADR-0037](../architecture/decisions/0037-gate-17-fica-em-waiver-enquanto-o-dono-humano-for-unico.md)).

## Code owners (`GATE-17`)

[`.github/CODEOWNERS`](../../.github/CODEOWNERS) lista caminhos críticos.
Não liga revisão obrigatória no GitHub para fingir segundo humano. O
instrumento compensatório é a lista mais os jobs exigidos (ADR-0034).

## Project

Project é vista, não fonte. Criar o Project “NyCode harness” exige
`gh auth` com scope `project`. Sem esse scope, a Issue de intake basta
([#70](https://github.com/marcioazam/nycode-cli/issues/70),
[#97](https://github.com/marcioazam/nycode-cli/issues/97)).
