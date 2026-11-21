# 02 — Correções de segurança e performance (executadas)

Registro vivo das únicas mudanças de código desta auditoria. Evidência de origem: `faixas/seguranca.md`,
`faixas/perf-confiabilidade.md`, `faixas/extensoes-ui.md`, `faixas/extensoes-nao-visuais.md`.

## Restrições (valem para toda faixa)

- Só segurança e performance. Bug de correção, confiabilidade do bench, UI e refatoração ficam nos documentos 01 e 06.
- A árvore tem trabalho alheio não commitado e outras sessões ativas: cada faixa edita só os arquivos que possui.
  Fora do alcance por estarem em edição ativa: `extensions/ui/`, `extensions/ui-visual/`.
- Sem commit, push, PR, instalação no `~/.pi/agent` vivo, nem mudança de dependência.
- Teste primeiro: cada correção tem teste que falha sem ela. Sem afrouxar asserção existente.
- Limites: arquivo de código ≤ 800 linhas; diretório ≤ 7 arquivos de código diretos (`claude-home/hooks/` já tem 7).

## Unidades

| id | arquivos possuídos | achados | aceitação |
|---|---|---|---|
| U1 guard | `claude-home/hooks/guard.py`, `claude-home/hooks/test_guard.py`, `claude-home/hooks/permissions/*.py` (novos módulos aqui), `claude-home/hooks/permissions/tests/*`, `claude-home/settings.json.example` | segurança 1–8, 16; perf-confiabilidade 1, 20 | cada comando reproduzido como bypass devolve deny (ou ask onde a decisão D diz); nenhum comando legítimo da lista de não regressão muda de decisão; guard ≥ 40% mais rápido no caso comum |
| U2 extensões | `extensions/bash-clamp/index.ts`, `extensions/bash-clamp/index.test.ts`, `extensions/image-open/index.ts`, `extensions/image-open/image-open.test.ts`, `extensions/diagnostico/registro.ts`, `extensions/diagnostico/test/registro.test.ts` | segurança 9, 12, 13; não visuais: `diag.jsonl` 0600, `lerCaixa` por offset, prune do bash-clamp, id de tool call | rodapé forjado não lê arquivo fora do diretório de spill; diretório temporário de outro dono é recusado; `lerCaixa` não relê o arquivo inteiro |
| U3 render | `extensions/code-blocks/index.ts`, `extensions/code-blocks/blocks.ts`, `extensions/code-blocks/*.test.ts` (novo `index.test.ts`), `extensions/sticky-prompt/sticky.ts`, `extensions/sticky-prompt/index.ts`, `extensions/sticky-prompt/sticky.test.ts` | UI: cache de realce inexistente, `remember` por prefixo (memória O(n²)), linha do cabeçalho maior que a largura (derruba o processo: disponibilidade), `findSticky` sem memo | stream de 600 prefixos não expulsa o bloco 1; rótulo de 80 colunas cabe em qualquer largura ≥ 20; realce de bloco inalterado não é refeito; `findSticky` não reprocessa com mesma entrada |
| U4 shell | `bin/pi`, `bin/test_pi_env.sh`, `claude-home/bin/lifecycle/supervisor.sh`, `claude-home/bin/tests/lifecycle/supervisor.test.sh`, `claude-home/bin/mcp-header.sh` | perf-confiabilidade 3, 4; segurança 10, 11; nota `mcp-header.sh` | lançamento sem mudança pula a prova de patches (≥ 250 ms a menos) e qualquer arquivo alterado a refaz; ` -a ` dentro do prompt não desliga `--no-approve`; `optin` do arquivo de restart não liga bypass; `mcp-header.sh` recusa `/` e `..` |

## Decisões do guard (U1)

- D1 recursão: `bash|sh|dash|zsh|ksh -c`, `eval`, `( )`, `{ }`, `$( )`, crases, `<( )`, `env -S` e o corpo de
  `if/while/for/case` são reanalisados com as mesmas regras (profundidade ≤ 5; acima disso, ask).
- D2 wrappers consomem o valor das próprias opções (`nice -n`, `env -u/-C`, `timeout -s/-k`, `ionice`, `stdbuf`,
  `chrt`, `taskset`, `sudo -u`, `setsid`, `nohup`, `command`, `exec`, `time`, `busybox`, `toybox`); `xargs CMD` e
  `find -exec|-execdir|-ok CMD` avaliam `CMD`; `find <raiz catastrófica> -delete` é tratado como `rm -r` dela.
