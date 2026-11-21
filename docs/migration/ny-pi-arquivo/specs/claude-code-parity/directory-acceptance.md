# Aceite TUI de `/cd` (`directory.sh`): causa, contrato e recibo

Complementa `directory.md` (contrato) e `tui-acceptance.md`. Código: `extensions/claude-compat/test/acceptance/{lib.sh,directory.sh}`.

## Causa da falha observada (`/probe d2` sem resposta, cwd = c, editor com `/probe`)
- Teste: `wait_for 'trust|confi|/cd:'` casava o `/cd: ...` VELHO das recusas anteriores; o Esc só era enviado se a tela já tivesse o prompt, e
  o `/probe d2 ` + Enter foi digitado DENTRO do seletor nativo "Trust project folder?" (Enter = 1ª opção, "Trust"): confiança dada por acidente, cwd = c.
- Também errado: a lib usava sempre `-ne`; o código de projeto (`evil.ts`) nunca carregaria mesmo confiado, então "marcador ausente" não provava nada.
- Contagem de "/cd: " não serve como seletor: a religação refaz a tela e apaga as linhas antigas (observado em `wait-trace.txt`).

## Contrato novo (dois cenários, cada um uma TUI isolada: `directory.sh [policy|trust]`, sem argumento roda os dois)
- `trust`: descoberta de projeto LIGADA (`ACC_DISCOVER=1` tira o `-ne`; padrão seguro continua `-ne`), agent dir e `CLAUDE_CONFIG_DIR` vazios em /tmp.
  `/cd C` (com `.pi/extensions/evil.ts`) → prompt nativo "Trust project folder?" observado; só então Esc → `/cd: confiança recusada para C`;
  arquivo de sessão byte a byte igual, cwd/id/arquivo iguais, `trust.json` sem decisão `true` (nenhuma autoaprovação), `EXECUTED` ausente.
  Recusa salva (`trust.json` {D:false}) → recusa sem novo prompt. Depois A→B, ferramenta `write` no cwd novo, `--session` em processo novo.
- `policy`: `defaultProjectTrust:"never"` (sem `-ne` nem prompt): `/cd C` conclui sem prompt, cabeçalho/cwd/id corretos, `EXECUTED` ausente
  (nada fingido) e exibe o aviso de política; depois C→B, ferramenta e `--session`.
- Seletores únicos por passo (motivo + caminho), nunca texto velho; esperas limitadas; timeout de `/probe` é falha.
- Falha preserva o recibo: `mktemp` privado mantido (`final-screen.txt`, `wait-trace.txt`, `probe.jsonl`, `calls`, `unexpected`, sentinela `EXECUTED`,
  sessões) e o caminho é impresso; só a sessão tmux própria é morta. Sucesso remove o diretório.

## Evidência (red/green)
- Red original: ver causa acima. Green: `directory.sh trust` passa (prompt real, Esc, rollback, recusa salva, A→B, `--session`).
- `directory.sh policy`: estado correto (cwd C, id, cabeçalho, marcador ausente, sem prompt) mas **RED no aviso**: defeito de PRODUÇÃO provado.

## Defeito de produção (fora do escopo desta unidade; não corrigido)
`claude-home/patches/pi-core/session-cwd/runtime.mjs` `okInfo()` (linha ~217) devolve `{ok, cwd, trusted}` sem `policy`; o `policy:true` só entra no
retorno (`return {..., policy:true}`), que a extensão usa só se `withSession` não anunciou. Resultado: com política "never" a TUI mostra
"Projeto NÃO confiável…" em vez de "Configs de projeto desativadas por política". Correção: `okInfo` incluir `policy: pre.policy && pre.needs !== false && !trusted`
(+ teste em `runtime.test.mjs`). O passo `policy` do aceite fica vermelho até lá.
