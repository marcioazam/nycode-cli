# ADR-0021: Terminar um processo é sinalizar o grupo, não o líder

- **Status:** aceito
- **Data:** 2026-08-13
- **Contexto relacionado:** [`spec.md`](../../../.specs/nycode-rs/spec.md) FR-11, ADR-0015

## Contexto

`kill_on_drop` mata o processo direto, e só ele. Isso ficou invisível até a
suíte de testes medir o contrário: instrumentado com um orçamento de 60
segundos, o teste que afirma que um hook cortado pelo timeout para de escrever
assistiu à escrita continuar por **60 segundos inteiros** depois do corte. Não é
latência de desmontagem — é processo órfão.

O mecanismo que o torna sutil é o confinamento. Sob `bubblewrap --unshare-pid`,
o processo dentro do namespace é PID 1. `kill_on_drop` manda `SIGKILL` para o
`bwrap` externo, que morre, e o interno sobrevive — porque o sinal foi ao
processo externo e não ao que ainda escreve. Um hook roda a cada chamada de
ferramenta, então o que escapa se acumula ao longo da sessão, com acesso de
escrita ao workspace, depois de o harness ter dito ao modelo que interrompeu. A
mesma estrutura vale para o `bash`, que é o caminho que chega ao modelo.

A referência (`pi`) nunca teve esse defeito porque nunca confiou em matar o
líder: o spawn é `detached: true` e o término é `process.kill(-pid, "SIGKILL")`
— o sinal vai ao **grupo** inteiro. Um registro de filhos destacados os mata no
encerramento do processo, cobrindo o que um cancelamento deixou para trás.

## Decisão

**O filho nasce líder de um grupo de processo próprio, e terminar é sinalizar o
grupo.** `policy::process::detach` chama `setpgid(0, 0)` no filho entre o `fork`
e o `exec`, e `policy::process::kill` manda `SIGKILL` para o grupo. Vale para o
`bash` e para os hooks.

Uma restrição que é a decisão tanto quanto a escolha principal:

- **Sob bubblewrap, o `detach` não acontece.** O grupo ficaria no processo
  externo, e o processo dentro do namespace de PID é PID 1 e fica noutro grupo
  — sinalizar o grupo do externo não o alcançaria. Ali quem mata é o namespace,
  que cai com o `bwrap`. Detachar o caso confinado cobriria o caso errado e
  deixaria o certo aberto.

O `kill_on_drop` permanece ligado nos dois caminhos. Ele cobre o `drop` do
future — o cancelamento no despacho — enquanto `kill` cobre o término explícito
no fim normal. Um `ESRCH` de processo que já terminou não é erro.

## Consequências

Positivas. Terminar um comando passa a terminar o que ele iniciou, nas duas
formas que isso tem de fato: sem confinamento, pelo grupo; sob bubblewrap, pelo
namespace. O teste que media a corrida passa a passar pela correção e não por
tolerância — provado por oito execuções isoladas e três do workspace inteiro
sem falha, contra ~45% de falha antes.

Negativas. `rustix` ganha a feature `process` — já era dependência direta pelo
`fs` do ADR-0018, então o custo é o de uma chamada a mais e não o de uma crate.
E o grupo não recebe mais o `SIGINT` do terminal: `Ctrl+C` chega ao grupo de
frente do processo, e um filho destacado não está nele. É o preço declarado do
cancelamento por turno do ADR-0015 — quem larga o future é quem termina o grupo
— e por isso o comentário em `detach` o nomeia.

Descartadas:

- **Contar com o `kill_on_drop` sozinho**, sob bubblewrap. É o que estava
  escrito, e é o que produz o órfão medido.

- **Tirar `--unshare-pid` do perfil.** Fecha a janela do órfão sem custo de
  código, mas retira a propriedade que o perfil existe para dar: que terminar o
  `bwrap` leva junto tudo que ele contém. A correção certa é fazer o término
  alcançar o que inicia, não enfraquecer o confinamento para caber no término.

- **Um registro global de filhos destacados, como o da referência.** Cobre o
  processo que sobrevive ao *shutdown* do harness, que é um caso menor que o que
  este ADR fecha. Fica registrado como a peça que falta se um comando destacado
  por `nohup`/`setsid` próprio aparecer como reclamação medida.

## Revisão

Reabre se aparecer um caso real de processo destacado que escapa ao grupo — um
comando que chama `setsid` por conta própria. A ação padrão nesse caso é o
registro global de filhos que a referência mantém, morto no encerramento do
processo.

## Emenda, 2026-08-13

Duas correções, na mesma direção que as emendas dos ADRs 0005 e 0009: o que
estava escrito aqui e não correspondia ao código sobe ou desce até corresponder.

**A restrição "sob bubblewrap, o `detach` não acontece" nunca existiu no
código, e não deveria existir.** O raciocínio original supunha que o processo
dentro do namespace de PID ficasse noutro grupo, fora do alcance de um sinal ao
grupo do `bwrap` externo. Ele fica no mesmo: grupo de processo é herdado no
`fork`, e o `bwrap` não cria sessão nova — o perfil não passa `--new-session`.
Então `killpg` sobre o grupo do externo alcança o interno, e `detach` é
incondicional nos dois caminhos, como o comentário em `hooks::start_with` já
dizia e o teste da sentinela já provava. O texto acima fica como estava, com
esta emenda ao lado, porque ele é o registro do que se pensou na hora.

**O `kill_on_drop` não cobria o `drop` do future — cobria metade dele.** O texto
acima diz que ele "cobre o `drop` do future", e isso é verdade para o líder e
falso para o que o líder iniciou: o `Child::drop` do tokio manda `SIGKILL` ao
processo direto, que é exatamente o defeito que este ADR fechou no caminho do
prazo. O teste que existia não pegava porque o comando largado nele escreve por
conta própria, e ali matar o líder basta. Medido com um comando cujo neto é quem
escreve, a sentinela foi de 16 para 62 bytes **depois** do cancelamento.

A correção é uma guarda em `policy::process::GroupOnDrop`, armada em
`tools::bash::supervise` e desarmada no caminho normal. Ela dispara enquanto o
filho ainda não foi colhido, que é o que torna o número seguro de sinalizar — o
zumbi reserva o PID, que é também o identificador do grupo. Depois da colheita
sinalizar alcançaria quem o herdou, e é por isso que ela é desarmada em vez de
deixada armada por precaução.

**A peça que faltava foi feita.** O registro de filhos destacados, descartado
acima e nomeado na revisão, existe desde o
[ADR-0023](0023-o-registro-de-filhos-destacados-morre-com-o-processo.md) — com
duas diferenças em relação ao que este ADR imaginava. Não é global, é um valor
com dono, para que a varredura tenha teste. E a baixa acontece junto com a
colheita do filho e não depois dela, porque um registro que só cresce guarda PID
que o sistema já reciclou, e sinalizar um PID reciclado é matar processo de
terceiro. O caso que ele fecha não era o menor que este ADR supunha: é todo
`SIGTERM`, todo terminal fechado, e todo `SIGINT` numa sessão que não o consome.
