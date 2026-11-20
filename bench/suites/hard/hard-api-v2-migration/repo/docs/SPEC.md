# Especificação: migração da API v1 (dicts) para a API v2 (tipos)

## Situação atual (v1)

Um ticket é um `dict` que atravessa todas as camadas: `intake`, `validation`, `routing`, `store`, `search`,
`stats`, `notify` e `export` recebem e devolvem dicts, comparam textos (`"urgent"`, `"open"`, `"enterprise"`) e
guardam datas como texto ISO. O formato do dict (o "dict v1") é o que `helpdesk.intake.canonicalize` devolve hoje:

```python
{
    "id": "T-1",
    "customer": {"name": "Ana", "email": "ana@example.com", "tier": "standard"},
    "subject": "Printer on fire",
    "body": "",
    "priority": "normal",
    "tags": ["net"],
    "status": "open",
    "created": "2024-03-09",
    "assignee": None,
    "history": [{"at": "2024-03-10", "event": "assigned:ana"}],
    # mais as chaves desconhecidas que vieram na entrada, no nível de cima
}
```

## Objetivo (v2)

Dentro do pacote só circulam objetos tipados e imutáveis. O dict v1 continua existindo **apenas nas bordas**:
`Desk.submit`, `Desk.search`, a linha de comando, `canonicalize`, `Ticket.from_dict`/`to_dict`,
`Criteria.from_dict`, `Summary.to_dict` e `dump_jsonl`. Nenhuma regra de negócio muda: para a mesma entrada, as
bordas produzem exatamente o que produzem hoje (a única exceção, sobre critérios de busca, está em R9).

Só biblioteca padrão. As regras abaixo são numeradas; todas valem.

## Tipos: pacote `helpdesk.models`

**R1. Exportações.** `helpdesk.models` exporta `Priority`, `Status`, `Tier`, `Customer`, `HistoryEntry`,
`Ticket`, `Criteria` e `Summary` (`from helpdesk.models import Ticket` funciona).

**R2. Enumerações.** `Priority` é um `enum.IntEnum` com `LOW = 1`, `NORMAL = 2`, `HIGH = 3`, `URGENT = 4`
(comparável com `<`, `>=` etc.). `Status` é um `enum.Enum` com os membros `OPEN`, `PENDING`, `RESOLVED`, `CLOSED`.
`Tier` é um `enum.Enum` com os membros `STANDARD`, `GOLD`, `ENTERPRISE`. Todo membro das três tem a propriedade
`label`: o texto v1 em minúsculas (`Priority.HIGH.label == "high"`, `Tier.GOLD.label == "gold"`). `Status` tem
ainda a propriedade `is_open`: `True` só para `OPEN` e `PENDING`.

**R3. `parse`.** As três enumerações têm o método de classe `parse(value)`: aceita só `str`, ignora espaços nas
pontas e a caixa (`Priority.parse(" HIGH ") is Priority.HIGH`) e devolve o membro. Qualquer outro valor (texto
desconhecido, `None`, número, lista) levanta `helpdesk.errors.ValidationError` com a mensagem
`"<campo> must be one of <labels separados por ', '>"` e `field == <campo>`, em que `<campo>` é `priority`,
`status` ou `customer.tier`. Exemplo: `"customer.tier must be one of standard, gold, enterprise"`.

**R4. `Customer` e `HistoryEntry`.** Dataclasses congeladas (`frozen=True`). `Customer(name, email,
tier=Tier.STANDARD)` e `HistoryEntry(at, event)`, nessa ordem posicional; `at` é um `datetime.date`.

**R5. `Ticket`.** Dataclass congelada com estes campos e padrões:

| Campo | Tipo | Padrão |
|---|---|---|
| `id` | `str` | obrigatório |
| `customer` | `Customer` | obrigatório |
| `subject` | `str` | obrigatório |
| `created` | `datetime.date` | obrigatório |
| `priority` | `Priority` | `Priority.NORMAL` |
| `status` | `Status` | `Status.OPEN` |
| `body` | `str` | `""` |
| `tags` | `tuple` de `str` | `()` |
| `assignee` | `str` ou `None` | `None` |
| `history` | `tuple` de `HistoryEntry` | `()` |
| `extra` | `dict` (chaves desconhecidas da entrada) | `{}` (um dict novo por ticket) |

