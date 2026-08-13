# ADR-0018: A contenção de caminho é imposta na abertura, não na validação

- **Status:** aceito
- **Data:** 2026-08-13
- **Contexto relacionado:** [`spec.md`](../../../.specs/nycode-rs/spec.md) FR-3, FR-11, NFR-8

## Contexto

`ToolContext::resolve` decide se um caminho pedido pelo modelo está dentro da
raiz do workspace, e decide certo: normaliza componentes, barra `..` que suba
além da raiz, e canonicaliza o ancestral existente mais próximo para pegar link
simbólico que aponte para fora. O CHANGELOG registra o fechamento dessa última
brecha.

O que ele não faz é fazer a decisão valer. `resolve` devolve um `PathBuf`, e
quem chama reabre por caminho depois: `read` em `capped::read`, `write` e `edit`
em `tokio::fs::write`. Entre a validação e a abertura o caminho pode passar a
apontar para outro lugar — basta um componente virar link simbólico nesse
intervalo. É a classe de defeito conhecida como TOCTOU.

O intervalo não é teórico e não é curto. Em `edit` ele vai da leitura do arquivo
até a escrita, com a contagem de ocorrências no meio; em `write`, da criação dos
diretórios intermediários até a escrita. Um repositório que o agente clonou pode
conter o processo que faz a troca, e o `bash` sob permissão ampla é uma forma
direta de agendá-la.

A referência (`pi`) não oferece precedente aqui: ela não tem contenção de
caminho nenhuma — `read`, `write`, `edit` e `bash` aceitam caminho absoluto e
`../` sem checar raiz. O único uso de `realpath` no caminho de uma ferramenta,
em `file-mutation-queue.ts`, é para serializar mutações concorrentes, não para
conter.

## Decisão

**A resposta da contenção é um descritor de arquivo, não um caminho.** As
ferramentas de arquivo passam a abrir por `tool::contain`, que resolve o caminho
uma vez sob a restrição de não sair da raiz e devolve o objeto aberto. Não há
segunda resolução para envenenar.

Três restrições que são a decisão tanto quanto a escolha principal:

- **A garantia é `RESOLVE_BENEATH` do `openat2`, e não `O_NOFOLLOW`.** Um link
  simbólico que aponta para dentro da raiz é uso legítimo e continua
  funcionando; o repositório já tinha esse comportamento e um teste que o
  protege. `O_NOFOLLOW` componente a componente recusaria esse caso, trocando
  uma corrida difícil de explorar por uma quebra certa.

- **Onde `openat2` não existe, a abertura volta a ser por caminho, e o módulo
  diz que é menos.** Núcleo anterior ao 5.6, filtro de chamadas de contêiner que
  ainda não o liberou, ou sistema que não é Linux. A validação léxica de
  `resolve` continua valendo ali; a atomicidade, não. Distinguir "o núcleo não
  conhece a chamada" de "o núcleo recusou o caminho" é obrigatório: tratar
  recusa como ausência de suporte cairia no caminho sem contenção justamente
  quando a contenção acabou de funcionar.

- **Diretório intermediário é criado componente a componente a partir da raiz.**
  `create_dir_all` sobre o caminho inteiro resolve link em cada nível na hora em
  que chega nele. O arquivo em si não escaparia, porque a abertura final é
  contida — mas criar diretório fora do workspace já é escrever fora dele.

`resolve` continua existindo e continua sendo chamado primeiro. Ele é o que
produz a mensagem de erro que o modelo entende — "caminho fora da raiz" em vez
de um `EXDEV` do núcleo — e é o que cobre o carregamento de contexto, que lê do
disco antes de haver contexto de ferramenta.

## Consequências

Positivas. A janela entre a decisão e o efeito deixa de existir no Linux, que é
onde o gate de performance e o confinamento do FR-11 já são medidos. A costura
`contain` é testável sem disco de verdade sob privilégio: os dois testes de
corrida montam a troca explicitamente e falhariam com abertura por caminho, o
que é a prova de que a proteção está ligada e não apenas presente.

Negativas. `rustix` vira dependência direta de `nycode-agent` — já estava na
árvore por `crossterm` e `keyring`, então o custo em bytes é o do módulo `fs` e
não o da crate, mas a superfície de dependência direta cresceu. A garantia passa
a ser diferente por plataforma, e um `nycode` em macOS tem contenção mais fraca
que um em Linux sem que nada na interface diga isso. E a abertura é síncrona
dentro de função assíncrona; é uma chamada de sistema sobre caminho local, do
mesmo custo do `is_dir` que as ferramentas já pagavam ao lado, mas é uma dívida
registrada e não uma omissão.

Descartadas:

- **Comparar `(dev, ino)` antes e depois da abertura.** Portátil e sem
  dependência nova, mas fecha só a janela do último componente: um diretório
  intermediário trocado continua levando para fora, e o arquivo aberto seria
  legitimamente o que se mediu.

- **`cap-std`, que dá capacidade de diretório com interface segura e
  multiplataforma.** É a resposta mais completa e foi rejeitada pelo tamanho: é
  uma árvore de dependências nova, com o orçamento de binário em 4,5 MiB de
  folga e o motor de busca já reservando parte dela. Volta à mesa se a folga
  crescer ou se o suporte a macOS deixar de ser secundário.

- **`RESOLVE_IN_ROOT` em vez de `RESOLVE_BENEATH`.** Trataria a raiz como `/` e
  faria `..` na raiz apontar para ela mesma, em vez de recusar. Mais permissivo
  sem ganho: `resolve` já barra `..` lexicamente, e recusar dá mensagem melhor
  que silenciosamente reinterpretar.

## Revisão

Três coisas reabrem este ADR. Se o macOS deixar de ser plataforma secundária, a
assimetria de garantia passa a ser um defeito e a ação padrão é adotar
`cap-std`. Se o orçamento de binário ganhar folga suficiente, o mesmo. E se
`openat2` passar a ser recusado com frequência em ambientes reais de contêiner
— o caminho de `EPERM` —, o silêncio da degradação vira problema: a ação padrão
passa a ser dizer ao usuário, na abertura da sessão, que a contenção está no
modo fraco, como o FR-11 já exige do confinamento do shell.
