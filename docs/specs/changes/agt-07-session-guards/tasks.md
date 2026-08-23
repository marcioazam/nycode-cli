# Tarefas - AGT-07 guards de sessao

- [x] T-01: teste RED para ids invalidos e diretorio de sessoes nao regular.
- [x] T-02: teste RED para leitura/append/listagem sem seguir symlink.
- [x] T-03: teste RED para lock e cursor invalidado por escrita externa.
- [x] T-04: teste RED para `.name` protegido e limpeza de import/fork parcial.
- [x] T-05: implementar guards pequenos e integrar `Store`.
- [x] T-06: integrar guards de nome, fork e import no CLI.
- [x] T-07: executar suite, coverage, mutation e `scripts/verify-all --full`.
- [ ] T-08: revisar em contexto independente e abrir PR.

## Evidencia TDD

RED: `cargo test -p nycode-agent session::store::tests:: --all-features`
falhou nos cinco comportamentos novos antes dos guards: id invalido, diretorio
symlink, append symlink, listagem symlink e cursor stale.

GREEN: os testes de Store passaram com 46 testes; os testes de abertura CLI
passaram com 8 testes. `cargo clippy --workspace --all-targets --all-features`
e `scripts/coverage-gate.sh coverage.json` passaram. Depois dos testes de
erro do guard, `scripts/verify-all --full` terminou com:
`Cobertura agregada de producao: 97.6379%` e `ci-local: verde no nivel completo.`

Lacuna restante: revisao independente e abertura da PR.
