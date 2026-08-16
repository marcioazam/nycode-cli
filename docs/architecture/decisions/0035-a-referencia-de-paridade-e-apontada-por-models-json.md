# ADR-0035: A referência de paridade é apontada por `models.json` num diretório efêmero

- **Status:** aceito
- **Data:** 2026-08-16
- **Contexto relacionado:** [`spec.md`](../../../.specs/nycode-rs/spec.md) NFR-6;
  [spec 002](../../specs/002-paridade-e-sota-2026/spec.md) NFR-1 local, NFR-6;
  [`sources/research_pi-gateway-local.md`](../../../sources/research_pi-gateway-local.md)

## Contexto

O harness de paridade precisa que a referência e o candidato falem com o mesmo
gateway. O candidato aceita `--base-url`. A referência, no commit que o
[`NOTICE`](../../../NOTICE) fixa (`581d75a`, `pi` 0.84.1), ignora
`ANTHROPIC_BASE_URL`: o endpoint vem da definição do modelo. Com só a variável,
uma execução de diagnóstico foi à API real da Anthropic e voltou `401` com
`request_id` genuíno — chamada externa não intencional, com credencial falsa.

A pesquisa da Frente 0 leu o fonte no commit fixado e confirmou o mecanismo:
`models.json` num diretório de agente redirecionável por `PI_CODING_AGENT_DIR`.
O `baseUrl` do dialeto `anthropic-messages` é a origem, sem `/v1`, porque o SDK
posta em `/v1/messages`. O ponto de decisão (repinar o NOTICE, interceptar por
DNS/proxy, waiver) não disparou: esta versão aceita gateway local.

Restava onde materializar o arquivo. Duas costuras possíveis.

## Decisão

`Harness::reference` materializa a definição de modelo: cria um `TempDir`,
grava o `models.json` que aponta o provider `anthropic` built-in à origem do
gateway, e exporta `PI_CODING_AGENT_DIR` no vetor de ambiente da execução.
Devolve `Result<(Harness, TempDir)>`. O chamador segura o diretório até o fim
da comparação.

Restrições:

- **O apontamento vive no Rust testado**, não no `parity-gate.sh`. Um mecanismo
  só em bash é um mecanismo que `cargo test` não alcança.
- **A variável que a referência ignora não é o vetor.** `ANTHROPIC_BASE_URL`
  deixa de ser definida. Manter as duas seria de novo um teste verde sobre
  configuração, não sobre o observável.
- **O `baseUrl` gravado é a origem.** A URL que o fixture anuncia traz `/v1`;
  gravá-la inteira faria o SDK pedir `/v1/v1/messages`.

## Consequências

Positivas: o teste
`the_reference_harness_reaches_the_local_gateway_instead_of_the_real_api`
asserta a contabilidade constante do fixture (`input = 1234`), que a API real
não emite. A ausência de chamada externa fica provada pela presença da local.
O NFR-6 deixa de depender de uma premissa falsa.

Negativas: `reference()` deixa de ser infalível e sem efeito. Cada comparação
cria um diretório temporário e um arquivo. O chamador em `main.rs` passa a
segurar o `TempDir` pelo tempo da execução — se largar cedo, a referência
volta a não achar o `models.json` e o defeito reaparece calado.

Descartadas: **materializar em `parity-gate.sh`**, rejeitada porque o
mecanismo ficaria fora do crate testado e o teste de integração voltaria a
asserir o vetor `env`. **Repinar o NOTICE** para uma versão que leia
`ANTHROPIC_BASE_URL`, rejeitada porque o commit fixado já aceita gateway
local pelo mecanismo acima, e mudar a base dos 60 deltas reabre o inventário.
**Interceptar por DNS ou proxy no job**, rejeitada porque fecharia o gate
medindo um arranjo que ninguém reproduz na mão.

## Revisão

Reabrir se a distribuição instalada da referência deixar de se chamar `pi`
(`piConfig.name` no manifesto muda o prefixo da variável), ou se o SDK
`anthropic-messages` passar a tratar `baseURL` como prefixo de rota. A ação
padrão no primeiro caso é ler o nome da variável do manifesto da distribuição
fixada, não hardcodar um segundo prefixo. No segundo, gravar a URL anunciada
pelo fixture sem cortar `/v1`.
