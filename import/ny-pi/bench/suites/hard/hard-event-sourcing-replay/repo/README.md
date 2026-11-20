# stockflow

Estoque e pedidos reconstruídos a partir de um log de eventos (Python, só biblioteca padrão).

## Mapa

| Caminho | Papel |
|---|---|
| `stockflow/events/` | `Event`, validação, codec JSON, tipos conhecidos, `canonical_order` |
| `stockflow/store/memory.py` | `InMemoryEventStore`: log em memória, na ordem de chegada |
| `stockflow/projections/` | redutores por agregado (`stock/`, `orders/`, `audit/`) e o conjunto padrão |
| `stockflow/replay/full.py` | `replay_aggregate`, `replay_all`: relê tudo e recalcula |
| `stockflow/services/` | `InventoryService` e relatórios (`low_stock`, `order_summary`) |
| `stockflow/cli/main.py` | linha de comando sobre um arquivo `.jsonl` |
| `stockflow/errors.py` | exceções públicas |

## Modelo

Um evento pertence a um agregado (`sku:<código>` ou `order:<número>`) e tem `sequence` (posição dentro do
agregado, a partir de 1). Os eventos de um agregado são aplicados em ordem de `sequence`, não de chegada; tipos
desconhecidos são ignorados. Cada projeção reduz os eventos a um estado que é alterado no lugar.

`replay_all(store)` devolve `{aggregate_id: {nome_da_projeção: estado}}`.

## CLI

`python3 -m stockflow.cli.main replay <events.jsonl>` imprime o estado em JSON (conjuntos viram listas
ordenadas, tuplas viram listas); `low-stock <events.jsonl> <limite>` lista SKUs. Códigos de saída: 0 ok, 1 uso
incorreto, 2 erro nos dados (`error: ...`).

## Estado atual e mudança planejada

Hoje todo replay é completo e o log aceita repetições. O alvo (snapshot, replay incremental e idempotência) está
em `docs/SPEC.md`.

## Testes

```bash
python3 -m pytest -q -p no:cacheprovider tests
```
