# Proposta - AGT-07 guards de sessao

Parent: #70. A integridade do registro nao basta se o caminho de sessao puder
apontar para outro arquivo, se dois processos puderem escrever ao mesmo tempo
ou se um nome de sessao puder sobrescrever um destino escolhido pelo usuario.

## Escopo

- Validar ids antes de formar qualquer caminho de sessao.
- Recusar diretorio de sessoes que nao seja diretorio regular.
- Abrir arquivos de sessao sem seguir symlinks em plataformas Unix.
- Serializar append por sessao com lock exclusivo mantido durante tip e escrita.
- Ignorar symlinks e entradas nao regulares ao listar sessoes.
- Ler e gravar arquivos `.name` sem seguir symlinks.
- Manter import/fork com destino novo e remover copias parciais em erro.

## Nao-objetivos

- Alterar o formato JSONL ou a regra de MAC/TTL da slice anterior.
- Resolver sincronizacao entre maquinas ou locks distribuídos.
- Migrar arquivos legados sem MAC.
- Reescrever historicos existentes.