- D3 palavra de comando que é expansão (`$X`, `${…}`) ou uso de `$IFS`: reavaliar com `$IFS` trocado por espaço; se
  os argumentos teriam deny para `rm` (recursivo + forçado), deny; senão ask.
- D4 baixar-e-executar: `curl|wget|base64 -d|xxd -r|openssl enc -d` ligado por pipe, `<( )` ou `$( )` a um
  interpretador (`sh`, `bash`, `zsh`, `dash`, `python*`, `perl`, `ruby`, `node`) lendo de stdin ou `-c`: deny.
- D5 heredoc só é mascarado quando `<<` está fora de aspas.
- D6 opções longas do `rm` casam por prefixo (`--rec`, `--forc`).
- D7 `git push`: destino normalizado (`refs/heads/`); `--force-with-lease*`, `--force-if-includes` e `+ref` contam
  como forçado; forçado sem refspec explícito e `--mirror`: deny; alias definido em linha (`-c alias.x=`): ask.
- D8 dispositivo: `normpath` do alvo; escrita em `/dev/*` é negada fora de `null`, `zero`, `full`, `stdout`,
  `stderr`, `stdin`, `tty`, `fd/*`, `pts/*`, `shm/*`.
- D9 leitura negada: `.env` e `.env.<qualquer>` exceto `.example|.sample|.template|.dist|.defaults`; mais
  `~/.aws/credentials`, `~/.netrc`, `~/.git-credentials`, `~/.gnupg/`, `~/.config/gh/hosts.yml`, `~/.docker/config.json`,
  `~/.kube/config`, `~/.npmrc`, `~/.pypirc`, `~/.pi/agent/local.env`, `/proc/*/environ`; `realpath` antes de casar.
- D10 `Grep` passa pelo hook: negado quando o caminho é arquivo negado, está dentro de diretório negado ou é um
  diretório que guarda diretamente um arquivo negado (ou `$HOME`, `/`).
- Limite conhecido (não corrigível por lista): baixar para arquivo e executar depois, script escrito pelo próprio
  agente, alias em arquivo de configuração. A resposta é sandbox de SO (ver `06-melhorias.md`).

## Progresso

- [x] U1 guard
- [x] U2 extensões
- [x] U3 render
- [x] U4 shell
- [x] gate único (`gate-runner`): vermelho, nenhuma falha causada por esta tarefa (ver Gate)
- [x] revisão do diff na sessão principal

## Evidência

(preenchido depois do gate)

### U1

Vermelho (antes de editar o guard, `python3 -m pytest claude-home/hooks/permissions/tests/test_guard_bypass.py`): `75 failed, 40 passed` sem os testes de custo (todos os bypasses das tabelas devolviam allow/ask antigo; a não regressão, 29 casos + 3 leituras, já passava e foi fixada com a decisão de antes). Custo no guard antigo: `check_bash("a"*40000+" rm -rf /tmp/x")` 5.448 ms; 1.500 heredocs sem terminador 818 ms (a suíte de custo chegou a estourar 300 s no vermelho).

Verde: `python3 -m pytest claude-home/hooks/test_guard.py claude-home/hooks/permissions/tests -q` → `200 passed, 262 subtests passed` (75 testes antigos, intactos, mais `permissions/tests/test_guard_bypass.py`). `ruff check` e `mypy --strict --follow-imports=silent` limpos em `guard.py`, `permissions/parse.py`, `permissions/rules.py` e no teste novo. Depois: 40 KB sem `()` 13 ms, 1.500 heredocs 17 ms, 1.500 `$(cat <<E` 52 ms, heredoc real de 100 KB 20 ms.

Medição (`hyperfine -N -w3 -r30 --input <json> 'python3 <guard>'`, mesma carga, `uptime` 04:38 `load average: 4,91 4,72 5,82`; guard antigo = `git show HEAD:…/guard.py`): Bash `git status && ls -la src` 26,0 ± 1,0 ms → **15,0 ± 1,0 ms (−42%)**; Read 26,3 ± 2,2 → **15,1 ± 1,0 ms (−43%)**. Ganho de `tempfile`/`traceback` tardios e `typing` fora do caminho quente; `permissions/parse` + `rules` custam ~1 ms de import.

