# Política de segurança

## Escopo

Este documento cobre o binário `nycode` e os crates deste workspace
(`crates/*`). Não cobre o [`nylla-gateway`](https://github.com/nylla/nylla-gateway),
que é outro repositório com sua própria política.

## Como reportar uma vulnerabilidade

Abra um [GitHub Security Advisory privado](https://github.com/marcioazam/nycode-cli/security/advisories/new)
neste repositório. Não abra uma issue pública para uma vulnerabilidade ainda
não corrigida — o advisory privado é o canal certo até existir um fix.

Inclua: versão afetada, passos para reproduzir, e o impacto que você já
verificou (não é preciso ir além do necessário para provar o problema).

## Tempo de resposta

Confirmação de recebimento em até 5 dias úteis. Prazo de correção segue a
severidade CVSS: 24h para 9.0+, 72h para 7.0+, 14 dias para 4.0+.

## Riscos já aceitos e documentados

A feature `subscription-oauth` é um risco aceito formalmente, fora do build
padrão e nunca alcançável transitivamente — ver [`NOTICE`](NOTICE) e
[ADR-0001](docs/architecture/decisions/0001-subscription-oauth-is-a-flagged-accepted-risk.md).
Reportar esse risco especificamente não é necessário; ele já está rastreado.

## Postura de dependências

Toda dependência nova passa por `cargo deny check` (licença e aviso de
segurança conhecido) antes de entrar no `Cargo.lock` — ver [`deny.toml`](deny.toml).
