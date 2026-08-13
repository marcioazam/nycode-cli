# ADR-0011: Segurança precede performance quando as duas se opõem

- **Status:** aceito
- **Data:** 2026-08-13
- **Contexto relacionado:** [`spec.md`](../../../.specs/nycode-rs/spec.md) NFR-8,
  NFR-1, NFR-2, NFR-3, FR-10, FR-11; relacionado ao
  [ADR-0012](0012-performance-e-medida-contra-um-concorrente-nomeado.md)

## Contexto

Performance e segurança estão em níveis documentais diferentes neste repositório,
e a diferença não foi decidida — foi herdada.

Performance é NFR-1, NFR-2 e NFR-3, cada um com orçamento numérico e gate próprio
em [`scripts/perf-gate.sh`](../../../scripts/perf-gate.sh). Segurança não é NFR
nenhum. Ela aparece como requisito funcional em FR-10 (credencial no cofre do
sistema operacional) e FR-11 (shell sob confinamento do sistema operacional),
como restrição de linguagem em `unsafe_code = "forbid"` mais os `deny` de clippy,
e como política de dependência no `deny.toml` com o job `supply-chain`. São
quatro mecanismos reais e nenhum deles se chama requisito não-funcional.

Enquanto os orçamentos de performance tinham 50x de folga — 100ms de orçamento
contra 0,60ms medidos —, a assimetria era teórica: ninguém precisava escolher.
O [ADR-0012](0012-performance-e-medida-contra-um-concorrente-nomeado.md) acaba
com a folga de propósito. Um orçamento apertado é justamente a condição em que a
tentação de pagar com segurança aparece, e ela tem alvos concretos aqui.

O primeiro é o próprio custo de startup dos controles. FR-10 resolve credencial
no cofre do sistema operacional e FR-11 exige que a indisponibilidade do
confinamento seja **dita ao usuário, nunca assumida** — detectar custa tempo, e
adiar a detecção para o primeiro uso da ferramenta é a otimização mais óbvia que
existe contra um orçamento de startup. Ela também transforma um aviso que o
usuário lê antes de agir num aviso que ele lê depois.

O segundo é que a tensão já está registrada, em direção oposta. O
[ADR-0005](0005-sandbox-de-so-por-processo-auxiliar.md) descreve NFR-1
restringindo **como** o confinamento é aplicado:

> Uma segunda restrição vem do NFR-1. O confinamento precisa ser aplicado por
> comando, não por processo: aplicá-lo ao `nycode` inteiro no startup fecharia o
> acesso do próprio harness ao cofre de credenciais e ao gateway.

Ali performance moldou a forma do controle sem enfraquecê-lo, que é o resultado
desejável. Não há nada escrito dizendo o que fazer quando esse resultado não
estiver disponível.

O terceiro alvo nasce nesta mesma onda: o ADR-0012 introduz um script que baixa e
executa um binário de terceiro para medir o baseline. É superfície de ataque nova,
criada por trabalho de performance.

## Decisão

Segurança precede performance. Quando as duas se opõem e não há forma que atenda
às duas, **a segurança define o que é aceitável e a performance se acomoda ao que
sobra**. A regra vira NFR-8 na spec, seção própria no
[`AGENTS.md`](../../../AGENTS.md), e carrega quatro restrições que não são
negociáveis.

1. **Os números de NFR-1, NFR-2 e NFR-3 são medidos sobre o build padrão de
   release, com todo controle de segurança ativo.** Medir um build com o
   confinamento ou o cofre desligados é medir outro programa e reportar o número
   dele. O artefato medido é o artefato que o release entrega.

2. **Quando um controle de segurança torna um orçamento inalcançável, o orçamento
   se move e o controle não.** O orçamento novo é registrado com o número medido
   que o motivou, na mesma revisão que introduz o controle.

3. **A detecção de disponibilidade do confinamento (FR-11) e a resolução de
   credencial (FR-10) não são adiadas nem puladas para caber no orçamento de
   startup.** Adiar a detecção para o primeiro uso da ferramenta é uma economia
   real e está fechada: FR-11 exige que a ausência de confinamento seja dita, e
   dizer depois de o usuário já ter decidido agir não é dizer.

