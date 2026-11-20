# shopcache

Serviços de preço e catálogo (somente biblioteca padrão) com cache em memória de chave composta
`(tenant, tipo, id, visão)`, invalidação preguiçosa por épocas e manutenção periódica.

- `shopcache/cache`: chaves, épocas, TTL, armazenamento e manutenção.
- `shopcache/repo`: dados em memória (produtos, tenants, pedidos).
- `shopcache/services`: preço, catálogo, pedidos e tarefas administrativas.
- `shopcache/events`: barramento síncrono e ligações evento → invalidação.
- `shopcache/util`: relógio manual, validações, ids.

Tudo é determinístico: o tempo vem de `ManualClock`, sem threads. Regras em `docs/SPEC.md`.
Testes: `python3 -m pytest -q tests`.
