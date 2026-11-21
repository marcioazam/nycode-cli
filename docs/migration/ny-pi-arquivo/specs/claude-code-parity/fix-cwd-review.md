# fix-cwd-review: correções críticas do review de `/cd` (patch session-cwd)

Escopo: `claude-home/patches/pi-core/session-cwd/runtime.mjs` e `runtime.test.mjs`; contrato em `directory.md` (D11/D12).

| # | Defeito | Correção |
|---|---|---|
| F1 | `scanForCwd` devolvia lista parcial ao esgotar o orçamento; `continueRecent` podia retomar sessão antiga/errada | Estouro (`maxFiles` 20000, `maxEntries`, `maxDirs`, `deadlineMs`) lança `SESSION_SCAN_INCOMPLETE`; `findById/continueRecent/list` propagam. Diretório explícito segue nativo |
| F2 | `readdirSync` completo, `statSync` seguia links para fora do perfil | `opendirSync` em fluxo, tipo por dirent/`lstat`, links ignorados (raiz link = erro), `O_NOFOLLOW`+`fstat` regular no cabeçalho, erro de E/S = incompleto, `ENOENT` da raiz = vazio, `signal` do `list` honrado |
| F3 | `bakTail` lia uma vez ignorando `bytesRead` | `readFully` (repete, EOF curto falha), tamanho checado antes de alocar, cauda truncada/NUL/linha incompleta/não-JSON falha com backup retido |
| F4 | `finish()` falho era engolido e `/cd` reportava ok | `handleFatalRuntimeError` nativo, mensagem com o caminho do backup (sem transcrição); backup retido, sem clones |

Notas: `withSession` já correu antes de `finish()`; a falha final vem em seguida pelo caminho fatal nativo (visível). Links dentro de `sessions/` deixam de ser listados (decisão de segurança). O `runtime.mjs` copiado no release instalado só muda com novo `apply.mjs` (integrador).
Testes: `runtime.test.mjs` bloco `fix-cwd-review` (fixture de 20001 cabeçalhos mínimos em tmp, links, limites injetados, E/S controlada). Os testes D11 pulam o controle negativo quando o release instalado já está patcheado.
Lacunas: escritor com descritor longo (D12); prazo medido por relógio, não por E/S bloqueante de FS de rede.