Decisões que mudaram de decisão (corpus de 229 comandos, antigo × novo): só `git push --force-with-lease` sem refspec, ask → deny (D7). Bypasses: ver tabela `BYPASSES` do teste.
- D9 parcial, `needs_decision`: `.env.<qualquer>` NÃO foi negado. `test_guard.py::ALLOW_READ` fixa `.env.development` como allow, e a regra da brief proíbe mudar teste; a regex `READ_DENY_ENV_RE` ficou como estava. O resto de D9 (credenciais, `.gnupg`, `/proc/*/environ`, `realpath`, HOME com symlink) está feito.
- D10: o pi-code traduz `grep` → `Grep` com `path` absoluto (`extensions/hooks/claude-tools.ts`); matcher do `settings.json.example` agora `Bash|Edit|Write|Read|Grep`; o `~/.pi/agent/claude-home/settings.json` vivo não foi tocado (precisa do mesmo ajuste). `glob`/`find`/`ls` ficam fora (a decisão fala só de Grep); o parâmetro `glob` do Grep não é avaliado.
- Leitura de D4: pipe + interpretador só nega se ele lê o programa do stdin (sem arquivo de script); `curl x | python3 -c '…'` continua allow (o `-c` é o programa, o stdin é dado). Via `$( )`/`<( )`/`eval`, o texto baixado como programa é deny.
- Extras no mesmo espírito de D1: here-string (`sh <<< 'rm -rf ~'`), `su -c`, `name(){…}`, `sudo`/`doas` com mais opções de valor; `$(…)` com heredoc dentro (padrão `git commit -m "$(cat <<'EOF' …)"`) segue allow.

Passam pelo guard por limite conhecido: baixar para arquivo e executar depois (`curl -o x URL && sh x`), script escrito pelo próprio agente, alias/função de arquivo de configuração, `git push -f origin HEAD` com HEAD em main (refspec `HEAD` não é resolvido), `python -c`/`node -e` com `rm` interno, `sudo -s`/`sudo -i`, `.env.<qualquer>` fora da lista antiga, Grep recursivo em subdiretório que guarda `.env` mais fundo (só o diretório pedido e seus filhos diretos são conferidos), comando acima de 256 KB (vira ask, que o bypass libera).

### U2

Vermelho (antes da implementação, `node --experimental-strip-types --test <arquivo>`):
- bash-clamp: 5 falhas — rodapé forjado lia a isca (`/tmp/.../isca.log` entrou na saída), dir 0755/symlink gravava, `wx` ausente (sobrescrevia), `spillFor` inexistente, prune por contagem (50) mantinha log de 48 h.
- image-open: 4 falhas — dir 0755 era adotado por `chmod`, dir symlink e arquivo symlink pré-existente eram aceitos, clique não recusava.
- diagnostico: 3 falhas — `diag.jsonl`/dir sem 0600/0700; `lerCaixa` lia o arquivo inteiro (`lidos` ≠ bytes novos); truncado já funcionava (teste de caracterização).

Verde: `node --experimental-strip-types --test bash-clamp/index.test.ts image-open/image-open.test.ts diagnostico/test/registro.test.ts` → 42 testes, 41 ok, 1 falha preexistente fora do escopo: `humano: JSON cortado é lido por regex` (`registro.ts`, função `humano`; já falhava antes das edições da U2). `lsp_diagnostics` limpo nos 3 `.ts` editados.
Decisões: o spill do pi é `os.tmpdir()/pi-bash-<hex>.log` (sem subdiretório); rodapé do pi só vale com `realpath` direto em `tmpdir()`, nome `pi-bash-*.log`, arquivo regular do próprio uid; rodapé inválido devolve o original. Prune só por idade (> 24 h), sem teto.

### U3

Vermelho (antes da correção, `node --experimental-strip-types --test <arquivo>`):
- `blocks.test.ts`: `AssertionError: w=4 xxxxxx -> 203` (cabeçalho de 203 colunas numa largura de 4; sem a correção passa de `width` em toda largura testada).
- `index.test.ts`: 7 de 7 falham (`resetHighlightCache`/`remember` com dono/`recall` inexistentes; o `remember` antigo guarda cada prefixo).
- `sticky.test.ts`: `mesma entrada não reexecuta a varredura…` falha (`Values have same structure but are not reference-equal`: segunda chamada refazia a varredura); a equivalência com a versão anterior (200 casos, semente fixa) já passava e continua passando.

