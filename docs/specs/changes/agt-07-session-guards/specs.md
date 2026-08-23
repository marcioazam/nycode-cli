# Delta - AGT-07 guards de sessao

## ADDED

- REQ-AGT07-GUARD-001: ids vazios, longos demais ou fora de
  `[A-Za-z0-9_-]` sao recusados antes de formar caminhos.
- REQ-AGT07-GUARD-002: `Store::open` falha se o caminho de sessoes nao for um
  diretorio regular.
- REQ-AGT07-GUARD-003: leitura e append de uma sessao Unix nao seguem symlink.
- REQ-AGT07-GUARD-004: append concorrente da mesma sessao e serializado por
  lock exclusivo que cobre descoberta da ponta e escrita.
- REQ-AGT07-GUARD-005: listagem ignora entradas `.jsonl` que sejam symlink ou
  nao sejam arquivos regulares.
- REQ-AGT07-GUARD-006: leitura e gravacao de `{id}.name` nao seguem symlink e
  nao alteram o destino apontado.
- REQ-AGT07-GUARD-007: import e fork criam o destino com `create_new` e
  removem o destino parcial quando a copia ou validacao falha.

## Nao alterado

- Registros continuam append-only, assinados com a chave do workspace e
  rejeitados quando falham MAC ou TTL.
- A estrutura da arvore e a selecao do caminho ativo permanecem iguais.

## Aprovacao (SDD-02)

LGTM humano recebido nesta sessao antes da implementacao.
