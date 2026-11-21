# /cd: aviso de política no callback withSession

Defeito (verificado): `okInfo()` em `claude-home/patches/pi-core/session-cwd/runtime.mjs` omitia `policy`; o callback
`withSession(ctx, info)` roda dentro de `switchSession`, antes do retorno final que acrescentava `policy:true`. Com política
(`--no-approve/-na` ou `defaultProjectTrust: "never"`), `trusted:false`, `needs!==false`, a extensão anunciava "não confiável"
em vez de "desativada por política".

Correção: `okInfo()` é a única regra; inclui `policy:true` só se `!trusted && pre.policy && pre.needs!==false`. O retorno final
usa `okInfo()`. Contrato `false/ausente` inalterado.

Evidência: teste `política: o info do withSession já traz policy:true e é igual ao resultado final` (runtime.test.mjs).
RED com o runtime antigo (`actual: undefined, expected: true`); GREEN após a correção (runtime + apply: 44/44).
Pendente (orquestrador): aplicar às 3 cópias do runtime no SDK vivo.