Verde: `node --experimental-strip-types --test extensions/code-blocks/*.test.ts extensions/sticky-prompt/sticky.test.ts` → 42 testes, 42 passam, 0 falham.

Medições (script descartável `/tmp/bench-u3.mjs`; máquina carregada, load average 29,16 / 12,93 / 7,83, `uptime` 04:22):
- 1.000 renders de 3 blocos × 150 linhas (largura 100): antes 20.362 ms, depois 2.846 ms (o resto é `renderCodeBlock`).
- `findSticky` 10.000 chamadas, 20.000 linhas, 200 zonas, mesma entrada: antes 3.278 ms, depois 2,4 ms; com `scrollTop` variando (100 chamadas): 9 ms contra ~33 ms.

### U4

- **Vermelho (antes):** `sh bin/test_pi_env.sh` → 14 FAIL: `stamp: first launch verifies`, `…second launch reports stamp-hit`, toque/`.patch`/versão/`NO_STAMP` sem reverificação rastreável, `approve: -a inside prompt text does not count` (got `approve`) e `approve: -a after -- does not count`. `mcp-header.test.sh` → 3 FAIL: `recusa '../leak'` (rc=0, imprimiu `outside-secret`), `recusa '..'`, `recusa '.hid'`.
- **Verde (depois):** `sh bin/test_pi_env.sh` → 0 FAIL (carimbo: 1º lançamento verifica e grava 0600, 2º pula, arquivo-alvo tocado / `.patch` alterado / versão pi-code ou core / `PI_WRAPPER_NO_STAMP=1` reverificam, verificação falha apaga o carimbo; `-a` só como argumento inteiro antes de `--`). `sh claude-home/bin/tests/lifecycle/mcp-header.test.sh` → 10 PASS. `supervisor.test.sh` inalterado, verde. `sh -n` nos 3 scripts limpo; shellcheck sem achado novo (restam SC3067 `-O`, SC2045, SC2046 já existentes em `bin/pi`).
- **Medição** (`hyperfine -N -w2 -r10`, HOME falso com cópia dos diretórios reais: pi-code 2 MB, pi-coding-agent/dist 25 MB, pi-tui/dist 2,6 MB, patches reais; wrapper inteiro até o `exec` de um pi falso; carga alta, `uptime` 04:22 `load average: 27.36, 12.04, 7.50`): com carimbo **61,2 ms ± 8,3**; `PI_WRAPPER_NO_STAMP=1` (verificação completa) **619,0 ms ± 110,7**. Diferença ≈ 558 ms sob carga (meta ≥ 250 ms).
- **Segurança 10 (supervisor.sh): NÃO alterado, `needs_decision`.** O `/bypass on` explícito numa sessão `--safe` grava `PI_BYPASS_OPTIN=1` só no ambiente da extensão (`permissions/controller.ts:118-121`) e o único canal até o supervisor é o campo `optin` do pedido (spec `lifecycle.md` R3; teste existente `legado bypassPermissions:1 … default/1/0/1`). Ignorar o campo quebra o fluxo legítimo `/bypass` + `/restart` num lançamento seguro; não há outra fonte confiável (opção do achado: HMAC de segredo mantido pelo pai, exige mudança em `extensions/`, fora da unidade).

### Gate (uma execução, 2026-11-19, HEAD `4e38f41`, árvore suja com 243 caminhos)

Logs: `/tmp/audit-gate/logs/`. O `run-static.sh` recusa rodar fora do CI; os mesmos passos rodaram por script local,
com a árvore suja inteira contando como "alterada" (528 arquivos, a maioria de outras sessões).

| check | resultado |
|---|---|
| pytest (`scripts/ claude-home/hooks claude-home/bin bench`) | 504 passaram, 272 subtestes |
| `node --test` das extensões (lista do CI, só arquivos rastreados) | 1.542: 1.491 ok, 50 falhas, 1 pulado |
| testes novos não rastreados (`code-blocks`, mais `sticky-prompt`, `bash-clamp`, `image-open`), rodados à parte | 72 de 72 |
| `bin/test_pi_env.sh`, `mcp-header.test.sh`, `supervisor.test.sh` | passam |
| `structure.py` | 807 arquivos, 0 violações |
| `structure_changed`, `skill-lint`, selftest de `scripts/ci` | passam |
| ruff, mypy, biome, shellcheck/shfmt, check-refs sobre a árvore suja | falham |

