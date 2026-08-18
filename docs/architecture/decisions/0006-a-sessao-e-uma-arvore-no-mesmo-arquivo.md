# ADR-0006: A sessão é uma árvore gravada no mesmo arquivo append-only

- **Status:** aceito
- **Data:** 2026-08-13
- **Contexto relacionado:** [`spec.md`](../../../.specs/nycode-rs/spec.md) FR-5, FR-14

## Contexto

A sessão hoje é uma cadeia linear: `Store::append` acrescenta um `Record` com
`v`, `ts` e `message` ao fim de `<raiz>/.nycode/sessions/<id>.jsonl`, e
`Store::load` lê o arquivo inteiro na ordem em que foi escrito. O append-only é
uma decisão registrada no próprio módulo, e boa: reescrever o arquivo a cada
turno abre uma janela em que um crash trunca a conversa, enquanto acrescentar
uma linha por vez limita o pior caso ao último turno. Uma linha corrompida é
descartada com aviso.

O que falta é o que o `pi` chama de `/tree`. Lá, cada entrada tem `id` e
`parentId`, todos os ramos vivem num arquivo só, e o usuário volta a qualquer
ponto anterior e segue por outro caminho sem perder o que já existia. É a
diferença entre desfazer e ramificar, e é o que torna a compactação segura: a
compactação é lossy, mas o histórico completo continua no arquivo.

O conflito aparente é que branching parece exigir reescrita, que é justamente o
que o append-only evita.

## Decisão

A sessão passa a ser uma árvore, e continua append-only. `FORMAT_VERSION` sobe
de 1 para 2 e o `Record` ganha dois campos:

- `id` — identificador da entrada.
- `parent_id` — a entrada de que esta descende. Ausente na raiz.

Ramificar é acrescentar uma entrada cujo `parent_id` aponta para um ponto que
não é o fim do arquivo. Nada é reescrito, nada é apagado, e o pior caso de um
crash continua sendo a última linha.

O caminho ativo é derivado na leitura: a partir da folha mais recente, subir por
`parent_id` até a raiz e inverter. `Store::load` devolve o caminho ativo, que é
o que o loop de agente consome, de modo que o agente não sabe que existe árvore.

Registros `v: 1` são lidos como cadeia linear — cada um filho do anterior — sem
migração de arquivo. Um arquivo antigo continua funcionando e ganha estrutura de
árvore na primeira entrada nova.

## Consequências

Positivas: `/tree`, `/fork` e `/clone` passam a ser consultas sobre um dado que
já está no disco; a compactação deixa de ser destrutiva de fato, porque o
material elidido continua no arquivo; e a garantia de durabilidade que motivou o
append-only sobrevive intacta.

Negativas: `load` deixa de ser um `map` sobre linhas e passa a montar um índice
por `id` antes de resolver o caminho, o que é mais código e mais alocação num
caminho que roda no startup — NFR-1 precisa ser medido depois desta mudança, não
antes. O arquivo cresce com ramos que o usuário abandonou e nada os coleta.
Uma entrada cujo `parent_id` aponta para um `id` inexistente é um estado novo
que não existia no formato linear, e precisa de decisão explícita: vira raiz de
um ramo órfão, com aviso, pela mesma lógica que hoje descarta linha corrompida
sem invalidar a conversa.

Descartadas: **um arquivo por ramo**, que é mais simples de ler, rejeitado
porque multiplica arquivos por experimento abandonado e perde a propriedade de
que a sessão inteira é um objeto só — que é o que o `pi` acerta. **Reescrever o
arquivo ao ramificar**, rejeitado por reintroduzir a janela de truncamento que o
append-only fecha. **Manter linear e resolver com `--fork` copiando para uma
sessão nova**, rejeitado porque perde a navegação entre ramos, que é o valor da
feature; copiar continua existindo como `/clone`, ao lado da árvore e não no
lugar dela.

## Revisão

Reabrir se o custo de montar o índice no startup aparecer na mediana do
`perf-gate`, caso em que a saída é um índice lateral persistido, não voltar ao
formato linear. Reabrir também se arquivos de sessão crescerem a ponto de
incomodar em uso real, caso em que a resposta é poda explícita por comando, e
nunca automática.

## Emenda (2026-08-18)

Cada linha passa a carregar MAC HMAC-SHA256 e TTL (`AGT-07`). O arquivo
continua append-only; linha sem MAC, expirada ou de outro workspace não
entra no contexto do modelo. Isso não muda a árvore da ADR.

