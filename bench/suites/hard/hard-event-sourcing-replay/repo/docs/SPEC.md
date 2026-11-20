# SPEC: snapshot e replay incremental

Objetivo: guardar um **snapshot** do estado e, depois, reconstruir o estado atual relendo só o que mudou, com
resultado **exatamente igual** (`==`, inclusive tipos: `set` continua `set`, `tuple` continua `tuple`) ao do
replay completo `replay_all(store)`. Eventos fora de ordem e repetidos fazem parte do problema. O
comportamento atual do replay completo, das projeções e dos formatos de estado não muda: `tests/` passa sem
alteração.

## Exceções (`stockflow.errors`)

| Classe | Bases | Situação |
|---|---|---|
| `StockflowError` | `Exception` | já existe |
| `InvalidEventError` | `StockflowError` | já existe |
| `ConflictingEventError` | `StockflowError` | nova (R2) |
| `SnapshotMismatchError` | `StockflowError` | nova (R14) |
| `InvalidSnapshotError` | `StockflowError`, `ValueError` | nova (R17) |

O texto das mensagens é livre.

## Regras

### Log idempotente (`InMemoryEventStore`)

**R1. Repetição exata é ignorada.** `append(event)` de um evento igual (`==`, todos os campos) a um já aceito
não faz nada: não entra em `all()` nem em `for_aggregate`, `len(store)` não muda e não levanta.

**R2. Conflito.** Depois de `validate_event` (um evento inválido levanta `InvalidEventError` antes de qualquer
outra checagem), `append` levanta `ConflictingEventError` e não grava nada quando: (a) já existe evento com o
mesmo `event_id` mas diferente em algum campo (inclusive `payload`); (b) já existe, no mesmo `aggregate_id`,
evento com a mesma `sequence` e outro `event_id`. O `event_id` é único no log todo: o mesmo id em outro
agregado é o caso (a).

**R3. `extend`.** Processa na ordem; repetições exatas dentro do lote são ignoradas; o primeiro erro se
propaga e os eventos anteriores do lote **permanecem** gravados.

**R4. `events_from(position)`.** Devolve uma lista nova com os eventos aceitos (na ordem de chegada) a partir do
índice `position` (`events_from(0)` é `all()`). `position` que não é `int` (nem `bool`), negativo ou maior que
`len(store)` levanta `ValueError`. Repetições ignoradas não ocupam posição.

### Snapshot

**R5. Modelo.** Pacote novo `stockflow.snapshots`, que exporta `Snapshot`, `AggregateSnapshot`,
`take_snapshot`, `update_snapshot`, `snapshot_state`, `replay_from`, `snapshot_to_dict`, `snapshot_from_dict`.
`Snapshot` é um `dataclass` imutável com `position: int` (quantos eventos do log estão cobertos),
`head_event_id: str | None` (o `event_id` do evento de índice `position - 1`; `None` se `position == 0`),
`projections: tuple[str, ...]` (os `name` das projeções usadas, na ordem recebida) e
`aggregates: dict[str, AggregateSnapshot]`. `AggregateSnapshot` (imutável) tem `state: dict`
(`{nome_da_projeção: estado}`, só as projeções aplicáveis ao agregado) e `last_sequence: int`.
`aggregates` tem uma entrada por agregado com ao menos um evento coberto, **inclusive o agregado cujos eventos
são todos de tipo desconhecido** (R12).

**R6. `take_snapshot(store, projections=None)`.** Snapshot de todo o log atual; `projections=None` usa
`default_projections()`. Log vazio: `position == 0`, `head_event_id is None`, `aggregates == {}`.

**R7. `update_snapshot(store, snapshot=None, projections=None)`.** Devolve um snapshot novo que cobre o log
inteiro, partindo de `snapshot` (e só lendo o que veio depois de `snapshot.position`). Com `snapshot=None` é
`take_snapshot`. **Invariante central:** para qualquer snapshot tirado de um prefixo do mesmo log,
`snapshot_state(update_snapshot(store, snapshot)) == replay_all(store)`, e o snapshot devolvido é `==` ao de
`take_snapshot(store)`.

**R8. `snapshot_state(snapshot)`.** Devolve `{aggregate_id: {nome_da_projeção: estado}}` com o mesmo formato
de `replay_all`, como **cópia profunda**: alterar o resultado não altera o snapshot.

**R9. `replay_from(store, snapshot, projections=None)`.** É `snapshot_state(update_snapshot(...))`.

### Fora de ordem, repetição e custo

