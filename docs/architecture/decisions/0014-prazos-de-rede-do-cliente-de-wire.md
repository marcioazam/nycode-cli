# ADR-0014: Prazos de rede do cliente de wire são de ociosidade, não de duração

- **Status:** aceito
- **Data:** 2026-08-13
- **Contexto relacionado:** [`spec.md`](../../../.specs/nycode-rs/spec.md) FR-4, NFR-1, NFR-4

## Contexto

O cliente HTTP de [`transport/client.rs`](../../../crates/nycode-ai/src/transport/client.rs)
é construído com `user_agent` e mais nada. Não há `timeout`, `connect_timeout`
nem `read_timeout` — nem nele, nem em nenhum outro ponto do workspace. Um
gateway que aceita a conexão e para de emitir deixa o turno pendurado para
sempre, e a única saída é o usuário perceber e apertar Ctrl+C.

Dois agravantes tornam isso pior do que parece. O primeiro é que a busca de
catálogo reusa o mesmo cliente e roda no arranque, antes de a interface abrir:
um gateway mudo trava o binário sem desenhar nada na tela, e o usuário não tem o
que interromper. O segundo é o [ADR-0015](0015-o-cancelamento-e-por-turno.md) —
até ele, o Ctrl+C que salvava a sessão de um turno pendurado era o mesmo que a
inutilizava.

A dificuldade de desenho é que a resposta é um stream. Um turno legítimo com
raciocínio estendido leva minutos, e o teto que protege contra um gateway morto
é o mesmo número que mataria uma resposta longa e saudável. Um prazo de duração
total não consegue separar os dois casos.

Existe ainda uma dívida a fechar junto. A política de retentativa de
[`transport/retry.rs`](../../../crates/nycode-ai/src/transport/retry.rs) está
implementada, testada e sem ADR nenhum, o que o NFR-6 não admite. Ela é decisão
de rede tanto quanto os prazos, e fica registrada aqui.

## Decisão

**Prazo de ociosidade, não de duração.** O que distingue um gateway morto de um
gateway pensando não é quanto tempo o turno levou, é há quanto tempo ele não
manda um byte.

- `connect_timeout` de **10s** no cliente compartilhado. Limita o aperto de mão.
  Um estouro é `reqwest::Error` com `is_timeout()`, que
  [`ApiError::is_retryable`](../../../crates/nycode-ai/src/error.rs) já classifica
  como retentável — a retentativa existente passa a cobrir o caso sem mudança.
- `read_timeout` de **120s** no cliente compartilhado. Em `reqwest` 0.13 ele
  limita cada leitura e reinicia a cada chunk, ou seja, mede o intervalo entre
  eventos SSE e não a duração do turno. Cento e vinte segundos de silêncio
  absoluto num protocolo de streaming é um stream morto; um turno longo que
  emite deltas ou `ping` nunca chega perto.
- Prazo **total de 10s** por requisição na busca de catálogo, que não é
  streaming e portanto admite duração fechada. Vai no `RequestBuilder`, não no
  cliente, para não contaminar o turno.
- Ociosidade no meio do stream vira `Error::StreamIdle`, variante própria. Não é
  `MalformedStream`, porque o stream não estava malformado, e não é
  `TruncatedStream`, porque o corpo não terminou. Mandar o usuário depurar a
  coisa errada é a forma de degradação silenciosa que o NFR-4 alcança.
- `StreamIdle` **não é retentável**, pela mesma razão que um erro in-band não é:
  quando ele acontece o turno já abriu, e ferramentas podem ter rodado. Repetir
  duplicaria efeito colateral.

Os valores são constantes nomeadas e injetáveis por `Config::with_timeouts`. Um
prazo fixado dentro do construtor tornaria o comportamento intestável, que o
[ADR-0003](0003-pisos-de-cobertura-95-agregado-90-por-arquivo.md) trata como
problema de desenho e não como candidato a exemption.

**Retentativa, registrada retroativamente.** Três tentativas — a primeira e duas
chances de o backend se recuperar. Backoff exponencial de 400ms com teto de 8s.
O `Retry-After` do servidor vence o cálculo local, ainda limitado pelo teto, e a
forma em data HTTP é ignorada porque interpretá-la exige relógio confiável nos
dois lados. Só o **estabelecimento** do turno é retentado: depois que o stream
abre, repetir duplicaria efeitos colaterais das ferramentas que já rodaram.

## Consequências

Positivas: um gateway que morre no meio do stream deixa de pendurar o turno e
passa a produzir erro nomeado em até 120s; o arranque ganha teto de 10s contra
um catálogo mudo; e a política de retentativa deixa de ser conhecimento tácito
de quem leu o código.

Negativas: 120s é escolha por argumento, não por medição — não temos série
histórica do maior intervalo entre eventos de um turno real com raciocínio
estendido, e um gateway que exceda isso passará a falhar onde antes esperava.
O `read_timeout` é do cliente e vale para toda requisição que o compartilhe, o
que inclui o catálogo; ele fica coberto pelo prazo total mais apertado, mas a
dependência é implícita. E o teto de conexão de 10s é generoso o bastante para
que uma rede ruim ainda custe 30s somados às três tentativas.

Descartadas: **prazo total no turno**, rejeitado porque não distingue gateway
morto de resposta longa e o valor que protege é o mesmo que mata o caso bom.
**Seguir sem prazo**, rejeitado porque é o defeito que este ADR corrige.
**Circuit breaker e retry budget**, rejeitados por não haver o que proteger: o
`nycode` é um processo por usuário com um turno de cada vez, sem fan-out e sem
vazão que possa amplificar uma falha do backend — os padrões que valem para um
serviço multi-inquilino aqui só acrescentariam estado.

## Revisão

Reabrir o valor de 120s assim que houver medição de intervalo entre eventos em
turno real — o número é a parte fraca desta decisão e deve ser o primeiro a
mudar quando existir dado. Reabrir a escolha de não retentar `StreamIdle` se
aparecer forma de saber que nenhuma ferramenta rodou no turno interrompido, o
que tornaria a retentativa segura no caso em que a ociosidade acontece antes do
primeiro `tool_use`. Reabrir a rejeição do circuit breaker se o `nycode` algum
dia falar com vários endpoints em paralelo.
