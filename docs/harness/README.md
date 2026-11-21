# Docs do harness do ny-pi

> Estes documentos vieram de `claude-home/docs/` do ny-pi (cópia de 2026-11-21, checkout na branch
> `feat/ui-onda9-harness` mais arquivos ainda não commitados) e foram convertidos para o nycode na F8 (mapa em
> `docs/migration/ny-pi-core/anexos/E-mapa-arquivo-a-arquivo.tsv`, decisão D-31). Critério da conversão:
>
> - Todos os documentos: caminhos internos trocados pelos do nycode (`packages/coding-agent/resources/...`,
>   `scripts/harness/...`, `docs/harness/...`, `${NYCODE_RESOURCES}`, `~/.nycode/agent`).
> - Documentos de referência vivos (`agent-contract`, `goal`, `pi-commands`, `pi-hooks-port`, `pi-instructions`,
>   `pi-ui-sota`, `subagent-model-effort`): nome do produto `nycode` e variáveis `NYCODE_*` (D-33).
> - Registros datados (nome com data, `research/`, `third-party/`): mantêm as menções históricas ao upstream (`pi`,
>   `pi-code`, `PI_*`), pois descrevem o que foi medido e decidido na época.
>
> Descrições de patches do pi-code, do wrapper `~/.local/bin/pi` e de extensões em `~/.nycode/agent/extensions/` são
> contexto histórico do ny-pi: o comportamento equivalente vive agora no código embutido. Os arquivos citados e ainda
> ausentes do nycode podem ser vistos no ny-pi, no commit `e4f8729bfab57e9e2b222f020710c85d0a578c8d`
> (`https://github.com/marcioazam/ny-pi/blob/e4f8729bfab57e9e2b222f020710c85d0a578c8d/<caminho>`).
