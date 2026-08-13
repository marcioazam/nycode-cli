# ADR-0024: O grupo morre quando o líder sai, não quando o cano cala

- **Status:** aceito
- **Data:** 2026-08-13
- **Contexto relacionado:** [`spec.md`](../../../.specs/nycode-rs/spec.md) FR-11, ADR-0021, ADR-0023

## Contexto

O [ADR-0021](0021-terminar-e-sinalizar-o-grupo-nao-o-lider.md) estabeleceu que
terminar um comando é sinalizar o grupo. Ficou de fora *quando* sinalizar no
caminho em que o comando termina bem, e o que estava escrito não funcionava.

A drenagem lê cada cano até o EOF, e o EOF só chega quando a última ponta de
escrita fecha. Um neto destacado herda essa ponta: `sleep 30 & echo pronto` sai
imediatamente no líder e deixa o `sleep` segurando o `stdout` por trinta
segundos. O `collect` fazia `join!(reading, child.wait())` e chamava o término do
grupo **depois** do `join`, com um comentário afirmando que "a drenagem termina
por EOF ou quando o grupo morre, nunca por um cano quieto para sempre".

A afirmação estava errada por duas razões independentes, e as duas importam:

- **Ordem.** O `join!` não completa enquanto a drenagem não terminar. O sinal que
  a destravaria só sairia depois de ela ter se destravado sozinha — que é
  exatamente o que não acontece.
- **Número.** Mesmo que a ordem estivesse certa, o término era um no-op:
  `policy::process::kill` parte do `Child`, e depois do `wait` o tokio já colheu
  o filho, então `Child::id` devolve `None`. O próprio
  [ADR-0023](0023-o-registro-de-filhos-destacados-morre-com-o-processo.md)
  documenta essa propriedade, e um teste dele a demonstra.

O que sobrava contendo o caso era o prazo do comando, e o resultado medido é um
defeito de primeira ordem: o comando teve sucesso, o turno ficou preso os trinta
segundos inteiros, e o modelo recebeu `comando excedeu 30s e foi interrompido`.
Uma execução bem-sucedida reportada como estouro de prazo é pior que uma lenta —
ela leva o modelo a decidir o passo seguinte sobre um fato falso.

## Decisão

**O grupo é terminado no instante em que o líder sai, em paralelo com a
drenagem.** O identificador é guardado antes da espera, por
`policy::process::group_of`, porque depois da colheita não existe mais; e o
término usa `policy::process::terminate_group`, que parte do número e não do
`Child`, pelo mesmo motivo.

```rust
let group = crate::policy::process::group_of(&child);
let waiting = async {
    let status = child.wait().await;
    if let Some(group) = group {
        crate::policy::process::terminate_group(group);
    }
    status
};
let ((stdout, stderr), status) = tokio::join!(reading, waiting);
```

Sinalizar o grupo fecha a ponta de escrita que o neto segurava, a drenagem
recebe o EOF, e o `join` completa. O que já estava no buffer do cano não se
perde: fechar a ponta de escrita não descarta byte escrito, e a drenagem lê o
que restou antes do EOF. O teste assere as duas coisas — que o turno não é
segurado e que a saída do líder chega inteira.

## Consequências

Positivas. Um comando que deixa processo em segundo plano volta na hora, com a
saída certa e o status certo. O prazo do comando volta a significar o que diz —
um comando que de fato demorou — em vez de ser o piso de latência de qualquer
comando que use `&`.

Negativas. Um descendente que o usuário mandou para segundo plano de propósito é
terminado quando o líder sai. É a semântica que o ADR-0021 já tinha escolhido —
terminar o comando é terminar o que ele iniciou — aplicada também ao caminho de
sucesso, onde antes ela não chegava por acidente e não por decisão.

Descartadas:

- **Timer de ociosidade rearmado a cada chunk**, que é o que a referência faz
  (`waitForChildProcess`, pi#5303) e o que o plano desta rodada especificava.
  Falha nos dois extremos: trunca em silêncio um produtor lento mas vivo que
  passe da janela, e não contém o caso que motivou tudo — um neto que escreve
  continuamente nunca fica ocioso, então o turno segue preso. Terminar o grupo é
  determinístico e não depende de adivinhar quanto silêncio significa fim.

- **Deixar por conta do prazo do comando.** É o que estava valendo, e é o defeito
  medido.

- **Fechar a ponta de leitura em vez de sinalizar.** Daria EOF do lado certo sem
  matar ninguém, mas deixaria o neto vivo escrevendo no workspace depois de a
  ferramenta ter dito que o comando acabou — que é o que o ADR-0021 existe para
  impedir.

## Revisão

Reabre se aparecer necessidade real de um comando sobreviver deliberadamente à
chamada de ferramenta que o iniciou — subir um servidor de desenvolvimento que
siga de pé entre turnos, por exemplo. A ação nesse caso não é afrouxar o término,
é dar ao modelo uma forma explícita de pedir isso, para que o padrão continue
sendo terminar o que se iniciou.