A igualdade é por valor (a do dataclass). Atribuir a um campo levanta `dataclasses.FrozenInstanceError`.
Para "alterar" um ticket cria-se outro (`dataclasses.replace`).

**R6. `Ticket.from_dict(data)`.** Método de classe que converte um dict de entrada (o mesmo que `Desk.submit`
aceita hoje) em `Ticket`. Faz exatamente as verificações que `canonicalize` faz na v1, **na mesma ordem** (o
primeiro erro vence), com as mesmas mensagens e o mesmo `field`, e aplica os mesmos padrões. Não normaliza nada:
espaços do assunto, caixa e ordem das tags ficam como vieram. `data` que não é `dict` levanta
`TypeError("ticket must be a dict")`. `data` não é alterado. As chaves desconhecidas vão para `extra` em cópia
profunda (alterar `data` depois não altera o ticket).

**R7. `Ticket.to_dict()`.** Devolve o dict v1: as dez chaves conhecidas mais as de `extra` no nível de cima;
enumerações viram `label`, datas viram texto ISO, `tags` vira `list`, `history` vira lista de
`{"at": <ISO>, "event": <texto>}`. Cada chamada devolve estruturas novas (alterar o resultado, inclusive os
valores de `extra`, não altera o ticket). Para todo ticket `t`, `Ticket.from_dict(t.to_dict()) == t`.

**R8. `canonicalize`.** `helpdesk.intake.canonicalize(data)` continua existindo e devolve
`Ticket.from_dict(data).to_dict()`: o mesmo dict (e os mesmos erros) da v1.

**R9. `Criteria`.** Dataclass congelada com os campos `status` (`Status`), `min_priority` (`Priority`), `tag`,
`tier` (`Tier`), `assignee` e `text`, todos com padrão `None` (`None` = critério ausente).
`Criteria.from_dict(data)`:

- `None` ou `{}` devolvem `Criteria()`;
- chave desconhecida levanta `ValidationError("unknown criterion: <chave>")` com `field == <chave>`, e isso é
  verificado para todas as chaves **antes** de olhar qualquer valor;
- `status`, `min_priority` e `tier` são convertidos para a enumeração (com a tolerância de R3); valor inválido
  levanta `ValidationError` cujo `field` é **a chave do critério** (`"tier"`, `"min_priority"`, `"status"`; nunca
  `"customer.tier"` nem `"priority"`). O texto da mensagem é livre;
- `tag`, `assignee` e `text` têm de ser `str`; senão (inclusive `None`), `ValidationError` com `field == <chave>`
  (mensagem livre). Aqui a v2 é mais estrita que a v1, que não conferia esses tipos;
- `tag` é guardada sem espaços nas pontas e em minúsculas; `assignee` e `text` são guardados como vieram.

**R10. `Summary`.** Dataclass congelada com `total` (`int`), `by_status`, `by_priority` e `open_by_tier` (dicts
de `label` para contagem, com todas as chaves, inclusive as de contagem zero). `Summary.to_dict()` devolve o
dict que `summarize` devolve na v1, com dicts novos a cada chamada.

## Funções internas

**R11. Assinaturas v2.** As funções abaixo passam a receber e devolver objetos tipados. O comportamento de cada
uma é o da v1, só que sobre `Ticket`.

