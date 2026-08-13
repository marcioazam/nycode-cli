# ADR-0023: O registro de filhos destacados morre com o processo

- **Status:** aceito
- **Data:** 2026-08-13
- **Contexto relacionado:** [`spec.md`](../../../.specs/nycode-rs/spec.md) FR-11, NFR-4, ADR-0015, ADR-0021

## Contexto

O [ADR-0021](0021-terminar-e-sinalizar-o-grupo-nao-o-lider.md) fez o filho nascer
líder de um grupo próprio e o término sinalizar o grupo. Ele também declarou o
preço: **o grupo deixa de receber o `SIGINT` do terminal**, porque `Ctrl+C` chega
ao grupo de frente e um filho destacado não está nele. Quem termina o grupo
passa a ser quem larga o future.

Isso cobre o estouro de prazo e o cancelamento por turno. Não cobre o caso em
que o processo `nycode` inteiro morre: `SIGTERM` de um `kill`, `SIGHUP` de um
terminal fechado, `SIGINT` numa sessão que não o consome. Ali **nenhum `drop`
roda** — nem o `kill_on_drop`, nem o término do grupo — e o filho destacado
sobrevive ao pai, com escrita no workspace, depois de o harness ter sumido. É a
mesma família do defeito que o ADR-0021 mediu, pela porta que ele deixou aberta
e nomeou na seção de revisão.

Duas coisas tornam isso mais que teórico. Um hook dispara a cada chamada de
ferramenta, então o que escapa se acumula. E `panic = "abort"` no perfil de
release significa que nem um pânico desenrola pilha.

## Decisão

**Um registro dos filhos destacados que este processo subiu e ainda não colheu,
varrido quando um sinal de término chega.** Três escolhas o definem, e cada uma
fecha um modo de falha diferente.

**O registro é um valor com dono, não um estático.** `policy::process::Registry`
é um tipo comum; `policy::process::shared()` é a instância que o processo usa. A
diferença não é estética: a varredura precisa de teste, e varrer a instância do
processo dentro da suíte mataria os filhos dos testes correndo ao lado. Com o
tipo aberto, o teste que prova a morte do neto usa um registro próprio. É o que
o [ADR-0003](0003-pisos-de-cobertura-95-agregado-90-por-arquivo.md) chama de
abrir costura em vez de dispensar o arquivo.

**A baixa sai junto com a colheita, nunca depois dela.** `Registry::track`
devolve uma anotação que se remove sozinha no `drop`, e ela é declarada depois
do `Child` — então o compilador garante que sai antes dele, inclusive quando o
future é largado no meio. Isso é o que impede o defeito mais sério possível
aqui: enquanto o líder não é colhido, o zumbi reserva o PID, que é também o
identificador do grupo, então a varredura só alcança processo que este harness
subiu. Um registro que só crescesse guardaria número que o sistema já entregou a
outra pessoa, e sinalizá-lo seria matar processo inocente.

**Quem dispara a varredura é uma tarefa do runtime, não um handler de sinal.**
`tokio::signal` entrega o sinal como um stream assíncrono; o que roda no handler
de verdade é a escrita de um byte num cano, que é async-signal-safe. A varredura
acontece depois, numa tarefa comum, onde tomar um cadeado e chamar `killpg` é
código normal. Escrever um handler próprio significaria fazer isso tudo dentro
das restrições de async-signal-safety, para reimplementar o que a dependência já
tem.

`SIGINT` entra na lista **só onde ninguém já o usa**: em headless
`session::watch_for_interrupt` o consome para cancelar o turno (ADR-0015), e
numa sessão interativa o terminal está em modo bruto e `Ctrl+C` chega como
tecla. Escutá-lo nos dois lugares faria a mesma interrupção cancelar o turno e
matar o processo.

A saída usa `128 + número do sinal`, a mesma convenção de `exit::CANCELLED`. Uma
varredura que encontre algo diz quantos terminou, no `stderr`: terminar processo
do usuário em silêncio esconderia justamente o fato que o registro produz.

## Consequências

Positivas. O caminho que sobrava do ADR-0021 fecha: um `SIGTERM` no harness leva
junto o comando e o hook que estavam de pé, com o neto de cada um, porque o
sinal vai ao grupo. Os dois chamadores de `detach` — `bash` e os hooks — entram
pelo mesmo ponto, e um terceiro que apareça sem anotar não é coberto, o que é
visível numa revisão de duas linhas.

Negativas. O binário passa a observar `SIGTERM` e `SIGHUP`, que antes tinham a
disposição padrão. Uma sessão interativa morta por sinal continua deixando o
terminal em modo bruto — o `Raw` vive no caminho de saída normal e a tarefa de
sinal não o alcança —, o que não é regressão porque o sinal já matava o processo
sem restaurar nada, mas também não foi resolvido aqui.

E o que a varredura fecha continua sendo uma janela, não uma garantia:
`SIGKILL` no harness não roda nada, e ali o filho destacado sobrevive. Não há
como cobrir isso do lado do pai.

Descartadas:

- **Um estático global, como o da referência.** É o desenho óbvio, e o custo é
  que a varredura deixa de ter teste: não dá para exercitá-la sem varrer o
  estado do processo que roda a suíte. O tipo com dono custa uma função a mais e
  devolve o teste que prova a morte do neto.

- **Dar baixa antes de esperar o filho, para nunca guardar um PID colhido.**
  Fecha por construção a janela de reciclagem — e abre uma pior: entre a baixa e
  o fim do comando, que dura o comando inteiro, o filho fica **fora** da
  varredura. Trocar uma janela de microssegundos por uma de noventa segundos é o
  negócio errado.

- **Validar o dono do PID antes de sinalizar**, por `/proc/<pid>/stat`. Cobre a
  reciclagem sem depender da ordem, e é Linux apenas: no macOS não existe
  `/proc`, e o caminho ficaria com garantias diferentes por plataforma sem que
  nada no código dissesse isso.

- **Varrer também no fim normal da sessão.** No caminho normal cada anotação já
  saiu sozinha, então a varredura ali nunca encontra nada. Uma linha que não
  pode fazer efeito é decoração, e decoração num caminho de encerramento é o
  tipo de código que alguém acredita estar protegendo algo.

## Revisão

Reabre se aparecer processo destacado que escapa **ao grupo** — um comando que
chame `setsid` por conta própria —, porque aí nem a varredura o alcança e a ação
passa a ser rastrear descendência em vez de grupo. Reabre também se o
`SIGTERM` observado atrapalhar algum supervisor que espere a disposição padrão:
a ação nesse caso é varrer e **re-emitir** o sinal com a disposição padrão
restaurada, em vez de sair com o código convencionado.