**R10. Evento atrasado.** Para cada agregado com eventos novos: se algum evento novo tem `sequence` menor que
o `last_sequence` do snapshot (inclusive o que preenche um buraco: o snapshot tem 1 e 3 e chega o 2), o
agregado é recalculado **inteiro** com `store.for_aggregate(...)` e `canonical_order`. Só esses agregados
chamam `for_aggregate`.

**R11. Evento em ordem.** O agregado cujos eventos novos têm todos `sequence` maior que o `last_sequence`
continua do estado do snapshot: o `apply` das projeções roda **só** para os eventos novos (ordenados por
`sequence`, qualquer que seja a ordem de chegada no lote), sem reler os antigos. Agregado sem evento novo não
chama `apply` nem `for_aggregate`. Agregado novo parte de `initial()`.

**R12. Tipos desconhecidos.** Como no replay completo, evento de tipo fora de `KNOWN_TYPES` não é aplicado,
mas o agregado existe com os estados `initial()` e o evento conta para o `last_sequence`.

**R13. Imutabilidade.** `update_snapshot` e `replay_from` não alteram o snapshot recebido (nem os estados
dentro dele), e o snapshot devolvido não compartilha objetos mutáveis com o recebido. Chamar de novo com o mesmo
snapshot dá o mesmo resultado.

**R14. Snapshot incompatível.** `update_snapshot` (e portanto `replay_from`) levanta
`SnapshotMismatchError`, antes de aplicar qualquer coisa, quando: (a) `snapshot.projections` difere da tupla de
nomes das projeções usadas (a ordem conta); (b) `snapshot.position > len(store)`; (c) `position > 0` e o
`event_id` do evento de índice `position - 1` do log difere de `head_event_id`.

**R15. Encadeamento.** Atualizar um snapshot que já cobre o log todo devolve um snapshot `==` ao recebido e
não chama `apply`. Atualizar em etapas dá o mesmo que atualizar de uma vez.

### Serialização

**R16. JSON.** `snapshot_to_dict(snapshot)` devolve só `dict`, `list`, `str`, `int` e `None`, aceitável por
`json.dumps`. `snapshot_from_dict(json.loads(json.dumps(snapshot_to_dict(s)))) == s`: `set` e `tuple` dentro
dos estados voltam como `set` e `tuple` (por exemplo `history` de `movements`, `lines` de `totals`, `open` e
`closed` de `reservations`, `flags` de `status`).

**R17. Rejeições.** `snapshot_from_dict` levanta `InvalidSnapshotError` para: valor que não é `dict`; chave
ausente; versão de formato desconhecida (o dicionário carrega um campo `"version"`, hoje `1`); `position` que
não é `int` (nem `bool`) ou é negativo; `head_event_id` que não é `str` nem `None`; `projections` que não é
lista de `str`; `aggregates` que não é `dict`; `last_sequence` que não é `int >= 1`; `state` que não é `dict`.

### Pontos de chamada

**R18. Serviço.** `InventoryService.snapshot(previous=None)` devolve `update_snapshot(self.store, previous,
self.projections)`; `InventoryService.state(snapshot=None)` com snapshot devolve `replay_from(...)` e sem ele o
replay completo de hoje.

**R19. Relatórios.** `low_stock(store, threshold, projections=None, snapshot=None)` e
`order_summary(store, projections=None, snapshot=None)`: com `snapshot`, o estado vem de `replay_from`; o
resultado é igual ao sem snapshot.

**R20. CLI.** `snapshot <events.jsonl> <saida.json>` grava `json.dumps(snapshot_to_dict(s), sort_keys=True)`
em `<saida.json>`, imprime `position=<n>` e devolve 0. `resume <events.jsonl> <snapshot.json>` carrega o
snapshot e imprime o mesmo texto que `replay <events.jsonl>` imprimiria (o log pode ter crescido, repetido
eventos ou ter eventos fora de ordem desde o snapshot). Linhas repetidas no `.jsonl` seguem R1.

**R21. Códigos da CLI.** Snapshot ilegível ou inválido (JSON quebrado, R17), `SnapshotMismatchError` e
`ConflictingEventError` devolvem 2 com texto `error: ...`; número de argumentos errado devolve 1 com a linha
de uso; `replay` e `low-stock` seguem como hoje.

### Preservado

**R22. Compatibilidade.** `replay_aggregate`, `replay_all`, as projeções e o estado de cada uma não mudam; a
ordenação do replay completo continua por `sequence`; `tests/` passa sem alteração.
