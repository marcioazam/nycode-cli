# RECON — o que a referência entrega, e o que 2026 pede além dela

**Data:** 2026-08-13 · **Passes:** 4 · **Confiança:** ~82%

Complementa o [`research-sota-2026.md`](research-sota-2026.md), que fundamentou
a emenda de escopo de FR-11 a FR-20. Este documento fundamenta a
[spec 002](../../docs/specs/002-paridade-e-sota-2026/spec.md) e a segunda emenda
de escopo, que tira do não-escopo a integração de editor por protocolo
padronizado.

## Método

Duas frentes. Leitura direta da referência no commit que o
[`NOTICE`](../../NOTICE) fixa, pacote a pacote. E levantamento externo em quatro
passes sobre o que mudou depois do RECON anterior. As fontes brutas estão em
[`sources/research_paridade-pi-e-sota-2026.md`](../../sources/research_paridade-pi-e-sota-2026.md),
inclusive uma marcada como não utilizável por proveniência.

## Achados

Ordenados por impacto sobre a decisão de escopo.

**1. Oito capacidades declaradas neste repositório não têm caminho de produção.**
O caso limite é o controle de raciocínio: `Sampling` carrega `thinking_budget`,
`Client::with_sampling` existe para configurá-lo, e nenhum dos dois tem chamador
fora de teste. Os dois dialetos OpenAI mencionam `sampling` apenas dentro de
helper `#[cfg(test)]`. O critério de aceite do produto já antecipava esta classe
de falha — "um módulo implementado, testado e nunca chamado é pendência, não
entrega" — e a tabela de requisitos marca os vinte FRs como entregues.
Confiança: alta, é leitura de código. Impacto: crítico.

**2. Os pisos de cobertura não detectam essa classe por construção.** Eles medem
se a linha foi executada, e um teste a executa. O `with_sampling` tem cobertura
acima do piso e nunca foi chamado por produção. É por isso que a spec 002
acrescenta uma verificação que os gates não fazem, em vez de apertar um gate
existente. Confiança: alta. Impacto: crítico.

**3. A referência não é um alvo uniforme, e parte dela é código morto.** Três dos
dez pacotes — servidor, backend de sessão em SQLite, e a emissão de spans de
telemetria — não são instanciados por nada fora de teste dentro do próprio
projeto dela. O pacote de servidor declara no manifesto que pode ser removido
sem aviso. Portar qualquer um seria portar código que o autor não usa.
Confiança: alta. Impacto: alto, e o efeito é negativo — evita trabalho.

**4. O ACP saiu de promessa para infraestrutura, e o custo em Rust é baixo.**
Vinte e cinco ou mais agentes, registry desde janeiro de 2026, adoção pela
JetBrains, e SDK em Rust com release recente. A superfície obrigatória são
quatro métodos mais uma notificação. É a única forma de este binário entrar em
vários editores sem escrever uma integração por editor. Confiança: alta.
Impacto: crítico. Registrado no [ADR-0029](../../docs/architecture/decisions/0029-a-integracao-com-editor-fala-acp.md).

**5. O transporte remoto do ACP ainda é work in progress, e isso é o que mantém
o não-escopo intacto.** O modelo maduro é subprocesso local sobre stdio. Um
editor lança o binário e conversa por entrada e saída padrão — não há socket
escutando, não há autenticação de rede a decidir. A emenda de escopo é
estritamente sobre integração de editor, e não reabre sessão remota.
Confiança: alta. Impacto: alto.

**6. As convenções semânticas de IA generativa do OpenTelemetry regrediram em
estabilidade.** O conteúdo mudou de repositório em junho de 2026, e o novo não
tem release, tag nem URL de schema. Emitir virou expectativa — os três CLIs de
maior circulação já emitem — mas o schema não pode ser contrato interno. Daí o
adiamento com gatilho explícito em vez de recusa. Confiança: alta. Impacto:
alto.

