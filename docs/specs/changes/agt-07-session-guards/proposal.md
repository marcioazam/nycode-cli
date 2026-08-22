# Proposta — AGT-07 guards de sessão

Parent: `agt-07-session-ttl`. O MAC protege a origem do conteúdo, mas o store
continua podendo seguir um symlink, aceitar ids que escapam do diretório e
perder a ponta quando duas instâncias escrevem a mesma sessão.

## Escopo

- Validar ids antes de formar qualquer caminho de sessão.
- Abrir arquivos de sessão sem seguir symlinks.
- Serializar append concorrente por sessão com lock do sistema.
- Invalidar a ponta em cache quando outra instância alterar o tamanho do arquivo.

## Não-objetivos

- Alterar o formato JSONL ou a política de MAC/TTL.
- Implementar poda ou compactação física de ramos.
- Fazer migração silenciosa de arquivos legados.
