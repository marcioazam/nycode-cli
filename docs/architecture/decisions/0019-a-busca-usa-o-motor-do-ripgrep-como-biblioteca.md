# ADR-0019: A busca usa o motor do ripgrep como biblioteca, e o `.gitignore` decide o que é derivado

- **Status:** aceito
- **Data:** 2026-08-13
- **Contexto relacionado:** [`spec.md`](../../../.specs/nycode-rs/spec.md) FR-3, NFR-3, NFR-8

## Contexto

A ferramenta `grep` chamava-se `grep` e não era uma: a busca era
`haystack.contains(&needle)` sobre cada linha, com o padrão e a linha passados
por `to_lowercase` quando a busca era insensível. Um modelo que escrevesse
`fn \w+\(` recebia zero resultados sem nada dizer que o padrão não era
interpretado — a pior forma de falhar, porque parece que o termo não existe.

Três outros defeitos vinham junto. A varredura ignorava o `.gitignore` e usava
uma lista fixa de sete diretórios, que erra dos dois lados: não conhece o
diretório de saída que um projeto configurou, e esconde um `dist/` que alguém
versionou de propósito. `walk::files` materializava a lista inteira de até
20.000 caminhos **antes** de o primeiro casamento ser examinado, então o teto de
200 resultados limitava a resposta e não o trabalho. E a leitura era
`read_to_string` por arquivo, sem detecção de binário além da falha de UTF-8.

A referência (`pi`) resolve isso baixando os binários do `rg` e do `fd` do
GitHub em tempo de execução e chamando-os como processo — **sem verificar
digest**, e prependando o diretório de download ao `PATH` de todo comando de
shell. O caminho é conhecido e está fechado aqui: o `AGENTS.md` exige digest
verificado antes de executar artefato de terceiro (NFR-8).

## Decisão

**O motor do ripgrep entra como biblioteca**: `grep-searcher` e `grep-regex`
para a busca, `ignore` para a varredura, `globset` para o filtro de nome. Sem
processo externo, sem download, sem digest para verificar, e sem o custo de
`spawn` por chamada.

**O `.gitignore` do projeto decide o que é derivado.** A lista fixa sai. O
repositório já declara o que não é fonte, e essa declaração é mais precisa que
qualquer lista que este binário possa carregar. Continuam sempre fora: o `.git`,
que não está no `.gitignore` e que ninguém quer ler; e o `.gitignore` **global
do usuário**, que fica desligado porque faria a mesma pergunta ter respostas
diferentes em duas máquinas.

Três restrições que são a decisão tanto quanto a escolha principal:

- **A varredura é preguiçosa e determinística, e não paralela.** `ignore` oferece
  varredura paralela, e ela é incompatível com ordem estável. A ordem estável
  vence: uma resposta que muda entre execuções invalida o cache de prompt do
  backend (NFR-7) e faz o harness de paridade acusar divergência que não existe.
  A preguiça é o que substitui o paralelismo em ganho — a busca para de ler
  assim que atinge o teto, em vez de listar o repositório inteiro primeiro.

- **A varredura não sobe acima da raiz nem segue link para fora.** `parents` fica
  desligado, senão a busca leria `.gitignore` de diretórios acima do workspace,
  que é o que a contenção existe para não fazer; e `follow_links` fica desligado,
  senão um link contornaria a contenção de caminho sem passar por ferramenta.

- **Arquivo oculto é conteúdo.** O padrão do `ignore` é pular o que começa com
  ponto, e aqui isso deixaria o agente cego para `.claude/`, `.github/` e o
  resto da configuração que o repositório declara sobre si mesmo.

## Consequências

Positivas. `grep` passa a ser regex de verdade, com a mesma sintaxe que o
usuário já conhece do ripgrep, e um padrão inválido diz o que está errado em vez
de devolver zero resultados. A detecção de binário passa a ser por byte nulo, e
não por falha de UTF-8 — um arquivo cheio de nulos é UTF-8 válido e antes
passava. `find` e `ls` herdam o mesmo `.gitignore`, então as três param de
divergir sobre o que existe no workspace.

Negativas, e o número é o que pesa. O binário foi de 12.101.720 B para
13.587.008 B: **1,42 MiB**, de uma folga de 4,46 MiB, sobrando 3,04 MiB. O
startup da sessão montada foi de 2.677 µs para 3.504 µs e o RSS ocioso de
8.776 KB para 9.752 KB, ambos por páginas a mais para mapear, ambos ainda longe
dos pisos. Quem paga é o próximo requisito que precisar de espaço no binário, e
isso é uma decisão de orçamento que este ADR gasta.

A segunda negativa não tem número. Um workspace **sem** `.gitignore` e **sem**
git — um diretório de rascunho com `node_modules` dentro — passa a ter esses
arquivos varridos, onde a lista fixa os pulava. O teto de 20.000 arquivos impede
que a resposta exploda, mas não impede que ela fique inútil. É o preço de trocar
uma regra que erra silenciosamente por uma que o projeto controla.

Descartadas:

- **Baixar `rg` e `fd`, como a referência faz.** Resolve a capacidade sem custo
  de binário e traz três problemas: artefato de terceiro executado sem digest
  verificado, o que o NFR-8 proíbe; dependência de rede no primeiro uso; e o
  diretório de download no `PATH` de todo comando de shell.

- **Manter o motor próprio e só acrescentar `.gitignore` e parada antecipada.**
  Custo zero de binário, e mantém a mentira do nome: `grep` continuaria não
  sendo regex. Reimplementar a semântica de `.gitignore` à mão — precedência,
  negação, âncora, `**` — é a parte difícil, e é justamente a que o `ignore`
  entrega pronta e testada.

- **Varredura paralela.** Descartada pela ordem estável, como acima. Se o tempo
  de busca virar reclamação real, a saída é paralelizar mantendo determinismo:
  buscar em paralelo, ordenar por caminho e cortar depois — ao preço de perder a
  parada antecipada.

## Revisão

Duas coisas reabrem este ADR. Se o orçamento de binário ficar apertado por outro
requisito, os 1,42 MiB voltam à mesa, e a ação padrão é medir quanto sai
desligando `simd-accel` e trocando `grep-regex` por uma busca literal com
`memchr` para o caso comum. E se aparecer reclamação de workspace sem
`.gitignore` sendo varrido por inteiro, a ação padrão é uma lista fixa aplicada
**só** quando o workspace não declara nada — nunca por cima do que ele declarou.
