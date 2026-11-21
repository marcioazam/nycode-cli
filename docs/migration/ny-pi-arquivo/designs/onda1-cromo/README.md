# Onda 1 · cromo da tela — desenho “Calmo”

**Status: aplicado em parte (2026-11-14), sem commit.** Proposta completa com antes/depois: `proposta.html` (os “depois” dela são mocks). Capturas reais do que foi aplicado: `real-*.png` (reproduzir: `node docs/designs/onda1-cromo/check.mjs`).

## Objetivo
Cromo minimalista: cada informação num lugar só, hierarquia por peso e cinza, cor só com significado.

## Decisão do dono (2026-11-14)
“Aplicar tudo”, com duas restrições: manter as barras de ctx / usage / weekly do HUD e não mexer nos status de Plan, Subagents e Runs.

## Aplicado
| Item | Antes | Depois | Onde |
|---|---|---|---|
| A02 header | marca, versão, modelo, raciocínio, contexto, caminho, branch, 4 dicas em roxo | marca, versão, 3 dicas em negrito + cinza; o estado da sessão fica só no HUD | `extensions/ui-visual/header.ts` |
| Indicador de trabalho | spinner em gradiente de 3 cores; `esc interrompe` fixo no header | spinner na cor de destaque; `· esc interrompe` só enquanto trabalha | `extensions/ui-visual/working.ts` |
| A10 bypass | `⚠ BYPASS PERMISSIONS ON` em vermelho; `🔒 permissions: ask` no modo padrão | `⚠ bypass ligado` na cor de atenção; modo padrão não ocupa linha | `extensions/bypass-permissions/index.ts` |
| A11 título do terminal | `pi - sessão - pasta` | `sessão · pasta` (específico primeiro) | `extensions/ui/terminal.ts` |
| Tema | `tokyo-night` | `tokyo-night` (o `graphite` foi criado, testado e removido no mesmo dia: o dono decidiu manter o Tokyo Night) | sem mudança |

> **Substituído (2026-11-14, Onda 7):** o dono aprovou o par `pi-claro/pi-escuro` (estilo Apple, segue o claro/escuro do terminal). O `tokyo-night` continua instalado, com contraste corrigido, como rollback. Ver `docs/designs/onda7-tokens/README.md`.

Contraste medido no `tokyo-night` sobre `#1a1b26` (WCAG 2.x): `text` 10,6:1, `muted` 8,1:1, `dim` (`dark5 #737aa2`) 4,1:1, abaixo de 4,5:1. Ajuste proposto, não aplicado: `dim` → `#8a93bd` (5,7:1).

## Não aplicado (e por quê)
- **Conteúdo do HUD** (modelo, barras de ctx / usage / weekly): mantido por decisão do dono.
- **Etiquetas `STATUS LINE`, `SUB AGENTS`, `PLAN`, ordem dos painéis, status de plan/goal/runs**: mantidos. As três etiquetas saem do mesmo código (`fleet-ui/chrome.ts`, pilha de patches do pi-code); tirar só a do status deixaria o conjunto inconsistente com as duas que o dono pediu para manter.
- **`❯` no composer**: o editor do pi não tem prefixo de prompt, só `paddingX`.
- **A03 header em NO_COLOR**: já tem dono (`extensions/ui/a11y.ts`, header nativo sem SGR); não mexido.
- **A07, A15–A17 (429, confiança, diagnóstico, piso de versão)**: textos nativos do pi / pi-code; exigiriam patch novo no core. Pendente de decisão.
- **Fundo do terminal**: o tema do pi não define o fundo; ele vem do terminal (`~/.config/kitty/tokyonight.conf`, `#1a1b26`). Não alterado.

## Evidência
- Testes: `node --experimental-strip-types --test` em `extensions/ui-visual/test/*.test.ts` e `extensions/ui/test/*.test.ts`: 98 passam, 0 falham.
- Capturas reais (kitty em Xvfb, pi 1.5.2, provider fake) no tema `tokyo-night`: tela inicial com bypass ligado, `/bypass off`, e trabalhando.
- Não executado: suíte dos patches do pi-code (não tocados), `scripts/test_install.sh`, recaptura da galeria.

## Pendências conhecidas
- `docs/ui-ux-gallery/images/*` (01, 100, 101, 126–128, 143 e demais com header) mostram o cromo antigo e o tema `tokyo-night`.
- `bypass-permissions` segue sem teste unitário; a evidência é a captura real.

## Rollback
`git checkout -- extensions/ui-visual/header.ts extensions/ui-visual/working.ts extensions/ui/terminal.ts extensions/bypass-permissions/index.ts` mais os testes correspondentes. Atenção: `publish.list` e outros arquivos têm mudanças de outros trabalhos no mesmo checkout.