**7. A causa-raiz do envenenamento de ferramenta MCP é uma lacuna entre o momento
da conexão e o momento da chamada.** A descrição é revisada uma vez, na conexão;
a resposta entra no contexto sem checagem equivalente. O
[ADR-0016](../../docs/architecture/decisions/0016-extensao-do-workspace-exige-consentimento.md)
fixa a linha de comando do servidor, que fecha a troca do executável, e não fixa
o que o servidor declarou, que é a metade que o ataque usa. Confiança: alta.
Impacto: alto. Registrado no [ADR-0028](../../docs/architecture/decisions/0028-o-consentimento-fixa-a-definicao-declarada.md).

**8. Existe um argumento sério contra construir andaime, e vem de quem constrói.**
O relato de engenharia da Anthropic descreve terem removido reset de contexto,
o construto de sprint e o avaliador por etapa, cada remoção justificada por uma
capacidade que o modelo passou a ter. A leitura acionável: andaime que compensa
fraqueza de modelo envelhece; andaime que resolve problema de sistema —
confinamento, isolamento, reversibilidade, orçamento — não. É o critério que
separa o balde de adoção do balde de recusa na spec 002. Confiança: alta.
Impacto: alto.

**9. Este repositório já fecha o buraco de credencial que o levantamento aponta
como o achado de segurança mais acionável de 2026.** O padrão de falha é o
confinamento que protege disco e rede e herda as variáveis de credencial do
ambiente verbatim. O `env_clear()` mais allowlist de seis variáveis já resolve.
Vale registrar porque a ausência de um problema é invisível, e alguém vai propor
"simplificar" a allowlist. Confiança: alta. Impacto: médio.

**10. Cache de prompt tem mecanismo diferente por dialeto, e por isso o NFR-7 não
se satisfaz com um só.** O formato Anthropic usa pontos de corte explícitos; o
formato OpenAI usa chave derivada de sessão mais retenção declarada. São
mecanismos distintos para o mesmo objetivo, e implementar um não entrega o
outro. Confiança: alta. Impacto: alto.

**11. A referência calcula custo em moeda a cada atualização de usage, com duas
sutilezas que erram o número se ignoradas:** faixas de preço por tamanho de
contexto, em que a faixa vale para o pedido inteiro; e escrita de cache de
retenção longa cobrada ao dobro da tarifa de entrada, não à tarifa de escrita de
cache. Confiança: alta. Impacto: médio-alto. Registrado no
[ADR-0026](../../docs/architecture/decisions/0026-o-preco-vem-do-catalogo-descoberto.md).

**12. Sem transformação de mensagem, trocar de modelo produz um pedido que o
provider recusa.** Bloco de raciocínio assinado por um modelo, reenviado a
outro; chamada de ferramenta sem resultado, deixada por um cancelamento. O FR-19
e o FR-14 do produto estão declarados entregues e produzem esse estado.
Confiança: alta. Impacto: alto.

## Questões em aberto

- **Se a compactação por limiar basta, ou se falta reset com artefato de
  handoff.** O RECON anterior registrou a mesma questão e nenhum ADR a fechou. A
  spec 002 fecha metade — o limiar — e deixa o reset de fora. Impacto: médio.
- **Cobertura desigual do levantamento externo.** Um dos dois motores de busca
  recusou todas as consultas por limite de plano. Impacto: médio.
- **Se o ACP se mantém como padrão ou fragmenta.** O maior editor do mercado não
  o adotou e padronizou em outro protocolo. Impacto: médio, e o
  [ADR-0029](../../docs/architecture/decisions/0029-a-integracao-com-editor-fala-acp.md)
  registra o gatilho de revisão.

## Cálculo da confiança

Média ponderada por impacto, pesos crítico 1,0, alto 0,7, médio 0,5. Os achados
sobre a referência são leitura direta de código no commit fixado e têm confiança
alta uniformemente; o que puxa o resultado para baixo é a frente externa, onde
um motor de busca ficou indisponível e a cobertura concentrou-se em dois
fornecedores. Resultado ~82%: acima do piso de 70% que autoriza seguir, abaixo
dos 85% que dispensariam registrar a limitação. A limitação está registrada.
