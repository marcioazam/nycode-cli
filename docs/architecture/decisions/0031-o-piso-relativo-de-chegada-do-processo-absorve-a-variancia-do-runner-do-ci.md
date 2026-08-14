# ADR-0031: O piso relativo de "chegada do processo" absorve a variância do runner do CI

- **Status:** aceito
- **Data:** 2026-08-14
- **Contexto relacionado:** [`spec.md`](../../../.specs/nycode-rs/spec.md) NFR-1;
  revisa o divisor de startup do
  [ADR-0012](0012-performance-e-medida-contra-um-concorrente-nomeado.md), sob a
  precedência do [ADR-0011](0011-seguranca-antes-de-performance.md)

## Contexto

Este repositório publicou seu primeiro CI real em 2026-08-14 — a própria PR que
o levou ao ar. O job `perf` reprovou duas vezes seguidas na mesma métrica, sem
nenhuma mudança de código no caminho de startup entre uma tentativa e outra:

| Tentativa | Chegada do processo (mínimo de 200 execuções) | Piso vigente |
|---|---:|---:|
| 1 | 1178 µs | 1148 µs |
| 2 | 1163 µs | 1148 µs |

O ADR-0012 já previa este exato cenário na própria seção de Revisão: *"revisto
se o piso de startup reprovar por variância do runner em vez de por regressão
de código — duas ocorrências [...] sem mudança relevante no caminho de startup
bastam."* Duas ocorrências aconteceram na mesma PR, não em PRs distintas como o
texto original imaginava — mas é o repositório inteiro medindo CI pela
primeira vez, então não há PR anterior para servir de segunda amostra
independente. A evidência de que a causa é o runner, e não o diff, é mais
direta aqui: o diff sob revisão não toca nenhum arquivo de
`crates/nycode-cli/src/` nem `crates/nycode-agent/src/`, só workflow e scripts
de CI.

`scripts/perf-gate.sh` mede com `hyperfine --warmup 20 --runs 200` e toma o
**mínimo**, não a mediana, deliberadamente — a própria justificativa no script
descarta a mediana por medir contenção, não o programa. As duas medições em CI
são, portanto, o melhor caso entre 200 tentativas em cada execução, e mesmo
assim ficam acima do piso. Nesta máquina de desenvolvimento, a mesma métrica
mediu 386–410 µs ao longo da sessão que corrigiu o CI — a máquina do CI é
quase 3x mais lenta neste ponto específico, um salto maior do que o pior caso
já observado localmente (560 µs) que motivou o divisor `/3` original.

O piso efetivo hoje é o relativo (1148 µs), não o absoluto (3000 µs) — o texto
original do ADR-0012 fala em "subir o piso absoluto", mas
`effective_floor()` sempre aplica o mais apertado dos dois, e hoje isso é o
relativo. Subir o absoluto não move o piso que está reprovando; é o divisor do
relativo que precisa mudar.

## Decisão

`STARTUP_RATIO` em `scripts/perf-gate.sh` passa de `3` para `2`, subindo o
piso relativo de "chegada do processo" de 1148 µs para 1723 µs
(`3446 ÷ 2`, com o mesmo baseline do concorrente do ADR-0012, arredondamento
por divisão inteira). A margem sobre a pior medição observada em CI (1178 µs)
fica em 545 µs — cerca de 46% de folga, e não os 2x de folga original que o
`/3` garantia sobre o pior caso local conhecido então, porque a realidade
observada em CI não deixa mais do que isso.

O piso da sonda de sessão montada (`PROBE_STARTUP_FLOOR_US`, 15000 µs,
absoluto) e os pisos de RSS e binário não mudam: nenhum deles reprovou, e a
regra 2 do ADR-0011 pede que só o orçamento que o controle torna inalcançável
se mova — mover os outros seria abrir margem sem motivo medido, o que
descaracterizaria o piso.

## Consequências

Positivas: o gate volta a medir regressão de código em vez de medir a
diferença de hardware entre o runner do GitHub Actions e a máquina onde o
ADR-0012 foi calibrado. O piso continua vivo — ainda reprovaria uma regressão
real de startup, porque 1723 µs continua sendo uma fração pequena do
`VERSION_STARTUP_FLOOR_US` absoluto (3000 µs) e de qualquer coisa que se
pareça com o custo real de um `fork`/`exec` regredido.

Negativas: a margem sobre o concorrente aperta — de 3x (baseline ÷ 3) para 2x
(baseline ÷ 2) — então uma melhoria futura do concorrente que hoje reprovaria
em `/3` passa a exigir uma melhoria maior para reprovar em `/2`. É o mesmo
custo que o ADR-0012 já pagou ao preferir `/3` a `/5`: menos sensibilidade ao
mercado, mais robustez a ruído. Com apenas duas amostras de CI, o piso de 1723
µs é uma estimativa, não uma medição definitiva — se o runner do GitHub
Actions variar mais do que estas duas execuções sugerem, este ADR volta a ser
reaberto pelo próprio gatilho que o abriu.

Descartadas: **subir o piso absoluto**, que o texto original do ADR-0012
sugeria — não muda o piso efetivo enquanto o relativo continuar mais apertado,
então não teria fechado a reprovação observada. **Trocar o mínimo por
mediana**, que reintroduziria exatamente o problema que o próprio script
descarta na medição do concorrente e na nossa: mediana mede contenção de
runner compartilhado, não o programa. **Adicionar `PERF_ALLOW_*` para pular a
métrica em CI**, que é uma dispensa de medição, não uma calibração — o
requisito ficaria sem gate, o defeito que o ADR-0003 e o ADR-0012 já nomearam
como "decoração". **Um divisor fracionário** (por exemplo `2.5`, dando um piso
mais próximo dos 1178 µs observados) — a aritmética do script é inteira
(`$((baseline / ratio))`), e introduzir ponto flutuante em bash é uma mudança
de mecanismo maior do que o achado justifica; `/2` já entrega margem
suficiente com uma mudança de uma linha.

## Revisão

Este ADR é revisto se o piso de 1723 µs ainda reprovar por variância do runner
em duas execuções de CI distintas sem mudança relevante no caminho de startup
— a ação padrão nesse caso é apertar menos ainda (`/1`, ou promover o piso a
puramente absoluto) e registrar as novas medições. É revisto se alguma medição
de CI cair abaixo do novo piso relativo por uma margem tão grande que sugira
que `/2` ficou frouxo demais para o hardware real do runner, caso em que a
pergunta volta a ser a do ADR-0012: otimizar ou recuar a margem declarada. E é
revisto junto do ADR-0012 se o concorrente medido mudar de versão ao ponto de
alterar `startup_fastest_us` o bastante para que `/2` deixe de refletir a
mesma folga proporcional.
