---
description: Configura o claude-hud como statusLine do pi (segmento no rodapé), reaproveitando a instalação do plugin do Claude Code
allowed-tools: Bash, Read, AskUserQuestion
disable-model-invocation: true
---

<!-- Porte para o pi (2026-11-11) do /claude-hud:setup (claude-hud 0.10.0). O pi-code honra o `statusLine` do
$CLAUDE_CONFIG_DIR/settings.json (~/.pi/agent/claude-home), mas não instala plugins do Claude Code: o launcher do pi
(claude-home/bin/hud/claude-hud-statusline.mjs) acha o claude-hud nos caches de ~/.claude*. Testado em 2026-11-11: o HUD
roda com o payload do pi; com 2+ linhas o pi as mostra acima do rodapé (`patches/pi-code/statusline-multiline.patch`); o launcher traduz a sessão do pi para o
formato de transcript do Claude (claude-home/bin/hud/claude-hud-pi-transcript.mjs), então as linhas de atividade (tools,
agents, todos, skills, MCP) funcionam. -->

Configure o claude-hud como status line do pi. Nada aqui mexe no `~/.claude`: a config do pi fica em
`~/.pi/agent/claude-home`.

## Passo 1: runtime e instalação

```bash
command -v node; ls -d ~/.claude*/plugins/cache/*/claude-hud/*/scripts/setup.mjs 2>/dev/null | awk -F/ '{print $(NF-2) "\t" \$0}' | sort -V | tail -1 | cut -f2
```

- Sem `node`: pare e diga que o pi precisa do Node.js no PATH para rodar o HUD (Node LTS em https://nodejs.org).
- Sem `setup.mjs`: pare e diga que o claude-hud não está instalado em nenhum perfil do Claude Code; instale lá com
  `/plugin install claude-hud` e rode `/claude-hud-setup` de novo.

A saída é `{RUNTIME}` (primeira linha) e `{SETUP}` (segunda: o `setup.mjs` da versão mais nova entre todos os perfis).

## Passo 2: inspecionar a config atual

```bash
CLAUDE_CONFIG_DIR="$HOME/.pi/agent/claude-home" "{RUNTIME}" "{SETUP}" inspect --shell posix
```

O helper imprime JSON com `settingsPath`, `command`, `existing` (`none`, `claude-hud` ou `other`) e `existingPreview`.
Se falhar (por exemplo `settings.json` com JSON inválido), mostre o erro e pare; não edite o `settings.json` à mão.

Se `existing` for `other`, pergunte com a ferramenta `question`:
- pergunta: "Já existe uma status line: `{existingPreview}`. Trocar pelo claude-hud? O settings.json ganha backup antes."
- opções: "Trocar" / "Manter a atual"

Em "Manter", pare sem mudar nada. Mostre só o `existingPreview`, nunca o comando cru (pode conter segredos).

## Passo 3: instalar

```bash
CLAUDE_CONFIG_DIR="$HOME/.pi/agent/claude-home" "{RUNTIME}" "{SETUP}" install --shell posix && cp ~/.pi/agent/claude-home/bin/hud/claude-hud-statusline.mjs ~/.pi/agent/claude-home/plugins/claude-hud/statusline.mjs
```

O helper faz backup do `settings.json` em `backupPath`, guarda um comando substituído em `previousCommandPath` e grava
o `statusLine` mantendo o resto (hooks incluídos). O `cp` troca o launcher do plugin pelo do pi, que acha o claude-hud
nos caches do Claude Code.

Teste com uma entrada de exemplo (`{COMMAND}` é o `command` do relatório):

```bash
echo '{"model":{"display_name":"Opus"},"context_window":{"used_percentage":12,"context_window_size":200000}}' | CLAUDE_CONFIG_DIR="$HOME/.pi/agent/claude-home" {COMMAND}
```

Deve imprimir duas linhas do HUD em poucos segundos. Se der erro ou nada sair: mostre a saída, restaure o backup
(`cp "{backupPath}" "{settingsPath}"`) e pare.

## Passo 4: fim

O pi-code relê o `statusLine` quando o `settings.json` muda, então o HUD já deve aparecer no rodapé. Pergunte com
`question`: "O HUD apareceu no rodapé do pi?", opções "Sim" / "Não".

- **Sim**: diga em uma linha que dá para mudar o layout com `/claude-hud-configure` e que o layout `expanded` mostra as
  linhas acima do rodapé, como no Claude, e o `compact` usa uma linha só.
- **Não**: rode de novo o teste do passo 3 e mostre a saída; confira se `{SETUP}` ainda existe (o launcher não imprime
  nada sem instalação); se o caminho do node mudou (nvm, mise, asdf), rode o setup de novo. Para voltar ao rodapé
  anterior, copie `backupPath` sobre `settingsPath`.

Diga também, em uma linha cada:
- as linhas de atividade (tools, agents, todos, skills, MCP) vêm da sessão do pi, traduzida pelo launcher; ligue-as
  com `/claude-hud-configure`;
- o rodapé nativo do pi já mostra modelo, contexto e custo; o HUD é um segmento a mais;
- para desfazer: restaurar o backup, ou remover a chave `statusLine` de `~/.pi/agent/claude-home/settings.json`.
