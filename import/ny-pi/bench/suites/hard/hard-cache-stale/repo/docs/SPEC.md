# Regras do cache

1. A chave é `(tenant, tipo, id, visão)`; qualquer parte vazia ou não-string → `ValueError`. A visão padrão é `full`.
2. Uma entrada gravada no instante `t` com TTL `T` vale enquanto `agora <= t + T` (o limite é inclusivo) e expira quando `agora > t + T`.
3. TTL padrão do cache: 300 s; `put` aceita TTL próprio.
4. `get` de entrada ausente, expirada ou invalidada devolve `None` e conta um `miss`; caso contrário conta um `hit`.
5. Invalidar uma entidade `(tenant, tipo, id)` invalida todas as suas visões e nenhuma outra entidade.
6. Invalidar um tenant invalida todas as entradas dele e de nenhum outro tenant.
7. Uma entrada invalidada nunca volta a ser servida: nenhuma operação do cache, inclusive a manutenção, pode torná-la válida de novo. Só um novo `put` cria uma entrada válida.
8. Após invalidar, um novo `put` da mesma chave é servido normalmente até expirar ou ser invalidado outra vez.
9. A invalidação é preguiçosa (contadores de época); a entrada antiga pode permanecer na memória até a manutenção.
10. `compact` remove as entradas expiradas e as invalidadas; depois dele toda entrada guardada é válida.
11. `compact` libera os contadores de época de tenants e entidades que não têm mais nenhuma entrada guardada; tenants e entidades que ainda têm entradas mantêm seus contadores.
12. Capacidade: se após a limpeza ainda houver mais de `max_entries` entradas, remove as mais antigas (menor ordem de gravação) até caber; cada remoção conta em `evicted`.
13. Gravar uma entrada que ultrapasse `max_entries` dispara `compact` automaticamente.
14. `snapshot_stats` informa `entries`, `hits`, `misses`, `purged` (expiradas removidas), `evicted`, `tenant_epochs` e `entity_epochs`.
15. `PricingService.set_price` invalida a entidade `price` do sku; `bulk_reprice` invalida o tenant inteiro; renomear um produto invalida a entidade `product`.
16. Preços são inteiros positivos em centavos; leitura de sku inexistente → `KeyError`.
17. O relógio é injetado; o código do cache nunca consulta a hora do sistema.
