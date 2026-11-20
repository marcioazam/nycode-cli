# helpdesk

Tickets de suporte com validação, roteamento, busca e relatórios (Python 3, só biblioteca padrão).

```python
from datetime import date
from helpdesk import Desk

desk = Desk()
desk.submit(
    {
        "id": "T-1",
        "customer": {"name": "Ana", "email": "ana@example.com"},
        "subject": "Printer on fire",
        "created": "2024-03-09",
    },
    date(2024, 3, 10),
)
desk.search({"min_priority": "normal"})  # lista de tickets
desk.report()  # contagens
```

## Organização

| Caminho | Papel |
|---|---|
| `helpdesk/desk.py` | fachada `Desk` (`submit`, `search`, `get`, `report`, `escalate_all`, `notifications`, `rows`) |
| `helpdesk/constants.py` | prioridades, estados, planos, prazos e limites |
| `helpdesk/dates.py` | `parse_date` (ISO estrito) |
| `helpdesk/errors.py` | `HelpdeskError`, `ValidationError` (com `field`), `NotFoundError` |
| `helpdesk/intake/` | `canonicalize` (padrões e tipos da entrada) e `normalize_ticket` |
| `helpdesk/validation/` | `validate_ticket` e verificações pequenas |
| `helpdesk/routing/` | `assign`, `sla_deadline`, `escalate` |
| `helpdesk/store/` | `TicketStore` em memória |
| `helpdesk/search/` | `filter_tickets`, `sort_tickets` |
| `helpdesk/stats/` | `summarize`, `aging_buckets` |
| `helpdesk/notify/` | `render_notification`, `build_digest` |
| `helpdesk/export/` | `to_rows`, `dump_jsonl` |
| `helpdesk/cli/` | linha de comando |

Hoje (API v1) um ticket é um `dict` que passa por todas essas camadas. A migração para a API v2, com tipos, está
descrita em `docs/SPEC.md`.

## Linha de comando

```sh
python3 -m helpdesk.cli.main submit tickets.json
python3 -m helpdesk.cli.main search tickets.json '{"tier": "gold"}'
python3 -m helpdesk.cli.main report tickets.json
```

Códigos de saída: 0 ok, 1 uso incorreto, 2 erro nos dados.

## Testes

```sh
python3 -m pytest -q -p no:cacheprovider
```
