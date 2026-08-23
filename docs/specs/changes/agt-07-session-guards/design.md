# Design - AGT-07 guards de sessao

## Fronteira

`crates/nycode-agent/src/session/store/guard.rs` concentra a validacao de id,
lock por sessao e abertura protegida dos arquivos JSONL. `Store` continua sendo
a fronteira publica e chama os guards antes de qualquer I/O dependente do id.
`crates/nycode-cli/src/session/open.rs` usa as mesmas regras para nomes,
fork/import e destinos novos.

## Decisoes

- No Unix, `openat` com `NOFOLLOW` abre o arquivo relativo ao diretorio pai;
  assim uma entrada symlink nao redireciona leitura, append ou nome para fora
  do workspace. Em outras plataformas, o comportamento suportado pela
  biblioteca permanece o fallback existente.
- O lock usa arquivo lateral `{id}.lock` e lock exclusivo do sistema. Ele fica
  vivo ate o fim de `append` ou `append_child`, incluindo a descoberta da ponta,
  para que dois processos nao escolham o mesmo pai.
- O cursor em memoria guarda tambem o tamanho observado do arquivo. Se outro
  processo escreveu depois, o cursor deixa de ser confiavel e a proxima
  operacao relê a sessao.
- `list` usa `symlink_metadata`, nao `metadata`, para que symlink nao seja
  confundido com arquivo regular.
- Arquivos `.name` sao abertos com `NOFOLLOW`, `0600` e `sync_all`; leitura de
  symlink falha fechada e nao e tratada como nome vazio durante gravacao.

## Riscos aceitos

- O lock e local ao host e nao protege um filesystem sem semantica de flock.
- O fallback nao-Unix nao promete a mesma resistencia a symlink; os testes
  especificos de symlink sao condicionados a Unix.

## Aprovacao (SDD-04)

LGTM humano recebido nesta sessao antes da implementacao.
