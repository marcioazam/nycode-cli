# ADR-0013: O gate de performance mede a sessão montada, e o `--version` vira a métrica comparável

- **Status:** aceito
- **Data:** 2026-08-13
- **Contexto relacionado:** [`spec.md`](../../../.specs/nycode-rs/spec.md) NFR-1,
  NFR-2, NFR-8; emenda o
  [ADR-0012](0012-performance-e-medida-contra-um-concorrente-nomeado.md) quanto
  à carga medida, mantendo intacto o desenho de dois pisos que ele estabeleceu

## Contexto

O [ADR-0012](0012-performance-e-medida-contra-um-concorrente-nomeado.md)
corrigiu o instrumento e não a carga. Ele trocou `date +%s%N` por `hyperfine`,
o que fez o número publicado cair de 2ms para 600µs — mas os 600µs continuam
sendo o custo de `nycode --version`, e `--version` não alcança nada do que o
NFR-1 descreve. O `clap` o resolve dentro de `Cli::parse()` e encerra o processo
antes do `tracing`, antes do runtime do tokio, e antes de `session::prepare`
inteiro: credencial, `Context::discover` varrendo o disco, `Store::open` com o
índice da árvore de sessão, `catalog::resolve` e o spawn dos servidores MCP.

O comentário no topo do [`main.rs`](../../../crates/nycode-cli/src/main.rs)
fechava o círculo em voz alta — "`--version` e `--help` são caminhos síncronos
porque NFR-1 mede exatamente isso" — de modo que o código justificava o atalho
citando o gate e o gate media o atalho.

O NFR-2 estava pior. Ele orça memória residente "numa sessão ociosa", e a
medição rodava um processo que nunca abre sessão.

A medição que fundamenta este ADR usou o mesmo método do ADR-0012, com uma
ressalva de rigor: a máquina estava sob carga (`load average` ~84, sessão
concorrente compilando), o que envenena a mediana. O estimador usado foi o
**mínimo de 400 execuções**, que sob contenção é a amostra que pegou uma fatia
limpa. A validação de que ele serve está no próprio `--version`: mínimo de
589µs aqui contra 600µs de mediana que o ADR-0012 mediu em máquina quieta. O
mínimo reproduz o número quieto dentro de 2%.

| Carga | Métrica | Medido | O que entra na amostra |
|---|---|---:|---|
| `--version` | menor tempo | 589 µs | exec, link, `clap` |
| `--version` | RSS de pico | 5.096 KB | idem |
| `--probe-startup` | menor tempo | 2.901 µs | tudo acima, mais runtime, credencial, disco, índice de sessão e MCP |
| `--probe-startup 250` | RSS de pico | 8.364 KB | idem, com a sessão parada |

O mínimo virou também o estimador do gate, e não só desta medição: num runner
compartilhado a mediana mede a contenção e o mínimo mede o programa. Os dois
lados do quociente relativo usam o mesmo estimador, porque comparar o nosso
mínimo contra a mediana do concorrente inflaria a razão a nosso favor.

Dois achados decidem o desenho. O primeiro é que **a sessão montada custa 4,9x
o que `--version` custa** em tempo, e é essa diferença que estava fora do gate.
O segundo é mais direto: **o RSS da sessão ociosa, 8.364 KB, já excede o piso
absoluto de 8.192 KB que o ADR-0012 fixou.** Não por regressão — por o piso ter
sido calibrado sobre uma carga que nunca aloca a sessão. Reaproveitá-lo para a
carga certa reprovaria no primeiro dia, o que é a prova aritmética de que os
dois números medem coisas diferentes.

## Decisão

O gate mede **duas cargas**, e cada uma responde pelo que sabe responder.

1. **`--probe-startup` é a carga de NFR-1 e NFR-2.** É a sessão montada de
   verdade, que é o que os dois requisitos descrevem. Ganha piso absoluto de
   **15.000 µs** de menor tempo e **14.336 KB** de RSS de pico.

2. **`--version` continua medido, como chegada do processo.** Ele mede exec,
   link e resolução de argumentos, que é uma métrica legítima e — o que importa
   aqui — a única com par comparável do outro lado. Mantém os pisos que o
   ADR-0012 lhe deu, absolutos e relativos, sem alteração.

As folgas dos pisos novos seguem a disciplina que o ADR-0012 já tinha adotado,
para que a barra signifique a mesma coisa nas duas cargas: 15.000 µs é 5,2x os
2.901 µs medidos, contra os 5x que o ADR-0012 usou em tempo; 14.336 KB é 1,7x
os 8.364 KB medidos, contra os 1,63x que ele usou em memória.

