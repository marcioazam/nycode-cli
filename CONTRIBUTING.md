# Como contribuir

As regras — arquitetura, gates, segurança, estilo — vivem em
[`AGENTS.md`](AGENTS.md) e valem para qualquer contribuidor, humano ou agente.
Este arquivo não as repete; cobre só o mecânico de abrir uma mudança.

## Antes do primeiro commit

```bash
git config core.hooksPath .githooks
```

Um clone sem isso não tem gate nenhum e parece ter —
`scripts/ci-local.sh --check-hooks` recusa em voz alta quando falta.

## Fluxo

1. Comportamento novo começa em spec ou ADR — ver "Documento antes de código"
   em [`AGENTS.md`](AGENTS.md).
2. Implementação em ciclo teste-primeiro: RED, GREEN, REFACTOR.
3. `scripts/ci-local.sh --fast` a cada commit (o `pre-commit` já roda),
   `scripts/ci-local.sh --full` antes do push (os hooks `pre-merge-commit` e
   `pre-push` já rodam).
4. Abra o PR. [`.github/CODEOWNERS`](.github/CODEOWNERS) lista caminhos
   críticos e o dono humano. A proteção de `main` exige os checks verdes,
   não review de CODEOWNERS ([ADR-0034](docs/architecture/decisions/0034-protecao-de-branch-exige-ci-verde-sem-aprovacao-separada.md);
   `GATE-17` em waiver, [ADR-0037](docs/architecture/decisions/0037-gate-17-fica-em-waiver-enquanto-o-dono-humano-for-unico.md)).

## Commits

Rodapé `Assisted-by: <agente>:<modelo>` em todo commit com assistência de IA —
ver a seção "Estilo" do [`AGENTS.md`](AGENTS.md) para o porquê.