4. **Código que baixa artefato de terceiro verifica antes de executar.** O digest
   esperado é fixado em arquivo versionado, a divergência recusa a execução, e a
   adoção de um digest novo passa por diff de PR. A ordem é conferir, extrair,
   executar — desempacotar antes de conferir já seria rodar o desempacotador
   sobre bytes não verificados. Vale hoje para o
   [`perf-baseline.yml`](../../../.github/workflows/perf-baseline.yml), que lê o
   digest de [`perf-baseline.txt`](../../../scripts/perf-baseline.txt) e recusa
   rodar enquanto ele não estiver fixado, e para qualquer sucessor.

No CI, a precedência deixa de ser prosa: o job `perf` passa a declarar
`needs: [supply-chain]`. Todos os jobs de [`ci.yml`](../../../.github/workflows/ci.yml)
eram paralelos; a partir daqui o resultado de performance não é sequer produzido
enquanto a política de dependências não passa. A ordem do bloco de comandos em
`AGENTS.md` § "Antes de dizer que terminou" segue a mesma sequência.

## Consequências

Positivas: a regra tem consequência observável em vez de ficar no documento — o
DAG do CI a torna literal, e o `perf-baseline-refresh.sh` nasce com verificação
de digest porque ela existe. A restrição 2 remove uma discussão recorrente:
quando um controle de segurança custa milissegundos, não há negociação sobre
quem cede. E declarar a restrição 3 nominalmente fecha a otimização mais provável
antes que alguém a implemente de boa-fé e ela passe no gate.

Negativas: `needs: [supply-chain]` serializa dois jobs que eram paralelos e atrasa
o retorno de performance no PR pelo tempo do `cargo deny`. A restrição 3 fecha uma
economia legítima — lazy-loading do cofre é uma técnica normal e aqui passa a
exigir ADR para acontecer, o que é atrito real sobre uma ideia que pode ser boa.
E a regra é assimétrica por construção: ela não obriga ninguém a justificar um
controle de segurança caro, então um controle mal desenhado pode consumir
orçamento sem ser questionado pela mesma força que questiona a otimização.

Descartadas: **deixar a regra como princípio sem consequência**, que produziria
exatamente o defeito que o [`docs/INDEX.md`](../../INDEX.md) descreve — algo
declarado em documento sem que o caminho de produção o execute — e que este
repositório já pagou uma vez, com três requisitos marcados como entregues cujo
código nunca era chamado. **Promover segurança a NFR sem invariante verificável**,
que o [`SPEC_TEMPLATE.md`](../../specs/SPEC_TEMPLATE.md) proíbe ao exigir
"orçamento numérico e como é medido" — daí NFR-8 ser escrito como três
verificações e não como valor. **Inverter a ordem**, deixando performance
primeiro: o projeto existe porque o harness de referência é lento, mas um harness
rápido que vaza credencial ou executa comando fora do confinamento não tem valor
nenhum a mais por ser rápido. **Fazer o `perf-gate.sh` detectar um build com
controle de segurança desligado**, que hoje seria código sem caso de uso — não
existe feature que desligue confinamento ou cofre, e a única feature não-padrão,
`subscription-oauth`, *adiciona* risco em vez de removê-lo, e já tem gate próprio
desde o [ADR-0001](0001-subscription-oauth-is-a-flagged-accepted-risk.md).

## Revisão

Este ADR é revisto se aparecer uma feature de build capaz de desligar um controle
de segurança, caso em que a restrição 1 deixa de ser sustentada pela ausência de
alternativa e passa a exigir detecção no gate, como a alternativa descartada
previa. É revisto se o `needs: [supply-chain]` acrescentar mais de três minutos à
mediana do CI, caso em que a precedência volta a ser expressa por ordem de
comando em vez de dependência de job. E uma terceira vez que um orçamento de
performance se mover por causa de um controle de segurança é sinal de que o
problema está no desenho do controle e não no orçamento: a restrição 2 continua
valendo, mas o controle passa a precisar de ADR próprio.
