# ADR-0012: Performance é medida contra um concorrente nomeado, com dois pisos

- **Status:** aceito
- **Data:** 2026-08-13
- **Contexto relacionado:** [`spec.md`](../../../.specs/nycode-rs/spec.md) NFR-1,
  NFR-2, NFR-3, NFR-8; aplica a NFR-1..3 o desenho de dois pisos do
  [ADR-0003](0003-pisos-de-cobertura-95-agregado-90-por-arquivo.md); a restrição 1
  vem do [ADR-0011](0011-seguranca-antes-de-performance.md)

## Contexto

Os orçamentos de performance eram decoração, e a aritmética diz isso sem espaço
para interpretação. NFR-1 orçava 100ms de startup; a medição era de 2ms. NFR-2
orçava 30 MiB de RSS; a medição era de 5,4 MiB. Uma regressão de 2ms para 99ms
passava no gate.

É o mesmo defeito que o [ADR-0003](0003-pisos-de-cobertura-95-agregado-90-por-arquivo.md)
já diagnosticou em cobertura, com as mesmas palavras:

> Um piso que fica muito abaixo do valor real deixa de ser um piso e vira
> decoração — ele não impede regressão nenhuma até que a regressão seja enorme.

Só que em performance falta um ingrediente que cobertura não tem. Cobertura é
absoluta: 95% é 95% independentemente do que o resto do mundo faz. Performance de
harness só significa alguma coisa contra alguém, porque a razão declarada para
este projeto existir em Rust é ser mais rápido que a alternativa que o
desenvolvedor já tem instalada. Um piso puramente absoluto, por mais apertado que
seja, não detecta o caso que mais importa: o concorrente melhorou e nós não.

Três fatos delimitaram contra quem medir. Primeiro, performance de harness e
eficácia de agente são eixos independentes — Terminal-Bench e SWE-bench medem o
modelo, e o modelo vem do gateway, então nada disso é comparável aqui. Segundo,
entre os CLIs de IA relevantes o único reescrito em linguagem nativa é o Codex
CLI: a OpenAI removeu Node.js em 2025 citando "zero-dependency install, native
security bindings, optimized performance". Os demais líderes seguem em Node.js ou
Bun e medem uma ordem de grandeza pior. Terceiro, `codex` está entre as cinco
referências permitidas pelo [`AGENTS.md`](../../../AGENTS.md), enquanto o Claude
Code está do lado proibido — de modo que o mais rápido e o permitido são o mesmo
projeto, e a escolha não custa nada em proveniência.

A medição local, mesmo método nos dois lados, com `hyperfine --shell=none
--warmup 20 --runs 200` e `/usr/bin/time -f %M`, ambos os binários ELF stripped:

| Métrica | nycode 0.1.0 | codex-cli 0.147.0 | Razão |
|---|---:|---:|---:|
| Startup, mediana | 0,60 ms | 13,09 ms | 21,8x |
| RSS de pico | 5.032 KB | 22.212 KB | 4,4x |
| Binário stripped | 12.017.944 B | 258.278.208 B | 21,5x |

Dois achados da medição decidem detalhes do desenho. O primeiro é que o 2ms que
o repositório publicava era artefato do instrumento: o gate media com
`date +%s%N` em volta da invocação, somando o `fork`/`exec` do subshell à amostra.
O erro era conservador, mas um orçamento que se pretende apertado não pode ser
calibrado com granularidade três vezes maior que o valor medido. O segundo é que
**as razões diferem por quase cinco vezes entre métricas** — 21,8x em tempo
contra 4,4x em memória. Uma margem relativa uniforme de 5x reprovaria hoje em
memória e seria frouxa em tempo.

Números de terceiros para o Codex divergem entre si e da medição local: ~34,5ms,
~37,7ms e ~32ms em três suítes públicas, contra 13,09ms aqui. Nenhuma delas
publicou a versão medida junto do número. O
[RECON](../../../.specs/perf-competitiva/research.md) registra a divergência e a
ressalva de proveniência sobre a suíte pública mais completa, que pertence ao
`claw-code` e por isso não foi consultada.

## Decisão

Cada métrica de performance passa a ter **dois pisos, ambos duros, ambos falhando
fechado**, no molde do ADR-0003.

1. **Piso absoluto**, perto do valor medido. Pega regressão nossa.
2. **Piso relativo** ao baseline do concorrente. Pega o mercado passando na
   frente.

| Métrica | Piso absoluto | Piso relativo | Vale hoje | Medido |
|---|---:|---|---:|---:|
| Startup, mediana | 3.000 µs | baseline ÷ 5 | 2.618 µs | 600 µs |
| RSS de pico | 8.192 KB | baseline ÷ 2 | 11.106 KB | 5.032 KB |
| Binário | 16.777.216 B | baseline ÷ 5 | 51.655.641 B | 12.017.944 B |

As margens relativas são por métrica e derivam da razão medida, com folga para o
concorrente melhorar sem nos reprovar de imediato. O piso que vale é sempre o mais
apertado dos dois, e hoje isso é o relativo em startup e o absoluto nas outras
duas — os dois tipos de piso estão vivos, que é a razão de existirem dois.

Quatro restrições acompanham a decisão.

1. **O gate mede o build padrão de release, com todo controle de segurança
   ativo**, conforme o [ADR-0011](0011-seguranca-antes-de-performance.md). Um
   número de performance obtido de outro artefato não é um número deste projeto.

