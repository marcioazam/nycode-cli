# Design — AGT-07

HMAC-SHA256 + TTL em `session/store/mac.rs`. A chave é criada com entropia do
sistema, armazenada com permissões restritas e vinculada ao workspace pai do
diretório de sessões.

Registros novos são assinados sem o campo `mac` no payload. Na leitura, a
admissão exige MAC, rejeita timestamps futuros ou além do TTL e verifica a
assinatura constante no workspace atual. Um registro legado sem MAC falha
explicitamente; não há degradação para sessão vazia.

## Aprovação (SDD-04)

LGTM humano recebido nesta sessão antes da implementação.
