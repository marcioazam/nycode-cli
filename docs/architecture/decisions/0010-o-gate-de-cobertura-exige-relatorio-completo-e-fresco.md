# ADR-0010: O gate de cobertura exige relatório completo e fresco

- **Status:** aceito
- **Data:** 2026-08-13
- **Contexto relacionado:** [`spec.md`](../../../.specs/nycode-rs/spec.md) NFR-5;
  estende o [ADR-0003](0003-pisos-de-cobertura-95-agregado-90-por-arquivo.md) sem
  alterar nenhum dos dois pisos

## Contexto

O [ADR-0003](0003-pisos-de-cobertura-95-agregado-90-por-arquivo.md) fixou dois
pisos duros — 95% agregado e 90% por arquivo de produção — e o argumento que
sustenta o segundo é que **o agregado esconde a própria distribuição**. Um
arquivo pequeno no chão custa ao agregado um erro de arredondamento enquanto é
exatamente o código que ninguém exercitou.

O que não estava dito é que os dois pisos só alcançam o que o relatório contém.
O [`coverage-gate.sh`](../../../scripts/coverage-gate.sh) iterava sobre
`.data[0].files[]`, então um arquivo de produção ausente do relatório não era
reprovado: ele simplesmente não era examinado. Ausência lia-se como aprovação.

A demonstração foi acidental e vale mais que o argumento. Rodando o gate contra
o `coverage.json` que estava no diretório de trabalho, ele imprimiu 97,95% e
"ambos os pisos satisfeitos" enquanto
[`crates/nycode-agent/src/context/commands.rs`](../../../crates/nycode-agent/src/context/commands.rs)
— 369 linhas, os slash commands do FR-13 — não tinha sido medida uma única vez.
O relatório era três minutos mais velho que o arquivo. Não houve má-fé nem
configuração exótica: bastou editar código depois de gerar o relatório, que é a
ordem natural de trabalho de quem roda a bateria localmente.

A ausência tem três causas que o gate não distinguia e que merecem tratamento
diferente. O arquivo pode não ter uma única linha instrumentada — é o caso do
glue de módulo, que só declara `mod` e reexporta. Pode ter sido excluído por um
`cfg` que nunca compila na configuração medida. Ou o relatório pode ter sido
gerado antes dele existir. As duas primeiras são fatos declaráveis; a terceira é
erro de uso. Nenhuma das três é aprovação.

## Decisão

Antes dos dois pisos, o gate verifica duas propriedades do relatório. Ambas
falham fechado, como tudo no gate.

1. **Frescor.** Um relatório mais velho que qualquer `.rs` sob `crates/*/src/`
   é recusado com a instrução de regenerar. Sai com `2`, o mesmo código do
   relatório ausente, porque é erro de uso e não violação de piso — a diferença
   importa para quem lê o CI.
2. **Completude.** Todo arquivo de produção presente em disco precisa ter
   entrada no relatório ou uma declaração `no-statements` na
   [tabela de exemptions](../../../scripts/coverage-exemptions.txt). Sai com `1`,
   como qualquer violação de piso.

O `no-statements` não é dispensa: ele declara que o instrumentador não alcança
aquele arquivo, e ratcheta como as demais entradas — no dia em que o arquivo
ganhar uma linha instrumentada, a entrada obsoleta reprova o gate e o piso de
90% passa a valer para ele. A tabela ganhou treze entradas, doze de glue de
módulo e uma de [`nycode-auth/src/lib.rs`](../../../crates/nycode-auth/src/lib.rs),
cujo único código executável é o `Display` de `#[derive(thiserror::Error)]`: a
expansão carrega `#[automatically_derived]` e o instrumentador do rustc não marca
código derivado, então o relatório não atribui uma única função ao arquivo. A
mensagem que ele produz — a que o usuário lê quando falta credencial — continua
assertada em `resolver::tests::the_error_names_every_way_to_supply_the_credential`.
A tabela continua sem nenhuma entrada `below-floor`, que é a que dispensa código
medido de alcançar o piso, e a intenção declarada no ADR-0003 de mantê-la vazia
segue valendo.

Na mesma passagem, `is_production` passou a excluir `*_tests.rs` além de
`*_test.rs`. Não é ajuste cosmético: `session/store/tree_tests.rs` são 220 linhas
de `#[cfg(test)] mod` que o filtro tratava como produção por não casar com
nenhum dos padrões, e a verificação de completude o teria reprovado por não estar
num relatório onde ele nunca deveria estar.

O gate também deixou de ser código sem teste. A
[bateria](../../../scripts/coverage-gate-test.sh) monta repositórios sintéticos,
roda o gate real sobre eles e exige o código de saída em quinze casos — os dois
pisos isolados um do outro, as duas verificações novas, os três ratchets e o
vocabulário de `kind`. Ela roda no CI antes da medição, porque custa segundos
enquanto a medição custa minutos.

## Consequências

Positivas: "90% em cada arquivo de código" passa a ser literal em vez de "90% em
cada arquivo que apareceu no relatório". O modo de falha mais barato que existia
— criar um arquivo que o relatório não alcança — deixa de existir sem deixar
rastro. E o relatório defasado, que é o erro que qualquer um comete rodando a
bateria local na ordem natural, para de aprovar código não medido.

Negativas: editar um comentário num fonte invalida o relatório e obriga a
regenerar, o que no fluxo local custa a espera da medição inteira. É atrito real
e deliberado: a alternativa é confiar num relatório que descreve outro código.
Arquivo novo de glue de módulo passa a exigir uma linha na tabela de exemptions,
o que é fricção proporcional mas não é zero. E a verificação de frescor depende
de mtime, que é frágil sob `git checkout` de um branch antigo ou restauração de
cache que remarque fontes — o falso positivo pede regeneração, nunca aprova
indevidamente, então erra para o lado certo.

Descartadas: **detectar o glue por heurística no fonte**, aceitando a ausência
quando o arquivo não contém `fn` — erra em `const fn`, em código gerado por
macro e no caso do `Display` derivado que motivou uma das treze entradas, e
troca uma declaração explícita por uma adivinhação que ninguém revisa em PR.
**Uma lista separada de arquivos sem statements**, só para preservar a
propriedade estética de "tabela de exemptions vazia" — coloca a mesma classe de
informação em dois arquivos com dois ratchets, e a propriedade que importa é a
tabela sem `below-floor`, que continua valendo. **Comparar hash de fonte em vez
de mtime**, mais robusto contra remarcação, mas exige o gate guardar estado entre
execuções, e um gate com estado tem um modo de falha novo — estado obsoleto —
para resolver um problema cujo pior caso é pedir uma regeneração a mais.
**Fazer o próprio gate invocar `cargo llvm-cov`**, o que eliminaria a questão do
frescor por construção, mas confunde medir com julgar e tiraria do CI a
possibilidade de reaproveitar um relatório já produzido.

## Revisão

Este ADR é revisto se a tabela de `no-statements` passar de vinte entradas, o que
indicaria que o critério do instrumentador e o de "arquivo de produção" divergiram
o bastante para merecer outro desenho. É revisto também se a cobertura passar a
ser medida só sobre produção, a dívida que o ADR-0003 registra e o
[roadmap](../../product/ROADMAP.md) mantém aberta: excluir os `mod tests` inline
por região muda quais arquivos aparecem no relatório e, portanto, o significado
da verificação de completude.