2. **O baseline é sempre medido por este repositório, com o método do próprio
   gate.** Número de terceiro serve para escolher contra quem medir; nunca vira
   valor de gate. O baseline vive em
   [`scripts/perf-baseline.txt`](../../../scripts/perf-baseline.txt) e carrega
   versão, data, digest do artefato e URL de origem junto de cada número.

3. **O digest do artefato do concorrente é fixado e verificado antes da
   execução.** O `SHA256SUMS` publicado pelo Codex cobre só os archives
   `*-package-*` e não menciona o binário puro, então não há contra o que
   conferir a não ser o que este repositório fixou. Adotar versão nova é uma
   alteração de digest visível em diff de PR.

4. **O CI de PR não fala com a rede.** O `perf-gate.sh` lê o baseline do arquivo.
   Quem mede o concorrente é o workflow agendado
   [`perf-baseline.yml`](../../../.github/workflows/perf-baseline.yml), semanal,
   que abre PR quando o número se move e não bloqueia nada.

O gate também troca `date +%s%N` por `hyperfine --shell=none`, e falha fechado na
ausência dele com dispensa explícita por `PERF_ALLOW_NO_HYPERFINE`, seguindo o
precedente que `PERF_ALLOW_NO_RSS` estabeleceu para `/usr/bin/time`. Como todo
gate deste repositório, ele ganha bateria própria em
[`perf-gate-test.sh`](../../../scripts/perf-gate-test.sh): um gate que perdeu a
capacidade de reprovar aprova tudo em silêncio.

## Consequências

Positivas: a distância entre a barra declarada e a praticada some, e o gate volta
a detectar regressão real em vez de só catástrofe — a folga de startup cai de 50x
para 4,4x. O piso relativo cobre um modo de falha que nenhum piso absoluto cobre:
ficarmos parados enquanto o concorrente melhora, que é precisamente a forma como
a justificativa deste projeto expiraria sem ninguém notar. E medir com
`hyperfine` corrige um número publicado que estava 3x inflado, o que importa num
repositório que declara os próprios números no README.

Negativas: o gate ganha uma dependência de ferramenta externa, e uma que não vem
na imagem do CI. O baseline envelhece entre execuções do workflow agendado, então
existe uma janela em que o gate compara contra um Codex que já mudou. O piso de
startup de 2.618 µs é apertado o bastante para ficar exposto à variância do
runner do GitHub Actions, que é VM compartilhada e não foi possível caracterizar
daqui — é o risco mais provável de flakiness desta mudança. A comparação de
tamanho tem um caveat que a tabela não mostra: o binário do Codex é musl
estático e o do nycode é dinâmico contra a glibc do sistema, então parte da
diferença é a libc que não estamos carregando; a diferença restante continua
sendo de mais de vinte vezes, o que sustenta a comparação direcionalmente mas não
ao dígito. E há a assimetria de que 4,4x em memória é uma vantagem muito menor
que 21,8x em tempo — o piso relativo de RSS em ÷2 é o mais frouxo dos três porque
a realidade medida não permite mais, o que é a informação em si: memória é onde
este projeto tem menos margem sobre o concorrente.

Descartadas: **medir o concorrente ao vivo em todo PR**, que daria sempre o número
atual ao custo de rede, instalação e às vezes login no caminho crítico de todo PR,
e que quebraria builds por motivo alheio ao diff sob revisão — o valor de um gate
determinístico é maior que o de um número fresco. **Incluir Claude Code e
Antigravity no conjunto medido**: o primeiro está do lado proibido da proveniência
e o segundo é closed-source, e como ambos são mais lentos que o Codex, vencê-los
já está implicado por vencer o mais rápido. **Adotar o número de terceiro como
baseline**, que seria mais barato e é o que a divergência de ~32ms a ~37,7ms entre
suítes públicas desaconselha — nenhuma publicou a versão medida. **Um piso só**:
o absoluto sozinho não vê o concorrente melhorar, e o relativo sozinho deixa o
gate inteiro depender de um número que este repositório não controla, de modo que
um Codex que engordasse afrouxaria nosso próprio piso. **Margem relativa
uniforme**, simétrica e mais fácil de explicar, mas que em ÷5 reprovaria hoje em
memória e em ÷2 seria decorativa em tempo. **Um ratchet que reprova quando o
número medido melhora demais**, análogo ao ratchet das exemptions de cobertura:
falhar o CI numa melhoria é hostil, e o mesmo efeito se obtém pelo workflow
agendado propondo o aperto em PR.

## Revisão

Este ADR é revisto se o piso de startup reprovar por variância do runner em vez
de por regressão de código — duas ocorrências em PRs distintos sem mudança
relevante no caminho de startup bastam, e a ação padrão é subir o piso absoluto
para a mediana observada no CI e registrar o número que motivou. É revisto se
alguma razão medida cair abaixo do piso relativo correspondente, porque aí a
margem deixou de descrever a realidade e a pergunta passa a ser se otimizamos ou
se recuamos a margem declarada. É revisto se o Codex CLI deixar de ser o mais
rápido entre as referências permitidas, caso em que o baseline muda de projeto e
não só de versão. E se o workflow agendado ficar mais de dois meses sem
atualizar o baseline, o piso relativo está medindo um concorrente histórico: ou o
workflow volta a rodar, ou o piso relativo é retirado em vez de mantido como
ficção.