Três restrições acompanham a decisão.

1. **A carga da sonda tem piso absoluto e nenhum piso relativo.** O concorrente
   não expõe sonda equivalente, e comparar a montagem de sessão do `nycode`
   contra o `--version` do Codex compararia coisas diferentes. O ADR-0012 já
   estabeleceu que piso relativo sem medição do outro lado é ficção e deve ser
   retirado em vez de mantido; aqui ele nem chega a nascer.

2. **A costura é uma flag visível, não escondida.** `--probe-startup [MS]`
   aparece no `--help` e é documentada, porque é diagnóstico legítimo de quem
   investiga startup lento. Uma costura que só o gate usa é o que o
   [`coverage-gate-test.sh`](../../../scripts/coverage-gate-test.sh) evita de
   propósito, e o argumento vale aqui.

3. **O gate mede a sonda contra um workspace temporário e semeado**, com
   catálogo fresco em disco e credencial vinda do ambiente. A ida à rede é
   latência do gateway, não nossa, e o cofre do sistema depende do `dbus` da
   máquina. As duas ficam, portanto, fora do que este gate cobre — e o custo do
   catálogo frio permanece não medido em CI.

O intervalo de ociosidade é parâmetro da sonda porque as duas medições querem
coisas opostas: a latência quer sair no instante em que a sessão fica pronta, e
o pico de memória quer esperar o runtime e as conexões MCP assentarem.

## Consequências

Positivas: o número que o gate publica passa a ser o número que o requisito
descreve, e a distância entre os dois some. A folga de startup, que era de 50x
contra `--version` no gate original e continuaria sendo folga sobre a carga
errada depois do ADR-0012, passa a valer sobre o caminho que de fato paga
credencial, disco e processo. Uma regressão em `Context::discover`, no índice
da árvore de sessão ou no spawn de MCP agora tem onde aparecer — antes nenhuma
delas tinha. E o `--version` continua lá, de modo que a comparação competitiva
que o ADR-0012 construiu não se perde.

Negativas: a carga nova é muito mais exposta à variância de runner
compartilhado do que um `--version` que não toca disco nem processo, e o
ADR-0012 já apontava essa exposição como o risco mais provável de flakiness
mesmo na carga barata. O piso de 15.000 µs é generoso justamente por isso, o
que significa que ele detecta regressão grosseira e deixa passar a fina — a
alternativa seria um piso apertado que pisca. A calibração foi feita sob carga
alta, com o mínimo de 400 execuções no lugar da mediana, e apesar da validação
contra o número do ADR-0012 ela merece ser refeita em máquina quieta. O gate
ganha uma flag na superfície pública do binário. E o custo do catálogo frio
segue sem gate nenhum.

Descartadas: **manter só `--version`**, que é o que o ADR-0012 deixou de pé, e
que mede um caminho desenhado para ser trivial — o gate não pode reprovar
porque a carga não pode regredir. **Trocar `--version` pela sonda**, que
mediria a coisa certa ao custo de perder a única métrica com par comparável no
concorrente, e com ela metade do desenho do ADR-0012. **Reaproveitar os pisos
do ADR-0012 na carga nova**, que reprovaria em RSS no primeiro dia por 8.364
contra 8.192, sem nenhuma regressão ter acontecido. **Transformar o
`nycode-cli` em biblioteca para medir `session::prepare` em processo**, que
dispensaria a flag e perderia exec, link e construção do runtime — que são
startup tanto quanto o resto. **Subir um stub HTTP no gate para medir o
catálogo frio**, frágil em bash e medindo o stub junto. **Esconder a flag com
`hide = true`**, que economizaria uma linha de `--help` ao custo de tornar
inexplicável, para quem lesse o gate, de onde vem o número.

## Revisão

Este ADR é revisto se o piso da sonda reprovar por variância de runner em vez
de por regressão de código — duas ocorrências em PRs distintos sem mudança
relevante no caminho de montagem bastam, e a ação padrão é subir o piso
absoluto para a mediana observada no CI e registrar o número que a motivou. É
revisto quando a medição for refeita em máquina quieta, caso em que os dois
pisos da sonda descem para a folga que o número novo comportar. É revisto se o
concorrente passar a expor uma sonda comparável, caso em que a carga da sonda
ganha o piso relativo que hoje não tem. E é revisto se o custo do catálogo frio
deixar de ser aceitável como ponto cego: a saída, nesse caso, é medi-lo no
workflow agendado, que já tem gateway, e não no CI de PR, que não fala com a
rede.
