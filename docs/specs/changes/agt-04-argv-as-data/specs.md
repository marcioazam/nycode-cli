# Delta — AGT-04 argv-as-data

Pesquisa: [../sota-2026-onda2-instruments/research.md](../sota-2026-onda2-instruments/research.md).
Parent: #70.

## ADDED

- REQ-AGT04-001: O schema da ferramenta de processo aceita só `argv: string[]`
  (`minItems: 1`). Campo `command` recusa no coerce, sem spawn.
- REQ-AGT04-002: O host faz `Command::new(argv[0]).args(&argv[1..])`. Não
  interpola, não envolve `bash -c` por conta própria.
- REQ-AGT04-003: `argv` que é interpretador + `-c`/`-lc` recusa fechado.
- REQ-AGT04-004: Metacaracteres em um slot de argv são dados, não shell.

## MODIFIED

- Contrato da tool `bash` (`command: string`) → `argv`.
  Reason: FR-30 / AGT-04. Nenhum ref permitido já faz isto; copiar `bash -c`
  deixaria o ID em waiver.

## REMOVED

- Nenhum.

## Aprovação (SDD-02)

Pendente LGTM humano.
