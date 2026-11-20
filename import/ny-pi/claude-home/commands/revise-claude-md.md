---
description: "Propõe e aplica (com aprovação) o que esta sessão ensinou ao AGENTS.md/CLAUDE.md do projeto"
disable-model-invocation: true
argument-hint: "[foco opcional]"
---

<!-- Porte para o pi (2026-11-11) do /claude-md-management:revise-claude-md (plugin desligado no Claude). Mudanças: o pi
lê AGENTS.md e CLAUDE.md (e o CLAUDE.local.md pessoal), então os dois entram; a aprovação usa a ferramenta `question`;
o original procurava `.claude.local.md`, nome que o Claude Code não lê (o certo é `CLAUDE.local.md`, conferido em
code.claude.com/docs/en/memory); no pi, CLAUDE.local.md e .claude/CLAUDE.md só carregam em projeto aprovado
(pi-code context-imports.ts), e o wrapper roda --no-approve. Instruções
globais (~/.pi/agent/claude-home/CLAUDE.md e rules/) ficam de fora: são mantidas por outro fluxo. -->

Foco pedido: `$ARGUMENTS`

Revise esta sessão atrás do que ajudaria uma sessão futura a trabalhar melhor neste repositório e proponha
acréscimos aos arquivos de instrução do projeto.

## 1. Reflita

Que contexto faltou? Comandos de build, teste ou lint usados ou descobertos; padrões de código seguidos; abordagens
de teste que funcionaram; peculiaridades de ambiente ou configuração; armadilhas encontradas. Só o que vale para
sessões futuras, com evidência nesta conversa.

## 2. Ache os arquivos

`find . \( -name AGENTS.md -o -name CLAUDE.md -o -name CLAUDE.local.md \) -not -path '*/node_modules/*' -not -path './.git/*' 2>/dev/null | head -20`

Onde vai cada acréscimo:
- `AGENTS.md` / `CLAUDE.md`: compartilhado (versionado). Se os dois existem, o que já for o principal do repositório;
  não duplique a mesma linha nos dois.
- `CLAUDE.local.md`: pessoal (confira que está no `.gitignore` antes de sugerir). Avise que o pi só o carrega em
  projeto aprovado (o wrapper roda `--no-approve`), igual a `./.claude/CLAUDE.md`, e que no Claude Code um
  `CLAUDE.local.md` faz o `AGENTS.md` deixar de ser lido; o que o pi precisa ver vai em `AGENTS.md`/`CLAUDE.md`.
- O do subdiretório quando a regra só vale ali.

## 3. Rascunhe

Curto: uma linha por conceito, no formato `<comando ou padrão>` - `<descrição breve>`. Esses arquivos entram no
prompt, então cada linha custa. Evite explicação longa, o óbvio, correção pontual que não vai se repetir, e o que o
arquivo já diz (leia-o antes).

## 4. Mostre

Para cada acréscimo:

    ### Update: ./AGENTS.md
    **Por quê:** <uma linha>
    ```diff
    + <o acréscimo>
    ```

## 5. Aplique com aprovação

Pergunte com `question` (multiSelect, um item por acréscimo, mais "nenhum") quais aplicar. Edite com `edit` só os
aprovados e mostre o `git diff` dos arquivos alterados. Não faça commit.
