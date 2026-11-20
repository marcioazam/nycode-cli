---
description: Configura as opções do claude-hud no pi (layout, idioma, elementos), preservando ajustes manuais avançados
allowed-tools: Read, Write, Glob, AskUserQuestion
disable-model-invocation: true
---

<!-- Porte para o pi (2026-11-11) do /claude-hud:configure (claude-hud 0.10.0): config do HUD do pi em
~/.pi/agent/claude-home (separada da do Claude Code), AskUserQuestion -> `question`. As linhas de atividade funcionam
porque o launcher do pi traduz a sessão do pi para o transcript do Claude (claude-home/bin/hud/claude-hud-pi-transcript.mjs). -->

# Configurar o claude-hud do pi

## Ler a config atual

O diretório de config é `~/.pi/agent/claude-home` (o `CLAUDE_CONFIG_DIR` do pi). Leia, se existirem:

1. `~/.pi/agent/claude-home/plugins/claude-hud/config.json`: a config base. Este comando só escreve esse arquivo.
2. `~/.pi/agent/claude-home/claude-hud.json`: override manual. Mesmo formato, e os valores dele vencem. Nunca escreva nem
   apague esse arquivo.

Se o `settings.json` do mesmo diretório não tiver um `statusLine` com `claude-hud` no comando, avise que o HUD não está
ativo no pi e sugira `/claude-hud-setup` antes; continue só se o usuário quiser preparar a config mesmo assim.

A config efetiva é a base com o override por cima: objetos aninhados se fundem chave a chave; arrays e escalares são
substituídos. Chaves ausentes usam os padrões da tabela de configuração do README do plugin (o mais novo em
`~/.claude*/plugins/cache/*/claude-hud/*/README.md`). Use os valores efetivos ao descrever o estado atual.

## Perguntar

Pergunte com a ferramenta `question`, em dois lotes de até quatro perguntas. Ponha o valor atual em cada pergunta. Nas
de múltipla escolha, cada item listado vira `true` se marcado e `false` se não.

**Layout** (escolha única; no pi o "Expandido" mostra cada linha acima do rodapé, como no Claude, e o "Compacto" cabe numa linha do rodapé)
- "Expandido": `lineLayout: "expanded"`, `showSeparators: false`
- "Compacto": `lineLayout: "compact"`, `showSeparators: false`
- "Compacto + separadores": `lineLayout: "compact"`, `showSeparators: true`

**Linhas de atividade** (múltipla escolha; no pi vêm da sessão do pi, traduzida pelo launcher; uma skill conta quando
o modelo lê o `SKILL.md` dela)
- "Tools": `display.showTools`
- "Agents": `display.showAgents`
- "Todos": `display.showTodos`
- "Skills e MCP": `display.showSkills`, `display.showMcp`

**Sessão** (múltipla escolha)
- "Custo": `display.showCost`
- "Duração": `display.showDuration`
- "Nome da sessão": `display.showSessionName`
- "Nível de raciocínio": `display.showEffortLevel`

**Limites de uso** (escolha única)
- "Barra (padrão)": `display.showUsage: true`, `display.usageBarEnabled: true`, `display.usageCompact: false`
- "Texto": `display.showUsage: true`, `display.usageBarEnabled: false`, `display.usageCompact: false`
- "Compacto": `display.showUsage: true`, `display.usageCompact: true`
- "Oculto": `display.showUsage: false`

**Git** (escolha única)
- "Branch + sujo (padrão)": `gitStatus.enabled: true`, `showDirty: true`, `showAheadBehind: false`, `showFileStats: false`
- "Só branch": `gitStatus.enabled: true`, `showDirty: false`, `showAheadBehind: false`, `showFileStats: false`
- "À frente/atrás": `gitStatus.enabled: true`, `showDirty: true`, `showAheadBehind: true`, `showFileStats: false`
- "Estatística de arquivos": `gitStatus.enabled: true`, `showDirty: true`, `showAheadBehind: false`, `showFileStats: true`

**Idioma** (escolha única)
- "Manter o atual"
- "English": `language: "en"`
- "简体中文": `language: "zh-Hans"`
- "繁體中文": `language: "zh-Hant"`

**Linha personalizada** (escolha única)
- "Manter a atual"
- "Digitar texto": peça o texto (no máximo 80 caracteres) e salve em `display.customLine`
- "Remover": só quando existir uma; salva `display.customLine: ""`

Se o usuário cancelar qualquer pergunta, diga "Configuração cancelada." e pare.

## Prévia e confirmação

Calcule as chaves que mudam comparando com a config efetiva.

- Nada mudou: diga "Nada a mudar: config inalterada." e pare.
- Senão, mostre cada chave como `chave: antigo → novo`.
- Se uma chave mudada também estiver em `claude-hud.json`, avise que o override continua vencendo e mostre o valor
  efetivo.

Depois pergunte "Salvar essas mudanças?".

## Gravar

Grave `~/.pi/agent/claude-home/plugins/claude-hud/config.json`, criando as pastas se preciso. Parta do arquivo base
existente e mude só as chaves escolhidas. Mantenha todas as outras exatamente como estavam, inclusive as que este comando
não pergunta (`colors`, limiares, `elementOrder`, `mergeGroups`, `display.externalUsage*`). JSON válido com 2 espaços de
indentação.

Depois diga: "Configuração salva! O HUD aplica no próximo refresh do rodapé." e que o README do plugin documenta as
demais opções.
