# Tarefas — AGT-07

- [x] T-01 Fixture unsigned/expired/foreign.
- [x] T-02 MAC+TTL no load.
- [x] T-03 Matriz FR-33; nota em ADR-0006.

## Evidência TDD

- RED: `cargo test -p nycode-agent an_unsigned_record_is_rejected_instead_of_becoming_an_empty_session`
  falhou porque `load` devolvia uma sessão vazia.
- GREEN: o mesmo teste passou após a admissão MAC; a suíte `cargo test -p
  nycode-agent --all-features` passou com 632 testes e
  `scripts/verify-all --full` terminou verde.
- Lacuna deliberada: concorrência de append e guards de filesystem ficam nas
  slices seguintes.
