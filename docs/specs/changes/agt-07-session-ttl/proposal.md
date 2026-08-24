# Proposta — AGT-07 memória de sessão

Parent: #70. Append-only (ADR-0006) permanece; a fronteira do modelo deve
falhar fechada quando a sessão não puder provar sua origem e integridade.

## Escopo

- Assinar registros novos com HMAC-SHA256 usando uma chave por workspace.
- Recusar registros sem MAC, expirados, futuros ou assinados para outro
  workspace.
- Preservar o arquivo append-only e não reescrever históricos existentes.

## Não-objetivos

- Migrar silenciosamente arquivos legados sem MAC.
- Alterar a estrutura de árvores de sessão.
- Implementar a concorrência de append ou os guards de filesystem desta slice.
