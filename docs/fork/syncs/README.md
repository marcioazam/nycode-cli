# Registros de sincronização com o upstream

Um arquivo por sincronização, `AAAA-MM-DD-<sha12>.md` (data da fusão e 12 primeiros caracteres de U). O conteúdo é o
corpo preenchido de [`../sync-pr-template.md`](../sync-pr-template.md): commits U, R e R_prev, as 6 métricas da seção 9
do [08](../../migration/ny-pi-core/08-sincronizacao-upstream.md), o resultado do `merge-policy` e os checks.

O arquivo entra no próprio PR da sincronização, depois da fusão e das correções. Registros antigos não se editam: uma
correção vira nota datada no fim do arquivo.

Ainda não há registros: nenhuma sincronização foi concluída desde a base do fork (`073b0bae8`).