| Função | Recebe | Devolve |
|---|---|---|
| `helpdesk.intake.normalize_ticket(ticket)` | `Ticket` | `Ticket` novo, normalizado (`tags`: tupla ordenada, sem repetidas nem vazias; `history`: ordenado por `at`, empates na ordem original) |
| `helpdesk.validation.validate_ticket(ticket, today)` | `Ticket`, `date` | o mesmo ticket, ou `ValidationError` (mensagens, `field` e ordem da v1) |
| `helpdesk.routing.assign(ticket, agents, today)` | `Ticket` | `Ticket`; ao atribuir, acrescenta `HistoryEntry(today, "assigned:<nome>")` |
| `helpdesk.routing.sla_deadline(ticket)` | `Ticket` | `date` |
| `helpdesk.routing.escalate(ticket, today)` | `Ticket` | `Ticket`; ao escalar, acrescenta `HistoryEntry(today, "escalated")` |
| `helpdesk.search.filter_tickets(tickets, criteria)` | tickets, `Criteria` | `list` de `Ticket` |
| `helpdesk.search.sort_tickets(tickets, key="priority")` | tickets | `list` de `Ticket` |
| `helpdesk.stats.summarize(tickets)` | tickets | `Summary` |
| `helpdesk.stats.aging_buckets(tickets, today)` | tickets | o dict da v1 |
| `helpdesk.notify.render_notification(ticket)` | `Ticket` | o texto da v1 |
| `helpdesk.notify.build_digest(tickets)` | tickets | o texto da v1 |
| `helpdesk.export.to_rows(tickets)` | tickets | as linhas da v1 (listas de `str`) |
| `helpdesk.export.dump_jsonl(tickets)` | tickets | uma linha `json.dumps(ticket.to_dict(), sort_keys=True)` por ticket, cada uma terminada em `"\n"` |
| `TicketStore.add(ticket)`, `TicketStore.update(ticket)` | `Ticket` | `None` |
| `TicketStore.get(ticket_id)`, `TicketStore.all()` | | `Ticket`, `list` de `Ticket` (ordem da v1) |

**R12. Dict v1 não entra.** Toda função de R11 que recebe `ticket` levanta
`TypeError("expected Ticket, got <nome do tipo>")` quando o valor não é um `Ticket` (por exemplo
`"expected Ticket, got dict"`); toda função que recebe `tickets` levanta o mesmo erro se **qualquer** item não
for `Ticket`. Essa verificação vem **antes** de qualquer outra verificação ou efeito da função:
`sort_tickets([{}], "bogus")` levanta `TypeError` (não `ValueError`), `assign({}, (), hoje)` levanta `TypeError`
(não `NotFoundError`), `build_digest` recusa a lista mesmo que o item errado seja um ticket fechado, e
`TicketStore.add` não guarda nada. `filter_tickets` levanta `TypeError("expected Criteria, got <nome do tipo>")`
quando `criteria` não é um `Criteria` (um dict, `None`), e isso é verificado antes dos tickets.

**R13. Iteráveis.** Onde R11 diz "tickets", vale qualquer iterável de `Ticket`, inclusive um gerador, que é
percorrido uma única vez.

**R14. Datas e enumerações de verdade.** As regras de negócio comparam `date` com `date` e membro com membro:
`escalate` não escala de novo um ticket cujo `history` já tem `HistoryEntry(today, "escalated")`;
`sla_deadline` soma dias a `ticket.created`; nenhuma função de R11 muda o ticket recebido (não há como: ele é
imutável) e as que não têm o que mudar devolvem um ticket igual ao recebido.

## Bordas

**R15. `Desk.submit` e `Desk.search` não mudam.** `Desk.submit(data, today=None)` recebe um dict e devolve
`{"ok": True, "ticket": <dict v1>}` ou `{"ok": False, "field": ..., "error": ...}`, com os mesmos valores da v1
para qualquer entrada (inclusive entradas com mais de um erro); `data` que não é dict levanta `TypeError`.
`Desk.search(criteria=None, sort="priority")` recebe um dict (ou `None`) e devolve a lista de dicts v1; os erros
de critério são os de R9 e ordenação desconhecida levanta `ValueError`.

**R16. O resto da fachada é tipado.** `Desk.get(ticket_id)` devolve um `Ticket` (`NotFoundError` se não existe).
`Desk.report()` devolve um `Summary`. `Desk.escalate_all(today)` devolve a lista dos `Ticket` alterados (e grava
cada um no store). `Desk.notifications()` e `Desk.rows()` devolvem o mesmo que na v1.

**R17. Linha de comando.** `helpdesk.cli.main.main(argv, out, today)` mantém saídas e códigos de saída da v1:
`submit` imprime a lista de resultados, `search` a lista de dicts v1 e `report` o `Summary.to_dict()`, tudo em
JSON com `sort_keys=True`.

**R18. Testes visíveis.** Os testes em `tests/` usam a v1 em vários pontos (por exemplo `desk.get(...)["subject"]`
e `escalate` com dict). Atualize-os para a v2; eles têm de passar ao final.