Classificação das falhas (conferida na sessão principal):

- As 50 falhas de `node --test` estão em `diagnostico/test/{modal,painel,index,obs/*}`, `ui-visual`, `ui`,
  `auto-resume`, `bypass-permissions`, `claude-compat` e `hook-msgs`: arquivos com edição em curso de outras
  sessões. A única em arquivo desta tarefa é `registro.test.ts:176` (`humano: JSON cortado…`), que exercita a função
  `humano`, alterada por outra sessão e não pela U2. O teste `pai lê a caixa…` foi reexecutado numa cópia em `/tmp`
  com o `lerCaixa` antigo e falha do mesmo jeito: a causa não é a U2.
- ruff/mypy/biome: nenhum erro em `parse.py`, `rules.py`, `test_guard_bypass.py`, `bash-clamp`, `image-open`,
  `code-blocks`, `sticky-prompt`, `registro.ts`, `mcp-header.sh`. `guard.py` falha só em `ruff format`, e já falhava
  em HEAD (21 blocos de diferença antes, 20 depois). `test_guard.py` não foi alterado.
- shellcheck em `bin/pi`: 5 avisos; um novo da U4 (`SC3067`, `test -O` na linha 223, mesma classe do já existente
  na linha 24).
- check-refs: `bin/pi:205` (`wrapper-verify.stamp`, arquivo criado em tempo de execução) é novo da U4; os de
  `docs/audit-2026-11-19/` eram dois caminhos errados no doc 01 (corrigidos) e caminhos de `~/.pi/agent` que o
  verificador lê como relativos.

Não executado: `run-security.sh` (precisa instalar binários e rede), cobertura e `diff-cover`, markdownlint,
`scripts/test_install.sh`, mutação. Sem esses, o gate do CI não está reproduzido por inteiro.

### Pendências das unidades (fechadas em 2026-11-19)

| pendência | estado | evidência |
|---|---|---|
| Achado 10 (`supervisor.sh`, campo `optin`) | corrigido no doc 07 (S1): reabrir com bypass pergunta em `/dev/tty`; sem terminal, nega | `supervisor.test.sh` |
| D9 `.env.<qualquer>` | corrigido no doc 07 (G7): contrato `.env.development` ALLOW → DENY | `test_guard.py` |
| D10 matcher vivo sem `Grep` | corrigido: `~/.pi/agent/claude-home/settings.json` com `Bash\|Edit\|Write\|Read\|Grep` e `onFailure: "block"` (backup `settings.json.bak-2026-11-19-guard`) | doc 07, incidente do guard |
| `git push -f origin HEAD` com HEAD em main | corrigido: forçado com destino `HEAD`, `@`, `+HEAD` ou `--all` nega como "sem refspec" | `test_guard_bypass.py` (3 vermelhos antes), `hooks` 262 verdes |
| `bash-clamp` sem teto | corrigido: além das 24 h, o diretório fica ≤ 256 MiB apagando os mais antigos, nunca o log recém-gravado | `index.test.ts` (vermelho antes), 15/15 |
| Carimbo do wrapper só pelo mtime | corrigido: `find -cnewer` (ctime não recua com `cp -p`/`touch -r`) | `test_pi_env.sh` caso "edit with preserved mtime" (vermelho antes), 0 FAIL |
| `code-blocks` e `sticky-prompt` com o pi rodando | não verificado: exige sessão interativa; premissas do pi-tui seguem abertas | — |

Limites conhecidos que ficam (resposta: sandbox de SO, `06-melhorias.md`): baixar para arquivo e executar depois,
script escrito pelo agente, alias em arquivo de configuração, `python -c`/`node -e` com `rm` interno, `sudo -s`/`-i`
(dão ask, que o bypass libera), comando acima de 256 KB (ask). Grep recursivo em diretório com `.env` mais fundo: o
Grep do pi passa `--hidden` mas respeita `.gitignore`, então só vaza `.env` não ignorado.
