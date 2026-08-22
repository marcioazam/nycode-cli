# Delta — AGT-07 guards de sessão

## ADDED

- REQ-AGT07-GUARD-001: ids vazios, maiores que 128 bytes ou com caracteres
  fora de ASCII alfanumérico, `-` e `_` são recusados antes do acesso ao disco.
- REQ-AGT07-GUARD-002: leitura e append de uma sessão recusam o alvo quando o
  caminho final é symlink; a listagem e os arquivos auxiliares de nome ignoram
  symlinks; o diretório de sessões também precisa ser um diretório regular;
  nenhum arquivo fora do diretório de sessões é lido ou alterado.
- REQ-AGT07-GUARD-003: append concorrente da mesma sessão é serializado por
  lock do sistema e preserva todos os registros.
- REQ-AGT07-GUARD-004: uma ponta em cache só é reutilizada enquanto o tamanho
  observado do arquivo permanece igual ao tamanho no momento do cache.

## UNCHANGED

- HMAC, TTL, workspace e admissão de registros permanecem os da slice anterior.
- O arquivo continua append-only e a árvore continua no mesmo JSONL.
