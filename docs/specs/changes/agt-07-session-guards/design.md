# Design — AGT-07 guards de sessão

`guard.rs` concentra validação de ids, lock por arquivo e abertura Unix com
`openat`/`NOFOLLOW`. `Store::records` usa a mesma abertura protegida para
leitura; `append_child` usa o lock antes de calcular a ponta e mantém o lock até
o `sync_all`.

`Store::list` usa metadados sem seguir symlinks e só expõe arquivos regulares,
para que uma entrada apontando para fora não influencie `latest`.

`Store::open` verifica o diretório com `symlink_metadata` antes de inicializar a
chave, recusando um alvo que não seja diretório regular.

O CLI aplica a mesma regra aos arquivos auxiliares `{id}.name` antes de ler ou
gravar o nome da sessão.

O cache guarda `(record_id, file_len)`. Se outra instância acrescentar bytes,
`remembered_tip` ignora a ponta antiga e relê o arquivo antes de escolher o
pai. O caminho público passa a devolver `Result<PathBuf>` para que toda
fronteira trate ids inválidos explicitamente.
