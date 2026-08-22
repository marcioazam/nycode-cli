# Tarefas — AGT-07 guards de sessão

- [x] T-01 Escrever RED para id inválido e symlink de leitura/escrita.
- [x] T-02 Escrever RED para duas instâncias preservarem a ponta concorrente.
- [x] T-03 Implementar guard, lock e cache de ponta com tamanho do arquivo.
- [x] T-04 Adaptar consumidores de `path_for` e atualizar `test_map`.
- [x] T-05 Rodar `scripts/verify-all --full` e revisão independente.

## Lacunas deliberadas

- Windows usa a abertura padrão do sistema; a proteção completa com
  `NOFOLLOW` é específica do Unix nesta slice.
- Lock distribuído entre máquinas não faz parte do store local.
