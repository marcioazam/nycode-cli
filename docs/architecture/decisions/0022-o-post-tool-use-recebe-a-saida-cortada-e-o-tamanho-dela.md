# ADR-0022: O `post-tool-use` recebe a saída cortada e o tamanho dela

- **Status:** aceito
- **Data:** 2026-08-13
- **Contexto relacionado:** [`spec.md`](../../../.specs/nycode-rs/spec.md) FR-7, FR-16, NFR-2, NFR-4, ADR-0009

## Contexto

O [ADR-0009](0009-hooks-sao-executaveis-com-contrato-json.md) desenhou quatro
eventos de hook. Três disparavam. `post-tool-use` ficou declarado no enum, fora
da lista de descoberta, e o comentário no código dizia por quê: **o contrato não
dizia quanto da saída da ferramenta chega ao hook**.

A pergunta não era retórica. Uma saída de ferramenta não tem tamanho conhecido
por ninguém no caminho: `bash` guarda 64 KiB por canal e derrama o excedente
para arquivo temporário, uma ferramenta de servidor MCP devolve o que o servidor
de terceiro quiser, e `read` traz uma janela de arquivo. O hook dispara **uma
vez por chamada de ferramenta**, e o orçamento de RSS do NFR-2 é de 14 MiB.

Enquanto isso, o custo de não entregar o evento é o que o FR-7 registrava como
lacuna: quem quer auditar o que o agente fez — o caso de uso central de um hook
de política — não tinha onde se pendurar.

## Decisão

**O hook recebe o começo da saída, cortado em 64 KiB, e o número de bytes de que
esse começo veio.** As duas coisas são o contrato, e nenhuma delas sozinha
serve: sem o corte, o payload tem o tamanho da saída de uma ferramenta, que
ninguém limita; sem o tamanho, o hook decide sobre um pedaço acreditando ter
lido tudo, que é a degradação silenciosa que o NFR-4 proíbe.

O corte reusa [`capped::Capped`](../../../crates/nycode-agent/src/capped.rs), que
já é o par "pedaço guardado + tamanho de origem" do repositório, inclusive o
tratamento de um caractere multibyte partido pelo teto.

Quatro consequências que são a decisão tanto quanto a escolha principal:

- **É pela frente, e não pela cauda.** `bash` guarda a cauda porque num comando
  o que decide o passo seguinte está no fim. O que chega ao hook é outra coisa:
  o resultado **já renderizado**, cujo começo é o que identifica a chamada — o
  aviso de confinamento e o `codigo de saida N` são as primeiras linhas do que a
  ferramenta devolve. O corte pela frente também é o que `Capped::text` sabe
  fazer sem produzir texto inválido.

- **O payload carrega `error`.** A distinção entre um resultado marcado como
  erro e um texto que descreve um erro é a que faz o modelo reagir diferente, e
  o repositório já a protege no `ToolOutput`. Achatá-la no caminho até o hook
  deixaria um hook de auditoria adivinhando pelo texto se o comando funcionou.

- **O evento não veta, e uma recusa é registrada em voz alta.** Quando ele roda,
  o arquivo já foi escrito e o comando já rodou. Obedecer a um `deny` seria
  inventar veto retroativo; ignorá-lo em silêncio deixaria quem escreveu o hook
  acreditando que ele protege alguma coisa. Vai para o `stderr` como aviso, que
  é onde o usuário lê o resto do que a sessão diz.

- **O evento só dispara depois de a ferramenta ter rodado.** Um veto do
  `pre-tool-use`, uma recusa do gate ou um nome de ferramenta desconhecido saem
  antes e não produzem `post-tool-use`: anunciar uso de ferramenta onde não
  houve uso faria um registro de auditoria descrever o que não aconteceu.

Uma correção que o contrato novo exigiu: **a escrita do payload no `stdin` do
hook passou a acontecer dentro do prazo**, junto com a leitura. O buffer de um
cano no Linux é de 64 KiB e este payload passa disso, então `write_all` espera o
hook ler — e, fora do prazo, um hook que não lê o `stdin` penduraria a chamada
de ferramenta sem teto nenhum. O defeito já existia para um `write` de conteúdo
grande; o evento novo o tornaria comum.

## Consequências

Positivas. O FR-7 fecha: os quatro eventos do ADR-0009 disparam, e o cabeçalho
da sessão passa a listar `post-tool-use` como os outros. O teto de memória do
caminho é constante e conhecido, e não uma função do que a ferramenta produziu.
Um hook que não existe não custa nada — quem dispara consulta `Hooks::has` antes
de montar o payload, porque montá-lo é copiar a saída da ferramenta.

Negativas. Um hook de auditoria que precise da saída inteira de um `cargo build`
verboso não a recebe, e não há como recebê-la por este caminho. O que sobra a
ele é o `output_total`, que diz que faltou, e o arquivo de excesso que o `bash`
já anuncia ao modelo. E o payload agora carrega até 64 KiB por chamada de
ferramenta, o que é trabalho de serialização real quando o hook existe.

Descartadas:

- **Passar a saída inteira.** É o orçamento de memória do NFR-2 devolvido ao
  chamador, com o multiplicador do escape JSON por cima, uma vez por chamada de
  ferramenta. Também produz um payload que o hook pode não conseguir ler.

- **Não passar saída nenhuma, só nome e argumentos.** Fecha a pergunta de
  memória sem custo e esvazia o evento: `pre-tool-use` já dá nome e argumentos,
  e um `post-tool-use` que não diz o que aconteceu é o mesmo evento disparado
  mais tarde.

- **Passar o caminho de um arquivo com a saída, em vez da saída.** Resolve o
  tamanho e cria dois problemas piores: um arquivo por chamada de ferramenta
  para alguém limpar, e uma saída de ferramenta legível por qualquer processo da
  máquina, quando ela pode conter o conteúdo de um arquivo do repositório.

- **Deixar o teto configurável.** Um número que o workspace escolhesse seria
  auto-certificante pela razão do
  [ADR-0016](0016-extensao-do-workspace-exige-consentimento.md); um número que o
  usuário escolhesse é mais uma superfície para um ganho que ninguém pediu
  ainda.

## Revisão

Reabre se aparecer um hook de auditoria real que precise de mais que 64 KiB, ou
se a medição mostrar o payload pesando no tempo de turno de um workspace com
hook instalado. A ação padrão no primeiro caso é a alternativa do arquivo, com o
problema de permissão resolvido antes — e não o aumento do teto, que só move a
linha de onde a saída passa a ser cortada.
