# Proposta: pin SOTA-2026 v1.4.0, harness de runtime e ledger GitHub

Issue: [#70](https://github.com/marcioazam/nycode-cli/issues/70).

## Por que

O repositório declara L2 contra SOTA-2026 **v1.1.0**, sem perfis e sem matriz.
O padrão está em **v1.4.0**: perfis (Núcleo, Autoria por agente, Produto
agente), harness portátil, deny no cliente, fluxo GitHub nativo. Sem o pin e
sem a matriz, “100% SOTA-2026” não é checável. O produto é um agente; omitir
Produto agente seria o segundo padrão já divergente.

## O que não muda

- Spec de produto em [`.specs/nycode-rs/spec.md`](../../../../.specs/nycode-rs/spec.md).
- Waiver `GATE-16` ([ADR-0033](../../../architecture/decisions/0033-gate-16-fica-sem-instrumento-conflito-com-hook-e-squash-merge.md)).
- Proteção de `main` com 12 checks e sem auto-aprovação como `GATE-17` verde
  ([ADR-0034](../../../architecture/decisions/0034-protecao-de-branch-exige-ci-verde-sem-aprovacao-separada.md)).
- Proibição de copiar texto de pilar para dentro deste repositório ([ADR-0032](../../../architecture/decisions/0032-adota-padrao-externo-sota-2026-nivel-l2.md)).
- Proveniência: código vazado do Claude Code continua proibido.

## Rollback

Reverter o pin para v1.1.0, apagar a matriz e os how-to, e restaurar
`AGENTS.md` anterior. Gates novos (`GATE-14` scanner, cyclomatic 10, Trivy)
saem com o revert dos scripts. Deny files são só configuração de cliente.

## Fora de escopo

- L3 / perfil Regulado.
- Reabrir `GATE-16`.
- Fila de merge neste repositório de conta pessoal (a plataforma só a oferece
  em repositório público de organização). Issue types de organização.
- Copiar `RULES.md`. Copiar YAML de Actions do padrão (o padrão não envia YAML).
- Wiki ou Discussions como segundo spec (wiki foi desligada).

## Aprovação (SDD-02)

- Aprovador: @marcioazam
- Data: 2026-08-18
- Evidência: escolha `two_wave` e pedido de implementação do plano “Harness SOTA duas ondas”.
