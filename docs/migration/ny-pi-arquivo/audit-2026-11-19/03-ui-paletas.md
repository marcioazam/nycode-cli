# 03 · UI e paletas do ny-pi: avaliação e ajustes sugeridos (2026-11-19)

Tipo: documento de recomendação (AC3 de `README.md`). **Nada foi implementado**: nenhum tema, código ou teste foi
alterado. Branch `feat/ui-onda9-harness`, árvore suja com trabalho alheio.

Fontes lidas: `faixas/ui-paletas.md` (UP), `faixas/extensoes-ui.md` (EU), `research/r5-tui-paletas-perf.md` (R5, citado
como `Cn`), `themes/*.json`, `docs/ui-ux-inventory.md` (INV), `docs/designs/onda10-sota/PLANO.md` (O10) e
`docs/designs/onda12-macos/PLANO.md` (O12). Cobertura estrutural degradada: sem índice codegraph, só `rg` e leitura.

Convenções: **[medido]** = número do relatório UP ou do meu script (apêndice), reproduzível; **[sugestão]** = proposta
minha; **[inferido]** = leitura de código sem execução. Contraste `WCAG` = razão 2.x sem arredondar; `Lc` = APCA 0.0.98G
(negativo = texto claro em fundo escuro). Meta: texto ≥ 4,5:1 (WCAG 1.4.3); controle/borda ≥ 3:1 (1.4.11).

## O que foi recalculado

- **UP vinha cortado**: a tabela de paletas e a seção 2 estão completas, mas a seção 3 (UI) termina no meio do
  20º achado (de 25 anunciados) e a lista final não existe. Os 5 achados ausentes não foram reconstituídos um a um;
  cobri as áreas faltantes (prompt, overlays, painéis, larguras) com EU, O10/O12 e leitura direta.
- **Recalculei do zero** (script do apêndice, sobre `themes/*.json` e a regra de `ui-visual/diff.ts:31-33,128,234,259`):
  todos os pares de texto sobre fundos reais, tints do diff e ênfase; WCAG e Lc; e **todos os hex sugeridos**.
- Diferenças em relação a UP: (a) a ênfase do diff sai 1 unidade de canal diferente (`#56694a`, UP `#566949`) porque o
  código arredonda o tint antes de misturar; contraste 3,70 (UP 3,68). (b) UP conta 10 falhas no tokyo-night agrupando
  as 4 caixas de tool; contando cada par hex/fundo são 13. (c) UP propõe `success` claro `#007c7c` (4,51); no meu
  cálculo dá 4,23 sobre `userMessageBg`, então proponho `#007575`. (d) Para os hex de diff/sintaxe usei margem ≥ 4,55
  em **todos** os fundos e tints (UP aceita 4,51-4,53). (e) ΔE de daltonismo, 256 cores e OKLCH das cores atuais
  **não** foram recalculados: valem como relatados por UP.

## 1. Resumo

### Nota por tema (julgamento meu, base: pares medidos abaixo; escala 0-10)

| tema | nota | pares que falham (hex/fundo) | por quê |
|---|---|---|---|
| pi-noite (ativo, escuro) | 7 | 6 | texto principal ≥ 5,69:1; falham diff (ênfase 3,70) e `dim` sobre seleção (4,07) |
| pi-escuro | 6 | 5 | todos no diff; `dim`/accent/erro a 4,50-4,60 nas caixas; verde/vermelho colapsam na deuteranopia |
| pi-claro (ativo, claro) | 6 | 8 | só o diff falha, mas semânticas ficam a 4,5-5,0 nas caixas; sucesso/erro de mesma luminância |
| tokyo-night (histórico) | 4 | 13 | keyword roxa em todas as caixas; diff; `accent` magenta diverge dos outros temas |
| mono | n/a | n/a | sem cores (`""`): herda o terminal; contraste não calculável |

`settings.json:16` ativa `pi-claro/pi-noite` (onda 9); INV (G01, seção 2) ainda descreve `tokyo-night` como ativo:
**desatualizado**.

### Os 10 ajustes de maior impacto/esforço (detalhe nas seções 2 e 3)

> Nota do orquestrador (2026-11-19, após a escrita deste documento):
> (1) os dois primeiros itens da lista abaixo (`code-blocks/blocks.ts:171` e `code-blocks/index.ts:28`) foram
> corrigidos nesta auditoria como performance e estabilidade (unidade U3 de `02-seguranca-performance.md`);
> (2) a verificação cruzada (`research/verificacao-cruzada.md`) corrige o alvo APCA: Lc 60 só vale para texto de
> 24 px ou mais; texto de corpo pede Lc 90, mínimo Lc 75. Leia os alvos "Lc 60" deste documento como piso de rótulo
> secundário, e WCAG 2.x 4,5:1 como o critério normativo.

1. **Truncar o rótulo do fence** em `code-blocks/blocks.ts:171`: hoje um fence com info-string longa **derruba o pi**
   em terminal estreito (EU, ALTA; confirmado por EU em `tui-main-screen.js:485`). Esforço P.
2. **`remember` só com bloco fechado** (`code-blocks/index.ts:28`): o botão "⧉ copiar" deixa de funcionar após ~17 s
   de stream (EU, ALTA). Esforço P.
3. **`MIX` 0,30 → 0,18** (`diff.ts:31`): texto sobre a ênfase `+` passa de 3,70 para 4,70 (noite) e 3,67 → 4,64
   (tokyo). 1 linha.
4. **`selectedBg` `#283457` → `#202b4e`** (noite e tokyo): `dim` sobre seleção 4,07 → 4,61. 1 token.
5. **Hex de diff/sintaxe por tema** (tabelas da seção 2): zera as falhas nos 4 temas. ~15 tokens.
6. **Ampliar o gate** `ui-visual/test/theme-contrast.test.ts` com `dim`/seleção, texto/ênfase, sintaxe/tints,
   keyword/caixas e borda 3:1: sem isso as regressões voltam (todas passaram na onda 9).
7. **HUD**: respeitar `NO_COLOR` e medir com `visibleWidth` (`calm-statusline.mjs:33-39,221`; o outro script já
   respeita, `claude-hud-statusline.mjs:21`).
8. **Estados `cancelado` e `aguardando`** em `icons.ts:130-140` e uma língua por classe de mensagem
   (`Run` → `Executar`).
9. **Papéis semânticos fixos**: string de código não vermelha (escuro/claro) e `accent` azul em todos; ver tabela de
   consistência. Esforço M, **toca a decisão "paleta: sem mudança" de O12** (seção 3, nota).
10. **Cabeçalho compacto em terminal baixo** (< 30 linhas) e `thinkingText`/`toolDiffContext`/`mdLinkUrl` em `muted`.

## 2. Paletas

### 2.1 Método e metas

- [medido] Pares avaliados: `text`, `muted`, `dim`, `accent`, `error`, `warning`, `success`, `mdLink`, `mdCode`,
  `toolDiff*`, `thinkingText`, `syntax*` sobre `page`, `customMessageBg`, `userMessageBg`, `toolPendingBg`,
  `toolSuccessBg`, `toolErrorBg`, `selectedBg`; sintaxe e cor própria do diff sobre os tints
  (`mixRgb(cor, customMessageBg, 0,14)`, `diff.ts:33,234`); `text` sobre a ênfase (`diff.ts:259`).
- Falha: WCAG < 4,5. Limite: 4,5 ≤ WCAG < 5. Só falhas e pares marcantes entram nas tabelas.
- APCA (C32, verificado na página do autor; o próprio doc diz que APCA ainda é rascunho): Lc 60 mínimo para texto de
  conteúdo, Lc 75 corpo, Lc 45 texto grande, Lc 15 para divisores. WCAG 2.x segue normativo; Lc é régua secundária
  (R5 Q1-Q3). Texto principal e `muted` passam em ambos nos três temas
  (text −73,8/−99,8/+103,8; muted −59,3/−57,0/+93,3).
- Meta de projeto sugerida: WCAG ≥ 4,5 em todo texto de conteúdo sobre qualquer fundo/tint; `dim` só para metadado,
  com `muted` nos tokens de leitura; Lc ≥ 60 só para `muted` e acima.

### 2.2 pi-noite (escuro, ativo) · 6 pares falham

Colunas: `par | hex texto/fundo | WCAG | APCA Lc | meta | hex sugerido | contraste novo`.

| par | hex texto/fundo | WCAG | APCA Lc | meta | hex sugerido | contraste novo |
|---|---|---|---|---|---|---|
| `dim` / `selectedBg` | #8a93bd / #283457 | 4,07 | −38 | 4,5 | `sel` → #202b4e | 4,61 (Lc −41) |
| `text` / ênfase `+` | #c0caf5 / #56694a | 3,70 | −53 | 4,5 | `MIX` 0,18 → #4a5844 | 4,70 (Lc −59) |
| `toolDiffRemoved` / tint `−` | #f7768e / #433241 | 4,48 | −44 | 4,5 | `err` → #f97890 | 4,56 (tint #443241) |
| `syntaxFunction` / tint `+` | #7aa2f7 / #373e3c | 4,35 | −44 | 4,5 | token → #7ea7fc | 4,60 |
| `syntaxOperator` (dim) / tint `+` | #8a93bd / #373e3c | 3,65 | −36 | 4,5 | token → `muted` #a9b1d6 | 5,19 |
| `syntaxPunctuation` (dim) / tint `−` | #8a93bd / #433241 | 3,95 | −38 | 4,5 | token → `muted` #a9b1d6 | 5,59 |
| limite: `dim` / `toolErrorBg` | #8a93bd / #3b2934 | 4,50 | −40 | 5 | (decisão: manter) | 4,50 |
| limite: `text` / ênfase `−` | #c0caf5 / #794658 | 4,60 | −58 | 4,5 | `MIX` 0,18 → #653f4f | 5,47 |
| borda `border` / caixas | #3b4261 / #262734 | 1,50 | n/a | 3 só no editor | #6d7698 | 3,30 |

- `operator`/`punctuation` sobre `dim` é o único jeito de manter a hierarquia text > muted > dim sem clarear `dim`
  (levar `dim` a Lc 60 o torna mais claro que `muted`, UP §2). Mudar `selectedBg` e dois tokens de sintaxe é mais
  barato que mexer em `dim`.
- `err` é compartilhado: mudar para #f97890 também clareia `error`/`toolDiffRemoved`; `error` sobre `selectedBg` vai
  de 4,62 para 5,35.
- Cuidado [sugestão]: `MIX` 0,18 deixa a ênfase por palavra mais sutil (ΔL menor frente ao tint); **a legibilidade
  da ênfase não foi vista na tela**.
- UP também propôs `sel` `#212d4f` e `err` `#f8778f`; ficam em 4,53-4,52, sem margem. Preferi os valores acima.

### 2.3 pi-escuro · 5 pares falham

| par | hex texto/fundo | WCAG | APCA Lc | meta | hex sugerido | contraste novo |
|---|---|---|---|---|---|---|
| `toolDiffRemoved` / tint `−` | #ff6961 / #4a3535 | 4,02 | −40 | 4,5 | `err` → #ff8479 | 4,61 (tint #4a3838) |
| `syntaxComment` / tint `+` | #98a4b0 / #2d4334 | 4,21 | −43 | 4,5 | `com` → #a0acb8 | 4,63 |
| `syntaxKeyword` / tint `+` | #ff7ab2 / #2d4334 | 4,42 | −46 | 4,5 | `kw` → #ff81b5 | 4,61 |
| `syntaxString` / tint `+` | #ff8170 / #2d4334 | 4,39 | −45 | 4,5 | `str` → #ff8877 | 4,60 |
| `syntaxComment` / tint `−` | #98a4b0 / #4a3535 | 4,47 | −44 | 4,5 | `com` → #a0acb8 | 4,75 |
| limite: `dim` / `toolPendingBg` | #98989d / #12363f | 4,50 | −41 | 5 | `dim` → #9e9ea3 | 4,84 (mín. em todas as caixas) |
| limite: accent / `toolPendingBg` | #409cff / #12363f | 4,56 | −42 | 5 | (manter) | 4,56 |
| `scrollbarThumb` / `userMessageBg` | #757579 / #243246 | 2,83 | n/a | 3 | thumb → #7a7a7e | 3,03 |
| borda `border` / caixas | #48484a / #2c2c2e | 1,53 | n/a | 3 só no editor | #7a7a7c | 3,25 |

- `error` sobre `userMessageBg` sobe de 4,60 para 5,45 com `err` #ff8479.
- Strings (`str` #ff8170) e `err` são ambos coral: ver consistência semântica.

### 2.4 pi-claro (ativo, claro) · 8 pares falham

Pares de cor própria do diff e de sintaxe sobre os dois tints. Fundos novos mudam alguns canais (tint depende da cor).

| par | hex texto/fundo | WCAG | APCA Lc | meta | hex sugerido | contraste novo |
|---|---|---|---|---|---|---|
| `toolDiffAdded` / tint `+` | #1d7a34 / #d4e1dc | 4,02 | 57 | 4,5 | `ok` → #0f712c | 4,51 (tint #d2e0db) |
| `toolDiffRemoved` / tint `−` | #d70015 / #eed0d7 | 3,75 | 51 | 4,5 | `err` → #bd0413 | 4,59 (tint #ebd1d7) |
| `syntaxComment` / tint `−` | #5d6c79 / #eed0d7 | 3,77 | 54 | 4,5 | `com` → #505e6b | 4,64 |
| `syntaxComment` / tint `+` | #5d6c79 / #d4e1dc | 4,01 | 58 | 4,5 | `com` → #505e6b | 4,89 |
| `syntaxFunction` / tint `−` | #326d74 / #eed0d7 | 4,09 | 56 | 4,5 | `fn` → #2a656c | 4,61 |
| `syntaxFunction` / tint `+` | #326d74 / #d4e1dc | 4,36 | 60 | 4,5 | `fn` → #2a656c | 4,86 |
| `syntaxString` / tint `−` | #c41a16 / #eed0d7 | 4,17 | 55 | 4,5 | `str` → #bb080a | 4,64 |
| `syntaxString` / tint `+` | #c41a16 / #d4e1dc | 4,45 | 58 | 4,5 | `str` → #bb080a | 4,89 |
| limite: `dim` / `userMessageBg` | #6a6a6f / #e0edf9 | 4,52 | 65 | 5 | `dim` → #65656a | 4,87 (mín. caixas) |
| limite: `success` / `userMessageBg` | #1d7a34 / #e0edf9 | 4,54 | 65 | 5 | `ok` → #0f712c | 5,16 |
| `scrollbarThumb` / `userMessageBg` | #8e8e93 / #e0edf9 | 2,74 | n/a | 3 | thumb → #87878c | 3,00 |
| borda `border` / caixas | #c7c7cc / #f2f2f7 | 1,51 | n/a | 3 só no editor | #87878c | 3,20 |

- `accent`, `error`, `mdLink` sobre `userMessageBg` ficam em 4,52-4,68 (limite): margem fina em tema claro.
- Lc do claro é positivo e ≥ 57 em quase tudo: o claro tem folga APCA que o escuro não tem (assimetria, C60 em R5,
  cálculo local do R5, "a conferir com apcacontrast.com").

### 2.5 tokyo-night (histórico, selecionável) · 13 pares falham

| par | hex texto/fundo | WCAG | APCA Lc | meta | hex sugerido | contraste novo |
|---|---|---|---|---|---|---|
| `syntaxKeyword` / `toolPendingBg` | #9d7cd8 / #1c2c38 | 4,30 | −37 | 4,5 | `purple` → #ba99f7 | 6,13 |
| `syntaxKeyword` / `customMessageBg`, `userMessageBg` | #9d7cd8 / #24283b | 4,38 | −37 | 4,5 | idem | 6,23 |
| `syntaxKeyword` / `toolSuccessBg` | #9d7cd8 / #1c2b2a | 4,42 | −38 | 4,5 | idem | ≥ 6,1 |
| `syntaxKeyword` / `selectedBg` | #9d7cd8 / #283457 | 3,67 | −35 | 4,5 | + `sel` #202b4e | 5,92 |
| `syntaxKeyword` / tint `+` | #9d7cd8 / #353f42 | 3,25 | −32 | 4,5 | idem | 4,63 |
| `syntaxKeyword` / tint `−` | #9d7cd8 / #423347 | 3,51 | −34 | 4,5 | idem | 4,88 (tint #433548) |
| `syntaxComment` (dark5) / tint `+` | #8a93bd / #353f42 | 3,60 | −36 | 4,5 | token → `fgDark` #a9b1d6 | 5,12 |
| `syntaxComment` / tint `−` | #8a93bd / #423347 | 3,89 | −38 | 4,5 | idem | 5,40 |
| `syntaxComment`, `dim` / `selectedBg` | #8a93bd / #283457 | 4,07 | −38 | 4,5 | `sel` → #202b4e | 4,61 (comentário 6,56) |
| `text` / ênfase `+` | #c0caf5 / #546a4e | 3,67 | −52 | 4,5 | `MIX` 0,18 | 4,64 |
| `toolDiffRemoved` / tint `−` | #f7768e / #423347 | 4,42 | −44 | 4,5 | `red` → #fe8499 | 4,87 |
| `syntaxFunction` / tint `+` | #7aa2f7 / #353f42 | 4,30 | −44 | 4,5 | token → #80a8fe | 4,61 |
| `mdQuoteBorder` / página | #414868 / #1a1b26 | 1,91 | n/a | 3 se for sinal | (decorativo) | n/a |

- Os 13 pares (token/fundo): `syntaxKeyword` em 4 caixas (pending, custom, user, success), em `selectedBg` e nos 2 tints
  = 7; `syntaxComment` nos 2 tints = 2; `dim`/`selectedBg` (o mesmo hex vale para `syntaxComment`) = 1; ênfase = 1;
  diff `−` = 1; função/tint `+` = 1; total 13.
- Tokyo e pi-noite **partilham os mesmos hex-base e trocam o papel de accent**: um dos dois deveria ser aposentado
  (ver consistência). Como tokyo é histórico, o lote mínimo é só `purple` + `sel` + `MIX`.

### 2.6 mono

- [medido: nenhum] Todas as 56 chaves são `""`; o tema herda o terminal. Contraste e 256 cores dependem do tema do
  usuário e não são calculáveis aqui. O teste de contraste o pula (O10 Resultados: 1 teste pulado).
- [sugestão] Para `NO_COLOR`, `mono` está certo; o que falta é o HUD (seção "256 cores e NO_COLOR").

### 2.7 Resultado combinado das sugestões [medido, script do apêndice com `prop.json`]

Aplicando todos os hex, `MIX` e `sel` acima: **0 pares abaixo de 4,5** nos 4 temas (de 41 falhas
por par-token no estado atual para 0). Menor margem restante: 4,51 (`toolDiffAdded`/tint `+` no claro) e 4,60
(função/tint no
noite). Bordas 3:1 e thumb: valores das tabelas, verificados pelo script.

Resumo das mudanças por tema (nome do token no JSON; `err`, `ok`, `com`, `fn`, `str`, `kw` são `vars` dos temas):

| tema | `sel` | `err`/`toolDiffRemoved` | `ok` | sintaxe | `MIX` (`diff.ts:31`) |
|---|---|---|---|---|---|
| pi-noite | #202b4e | #f97890 | — | `syntaxFunction` #7ea7fc; operator/punct → `muted` | 0,18 |
| pi-escuro | — | #ff8479 | — | com #a0acb8; str #ff8877; kw #ff81b5 | — |
| pi-claro | — | #bd0413 | #0f712c | com #505e6b; fn #2a656c; str #bb080a | — |
| tokyo-night | #202b4e | `red` #fe8499 | — | purple #ba99f7; comment → `fgDark`; fn #80a8fe | 0,18 |

Matiz mantida (OKLCH: L alterado, C e h preservados; se saísse do gamut sRGB, C reduzido): hex obtidos por bisseção de
L com o solver descrito no apêndice (não reproduzido por inteiro neste doc); a validação de contraste é o script do
apêndice. As cores de `warning` e de `accent` não mudam (accent no noite fica a 4,35 só na combinação mdLink/tint, que
não é par real de uso).

### 2.8 Consistência semântica entre temas [medido em UP; [sugestão] nas ações]

| papel | pi-noite | pi-escuro / pi-claro | tokyo-night | problema |
|---|---|---|---|---|
| `accent` | azul #7aa2f7 | azul | **magenta** #bb9af7 | mesmo papel, cor diferente |
| `mdCode` | magenta | roxo | **verde (= success)** | código inline lê como "ok" no tokyo |
| `syntaxString` | verde | **vermelho** (≈ erro, ΔE 4,6 e 3,7) | verde | string lê como erro no escuro/claro |
| `thinkingMax`/`Xhigh` | accent | warn (amarelo) | amarelo | escala de esforço sem convenção |
| `thinkingMedium` | text | accent | magenta | idem |
| `syntaxType` (= "executando") | ciano #7dcfff | ciano / **azul-marinho #0b4f79** (claro) | #2ac3de | "executando" quase some no claro |

- [sugestão] Fixar o papel antes da cor: vermelho/verde só para erro/sucesso (strings de código passam a âmbar ou
  azul-petróleo, tipo no escuro/claro mantém ciano com L ajustado); `accent` azul em todos (ou aposentar o tokyo).
- Isto colide em parte com O12 ("paleta: sem mudança"): ver seção 3, nota 1.
- Evidência externa: Selenized corrige hues confusos (laranja~vermelho, magenta~vermelho) e fixa a luminosidade por
  papel em CIE Lab (C35, verificado na 1ª página: `whats-wrong-with-solarized.md`; a 2ª, `features-and-design.md`,
  não foi verificada na página).
  Radix usa 12 passos com função fixa e garante Lc 60 / Lc 90 do passo 11/12 sobre o passo 2 (C34, verificado em
  `radix-ui.com/colors/docs/palette-composition/understanding-the-scale`).

### 2.9 Daltonismo [UP, ΔE em OKLab ×100; não recalculado]

| tema | sucesso/erro normal | deuteranopia | protanopia | razão de luminância | tints do diff (normal → deut) |
|---|---|---|---|---|---|
| pi-noite | 26,8 | **9,0** | 19,9 | 1,45 | 4,7 → **2,1** |
| pi-escuro | 34,6 | **3,7** | 19,7 | 1,40 | 6,5 → **0,7** |
| pi-claro | 31,9 | **8,1** | 11,2 | **1,00** | 5,2 → **1,2** |
| tokyo-night | 26,8 | 9,0 | 19,9 | 1,45 | 4,7 → 2,2 |

- Mitigação existente [UP]: `+`/`−` no diff (`diff.ts:296-297`) e palavra + glifo `✓`/`✕` no estado. Não é falha de
  WCAG 1.4.1, mas as barras de HUD só separam ok/crit por cor e limiar.
- [sugestão, opcional] Deslocar só `success`: pi-escuro `#30d158` → `#00d5d4` (+46° de matiz, ΔE 15,1 deut e 23,2 prot
  segundo UP; 7,08-9,29:1 nos fundos testados por mim); pi-claro → **`#007575`** (4,6+ em todas as caixas; o
  `#007c7c` de UP falha em `userMessageBg`: 4,23). ΔE de `#007575` **não calculado**. Noite/tokyo: UP não achou
  deslocamento de `success` que resolva; alternativa é o erro em `#e979bd` (ΔE 15,0), não verificada por mim.
- Como mudar o "verde = ok" é uma decisão de identidade, proponho **uma variante daltônica selecionável** em vez de
  trocar o padrão (R5 Q6; C39 Primer redefine sucesso/erro como azul/laranja nas variantes de daltonismo, e C40 cita
  Okabe-Ito `#E69F00 #56B4E9 #009E73 #F0E442 #0072B2 #D55E00 #CC79A7 #000000`; ambas **não verificadas na página**,
  snippet do buscador).
- C38 (**não verificado na página**) lembra que `git diff` usa vermelho/verde; fique em `+`/`−` e rótulo como base.

### 2.10 256 cores e `NO_COLOR`

- [inferido por UP; quantizador do core do pi não lido] Em 256 cores os fundos de estado colapsam:
  - pi-claro: os 6 fundos viram `#eeeeee` (seleção e estados se perdem); `success` #1d7a34 → #00875f cai a 3,91:1.
  - pi-noite: `userMessageBg`, `toolPendingBg`, `toolSuccessBg`, `toolErrorBg` viram `#303030`; `dim`/`toolErrorBg`
    vai de 4,50 a 3,84.
  - pi-escuro: `page`/`toolSuccessBg`/`toolErrorBg` → `#1c1c1c`; os outros quatro → `#303030`.
  - Movimento: degrada para texto plano sem `38;2` (`motion.ts:6`, UP).
- [medido por leitura] `claude-home/bin/hud/calm-statusline.mjs:33-36` pinta sempre `38;2`; não achei `NO_COLOR` nele.
  `claude-hud-statusline.mjs:20-21` o respeita ("o claude-hud não o respeita; tira as cores SGR"). Qual dos dois a
  sessão usa **não foi confirmado**.
- [sugestão] (a) Em 256/16 cores usar o tema `mono` (que `a11y.ts` já aplica com `NO_COLOR`) ou fundos com ≥ 1 passo do
  cubo xterm de diferença; (b) HUD respeita `NO_COLOR`; (c) a ordem de precedência `NO_COLOR`/`FORCE_COLOR`/flag do
  usuário: C42 (`force-color.org`, verificado na página) diz que config do usuário e argumento por instância devem poder
  sobrepor a variável e que o exemplo dá a `FORCE_COLOR` precedência; a proposta é informal. `no-color.org` e
  `COLORTERM` (C42, termstandard): **não verificados na página**.
- C41 (Ghostty `minimum-contrast`, **não verificado na página**): usuários sobem a 2-3 por causa de TUIs com texto
  claro em tema claro; texto abaixo de ~3:1 seria recolorido pelo terminal (R5 Q10). O pior par de texto atual é 3,25:1
  (keyword do tokyo no tint), acima de 3:1; após a seção 2.7 o piso é 4,5:1.

### 2.11 Tokens não usados e não definidos [UP]

- Definidos e **não usados pelas extensões**: `md*`, `syntax*` (menos `syntaxType`), `thinking*` (menos `thinkingText`),
  `bashMode`, `scrollbar*`, `searchMatch*`, `customMessageText/Label`, `userMessageText`. Só o core do pi os consome
  (core **não verificado**). Não remover sem checar o core.
- Usados e **não definidos**: nenhum (todo nome passado a `theme.fg/bg/getFgAnsi` existe em `colors`).
- Derivados fora do tema: fundo do aviso (`warnBgRgb`, `icons.ts`) e tints/ênfase do diff (`TINT`, `MIX`): sem token e
  sem teste, exceto o aviso. [sugestão] criar `toolDiffAddedBg`/`toolDiffRemovedBg` no tema para que o gate os veja.

### 2.12 Gate de contraste [UP; leitura do teste]

`ui-visual/test/theme-contrast.test.ts` não cobre: `dim`/`selectedBg`, texto sobre a ênfase, sintaxe sobre os tints,
`syntaxKeyword` sobre caixas de tool e borda 3:1. [sugestão] adicionar esses pares com os valores deste documento
(teste vermelho primeiro, como manda a política do repositório) e incluir o piso APCA como relatório, não como falha.

## 3. UI

**Notas de conflito/coincidência com propostas em curso (leia antes da tabela):**

1. **O12 classifica "paleta" como "sem mudança"** (46 escolhas do dono em 2026-11-18). Os ajustes de hex são
   correções de acessibilidade medidas, mas **mexem em paleta**: dependem de o dono reabrir essa escolha. Os que não
   mudam a aparência (`MIX`, `selectedBg`, gate) são os mais seguros.
2. **O12, "Travamento"**: o dono pediu "deixe animação e efeitos como tava"; o achado de CPU com chamada sem resultado
   ficou aberto. A sugestão A1 reabre isso: não é contradição, mas decisão do dono.
3. **O12 D10** remove a palavra `concluído` do sucesso de ferramentas de uma linha: ícone `✓` + ausência de palavra.
   É o oposto de C44 (Primer: "ícone sempre com rótulo `Success:`/`Warning:`/`Error:`", verificado na página
   `primer-docs-preview.github.com/accessibility/foundations/cli-accessibility`). `✕ erro` continua explícito;
   o risco é só do sucesso (UP). Registrar como risco consciente.
4. **O10 P03** (tokens de movimento) foi rejeitado: durações seguem como constantes locais; nada abaixo propõe tokens.
5. **INV (G13, §5.2)** pedia "contraste medido, não presumido": este documento e o script fecham o ponto nos 4 temas.

Colunas: `sev` (A alta, M média, B baixa) · `área` · `arquivo:linha ou doc` · `problema observável` · `ajuste sugerido`
· `já previsto em onda10/12?`. Evidência é leitura de código (**[inferido]**), salvo **[medido]**; **nenhuma tela foi
vista rodando**.

| sev | área | arquivo:linha ou doc | problema observável | ajuste sugerido | previsto em O10/O12? |
|---|---|---|---|---|---|
| A | largura / código | `code-blocks/blocks.ts:171` (via `index.ts:112`), EU | Fence com info-string longa e sem espaço vira rótulo sem truncar; a linha passa de `width` e o pi-tui lança "Rendered line exceeds terminal width" e encerra o pi (EU confirmou em `tui-main-screen.js:485`). Em 60 colunas basta ~45 colunas de rótulo. | `truncateToWidth(lang, inner - visibleWidth(button) - 1)` antes de montar a linha; teste com rótulo de 80 colunas. | Não. O12 lane E é dono de `code-blocks/**` (D8), mas não cita este bug. |
| A | transcript / copiar | `code-blocks/index.ts:28`, EU | `remember` roda a cada render do token; durante o stream cada prefixo vira entrada nova e o limite `MAX_BLOCKS=500` estoura em ~17 s: o botão "⧉ copiar" responde "Bloco não está mais em memória". | Chamar `remember` só quando o bloco estiver fechado. | Não (O12: "bloco de código: manter, cabeçalho + copiar", sem checar a vida do botão). |
| A | movimento / custo | `onda12-macos/PLANO.md` (Travamento), UP | pi parado gastou 36-82% de CPU (sessão de ~1.250 entradas); `write` sem resultado desenhada como "executando" e relógio contínuo (16/33 ms). | Parar o relógio quando a ferramenta não tem resultado; medir com `perf.mjs`. | **Sim, em aberto**: O12 reverteu a correção por decisão do dono. Ver nota 2. |
| A | diff | `ui-visual/diff.ts:31,259-267` **[medido]** | Texto sobre a ênfase `+`: 3,70:1 (noite) e 3,67 (tokyo). É conteúdo (WCAG 1.4.3). | `MIX` 0,30 → 0,18 (4,70/4,64). | Não. |
| M | diff | `diff.ts:296-297`; `ui/diff.ts` **[medido]** | Número e sinal `−` sobre o tint: 4,48 (noite), 4,02 (escuro), 4,42 (tokyo), 3,75 (claro; `+` 4,01). O sinal é o único marcador não-cor do diff. | Hex da seção 2 (ou `TINT` menor, só se a ΔE do tint continuar visível). | Não. |
| M | diff / sintaxe | `diff.ts:260-269` **[medido]** | Sintaxe sobre tints falha em claro (8 pares), escuro (3), tokyo, noite (operador 3,65). Gate não cobre. | Hex da seção 2 + pares no gate (2.12). | Não. |
| M | seleção | `ui/history.ts:302`; `ui/diff.ts:145,187` **[medido]** | `dim` sobre `selectedBg` 4,07 (noite/tokyo): linhas selecionadas de histórico e diff. | `sel` → #202b4e. | O12 D16/lane C tocam essas folhas (histórico A, `/diff` A), sem tratar contraste. |
| M | tema | `tokyo-night.json` **[medido]** | `syntaxKeyword` #9d7cd8: 4,30-4,42 em todas as caixas. | #ba99f7. | Não (tema histórico). |
| M | transcript / estados | `themes/*.json` (`userMessageBg`, `tool*Bg`) **[UP medido]** | Fundos de estado quase iguais ao neutro: noite usuário/pendente ΔE 2,1; sucesso = neutro por decisão (D3, onda 7); claro: pendente 1,1, sucesso 1,9, erro 1,6. Diferença depende de título e glifo. | Tratar fundo como reforço, nunca como sinal único; subir croma de `toolErrorBg` no claro. | O12 D10 reduz ainda a palavra do sucesso (nota 3). |
| M | 256 cores | cálculo [UP inferido] | Fundos colapsam (claro: 6 viram `#eeeeee`; noite: 4 viram `#303030`); seleção some no claro. | Detectar `getColorMode()`; usar `mono` ou fundos com passo ≥ 1 no cubo; ler o quantizador do pi. | O10 A5 exige fallback "sem truecolor" por cartão; não trata fundos. |
| M | texto de leitura | `themes/*.json`: `thinkingText`, `toolDiffContext`, `mdLinkUrl` = `dim` | Conteúdo em `dim`: 4,5-4,9, Lc −41 a −45 (abaixo de 60). | Usar `muted` nesses 3 tokens. Raciocínio já recolhido por padrão (`hideThinkingBlock`), UP. | O12 D9 (raciocínio A: `◇ pensou por 8s`) muda a forma, não o token. |
| M | daltonismo | `themes/pi-escuro.json`, `pi-claro.json` **[UP]** | Verde e vermelho: ΔE 3,7 (escuro, deut), luminância igual (claro). HUD distingue ok/crit só pela cor e pelo limiar. | Variante daltônica selecionável (2.9); manter glifo/palavra junto ao estado. | O12 D14 (limite de uso) usa barra + cor + texto; não trata daltonismo. |
| M | microcopy | `motion/shell.ts:123,149`; `icons.ts:140`; `editor.ts:143`; `folha/confirm.ts:14`; INV E04,E06,E15,D19 | Mistura pt/en no mesmo cartão: `Run ─ comando`, `OK`/`Erro`, `executando`/`atenção`, `INSERT`/`NORMAL`; `confirm.ts:14` traduz `Allow this command?` do pi-code; E04/E06/E15/D19 seguem em inglês. | Um idioma por classe de mensagem (INV §5.5); `Run` → `Executar`; `OK` → `concluído`. Cuidado com `Read`/`Edit` nativos. | **Parcial**: O12 D16 ("agentes em português") e D15; `Run` e modos vim ficam. |
| M | estados | `icons.ts:130-140`; `motion/shell.ts:52` | `Estado` só tem `run/warn/ok/err`; "cancelado" só no bash (`interrompido`); "aguardando permissão" só como confirmação, sem estado persistente na caixa. | Estados `cancelado` e `aguardando` com palavra própria. | O12 "interrompido: sem mudança"; D15 confirmação B não cria estado na caixa. |
| M | semântica | `themes/*.json` | Mesma função, cor diferente por tema (2.8). | Fixar papel antes da cor. | Não (O12: "paleta: sem mudança", nota 1). |
| M | prompt | `ui/editor.ts:489-517`; UP | Borda sem foco do editor em 1,5-1,9:1 (WCAG 1.4.11 se for a única marca do campo); o modo `NORMAL` tem rótulo (`editor.ts:143,506`); borda focada usa ciano. | #6d7698 e equivalentes, só no token de borda do editor. | O12 "campo de entrada / estados do campo: sem mudança". |
| M | HUD | `claude-home/bin/hud/calm-statusline.mjs:33-39,221`; EU | Pinta `38;2` sempre, sem `NO_COLOR`; largura por `[...s].length` (glifo largo e Nerd Font descontam errado); último fallback (`tries.at(-1)`) pode passar de `columns`. | `NO_COLOR` (como `claude-hud-statusline.mjs:21`), `visibleWidth`, truncar. Confirmar qual script a sessão usa. | O12 D3 (duas linhas quando cabe, três abaixo) mexe no mesmo código, sem tratar `NO_COLOR`. |
| M | cabeçalho / alturas | `ui-visual/header.ts:41-44`; `motion/nycode.ts:22` (`MARCA_W = 70`) | Logo de 7 linhas + linha em branco: 9 linhas no topo; abaixo de 71 colunas só a linha de texto; a 80 colunas ocupa quase 40% de um terminal de 24 linhas. Atalhos caem na ordem `?`, `/`, `!`. | Compactar a marca em terminais baixos (< 30 linhas). | O12 "cabeçalho: sem mudança"; O10 D13/P19 só anima a abertura. |
| M | overlays / permissão | `folha/confirm.ts`; R5 U3 (C47, C48) | Permissão como sim/não deixa de carregar informação (C47: um artigo sem origem primária cita "93% aceitos"; **não verificado na página**, e proponho não usar o número). | Mostrar a consequência (comando/caminho/diff) na confirmação; agrupar por diretório. | **Parcial**: O12 D15 (confirmação B com botão perigoso por gravidade) cobre gravidade, não o efeito. |
| M | painéis plano/agentes | patches pi-code; INV E05, E09-E11; O12 D5, D16, R6 | **Não avaliados**: são patches do pi-code com 12 "ambíguos" no INV; forma real desconhecida. | Aguardar R1/R6 e a lane D; só então checar contraste e largura. R5 U11 sugere uma linha de resumo "n em execução/aguardando/erro" (evidência fraca, ver Lacunas de R5). | **Sim**: O12 D5 (plano A), D12 (subagente em árvore), D16 (agentes em português, cor/ícone em R6). |
| M | movimento | `ui/a11y.ts:25-31`; `working.ts:132` | `movimento()` único (normal/reduzido/desligado) respeita `PI_REDUCED_MOTION`, `TERM=dumb`, `NO_PROGRESS`; `desligado` troca por "trabalhando… · esc interrompe". Não segue `prefers-reduced-motion` do SO (terminal não expõe). | Documentar as variáveis; C43/C44 (verificados) mostram o padrão do `gh` (`spinner disabled`) e do Primer (progresso nunca só por animação). | **Sim**: O10 D1/D2 e P01; O12 D6 (título animado respeita `/movimento`). |
| B | largura | `ui-visual/icons.ts:187` | `marcaUsuario` conta code points: CJK/emoji desalinham a hora (o comentário `ponytail:` admite). | `visibleWidth` do pi-tui. | Não. |
| B | largura 60/80 | `motion/chrome.ts:55-62` **[inferido]** | Atalho e hora só aparecem com ≥ 10 colunas livres; em 60 colunas o atalho cai, depois a hora; abaixo de 30 só o título. Hipótese: o corte do título pode comer o nome do arquivo (`splitFile`). | Testar `fit(row, …)` com `splitFile` em 60 colunas no mock. Não medi. | O10 P06/D5 (`executando · 14s`), sem tratar a largura. |
| B | largura 120/200 | `chat-margin/index.ts` | `rg` em `chat-margin` não achou teto de medida do texto; em 200 colunas linhas de assistente podem ficar longas. **Não verificado** na tela. | Se confirmado, limitar a medida do texto (~100-120). | Não. |
| B | ícones | `icons.ts:96-106,16-18,45-46` | Nerd Font só por kitty ou `PI_NERD_FONT=1`; `PI_NERD_FONT=1` sem a fonte mostra "tofu"; em Unicode `edit`/`write`/`memory` e `pending` usam `●`; `read`/`grep`/`find`/`ls`/`lsp` usam `○`. | Distinguir `pending` das famílias por forma. | **Sim**: O12 D1 (ícones por família); custo registrado aqui. |

Notas: a tabela cobre os 20 achados visíveis de UP (os 5 finais estão cortados) mais 5 linhas de EU, INV, O12 e R5 com
efeito visível; os demais achados de EU (cache de realce, sticky, perf do editor, vazamento de `vivo.ts`) são de
performance e ficam em `01-gaps-bugs-logs.md`/`02-seguranca-performance.md`.
Contagem da tabela (conferida por script): **25 linhas = 4 A + 17 M + 4 B**.

### 3.1 Evidência externa usada na seção 3 (status por fonte)

| Cn | afirmação usada | URL | status |
|---|---|---|---|
| C43 | `gh`: paleta ANSI do usuário; spinner trocado por texto estático (leitor de tela) | `github.blog/engineering/user-experience/building-a-more-accessible-github-cli` | verificado |
| C44 | Primer CLI: ícone com rótulo; `NO_COLOR`; progresso nunca só por animação | `primer-docs-preview.github.com/accessibility/foundations/cli-accessibility` | verificado (diretriz em prévia) |
| C32 | APCA Lc 60/75/45/15; WCAG 2.x superestima escuros (rascunho) | `git.apcacontrast.com/documentation/APCA_in_a_Nutshell.html` | verificado |
| C47 | permissão: mostrar efeito; "93%" sem origem | `dev.to/artemkireev/...`; `deska.dev/blog/agent-approval-ux-design` | **não verificado na página** (snippet, secundário) |
| C39, C40, C38 | Primer variantes de daltonismo; Okabe-Ito; `git diff` vermelho/verde | `primer.style/foundations/color/overview` e outras | **não verificado na página** (snippet) |
| C41 | Ghostty `minimum-contrast` | `mintlify.com/ghostty-org/ghostty/features/themes` | **não verificado na página** (snippet) |
| C24, C25 | modo 2031 (tema claro/escuro) e multiplexadores | `contour-terminal.org/vt-extensions/color-palette-update-notifications` | **não verificado na página** (snippet); C20 (tmux 3.6 modo 2031) verificado |

[sugestão] **Auto claro/escuro** (R5 Q9): `settings.json:16` mostra `"pi-claro/pi-noite"`; não verifiquei se o pi decide
sozinho nem como; fica como lacuna.

## 4. Ordem sugerida

Lotes pequenos, cada um com verificação no mock `bin/ny-pi-mock` (cena de diff e de transcript; comandos exatos do mock:
`/mock-ui chat cancelar` e `/mock-ui historico completo` aparecem em `docs/perf-sota.md:148-149`; o de diff, a confirmar
com `bin/ny-pi-mock --help`) mais o script do apêndice. **Nada disto foi executado.**

| lote | conteúdo | arquivos | verificação |
|---|---|---|---|
| L1 | Truncar rótulo do fence; `remember` só em bloco fechado | `code-blocks/blocks.ts`, `index.ts` | TDD: teste com rótulo de 80 colunas e stream de 600 prefixos; no mock, resposta com fence longa a 60 colunas sem encerrar o pi |
| L2 | `MIX` 0,18 e `sel` #202b4e | `ui-visual/diff.ts:31`, `themes/pi-noite.json`, `tokyo-night.json` | script do apêndice (0 falhas nos dois); no mock, abrir um diff `edit` e olhar a ênfase `+` e a linha selecionada |
| L3 | Hex de diff/sintaxe dos 4 temas (tabelas 2.2-2.5) | `themes/*.json` | script com `prop.json` (0 falhas); mock: diff nos 4 temas |
| L4 | Estender `theme-contrast.test.ts` (pares da 2.12 e borda do editor a 3:1) | `ui-visual/test/theme-contrast.test.ts` | vermelho com temas atuais, verde após L2/L3 |
| L5 | HUD: `NO_COLOR`, `visibleWidth`, truncar | `claude-home/bin/hud/calm-statusline.mjs` | teste com `NO_COLOR=1` e linha de 40 colunas; mock em tmux estreito |
| L6 | Estados `cancelado`/`aguardando`; microcopy (`Run`, `OK`) | `icons.ts`, `motion/shell.ts`, `folha/confirm.ts` | snapshot de cada estado sem cor; mock: cancelar com Esc, pedir permissão |
| L7 | `thinkingText`/`toolDiffContext`/`mdLinkUrl` → `muted`; borda do editor e thumb a 3:1 | `themes/*.json` | script; mock: raciocínio aberto e editor sem foco |
| L8 | Cabeçalho compacto em < 30 linhas; teste de larguras 60/80/120/200 | `ui-visual/header.ts` | mock em tmux com `resize-window` nas 4 larguras |
| L9 | (opcional, decisão do dono) papéis semânticos fixos, variante daltônica, fallback 256 cores | temas + `a11y.ts` | simulação CVD (script do UP) e mock com `TERM=xterm-256color`; ler o quantizador do pi antes |

L1-L4 resolvem as falhas medidas e o crash; L5-L8 são independentes entre si; L9 reabre a decisão "paleta: sem mudança".

## 5. Não verificado

- **Nenhuma tela foi vista**: `bin/ny-pi-mock` não foi executado (exige sandbox bwrap, pi e tmux). Todo achado de UI é
  leitura de código; larguras 60/80/120/200 não foram medidas.
- Leitor de tela e navegador: não usados. Painéis de plano e agentes: não avaliados (patches do pi-code, forma real
  desconhecida; INV §6).
- 256 cores: quantização inferida pelo cubo xterm padrão; quantizador do core do pi não lido.
- Daltonismo (ΔE, Machado 2009) e OKLCH de origem: relatados por UP, não recalculados; ΔE de `#007575` não calculado.
- APCA 0.0.98G: implementação própria, **não conferida** contra `apca-w3`/apcacontrast.com (C60 em R5 diz o mesmo).
- Linhas `path:linha` citadas de UP e EU não foram todas reabertas: reabri `a11y.ts:20-32`, `diff.ts:31-33,126-134,
  225-269`, `header.ts:41-44`, `chrome.ts:50-62`, `editor.ts:143,506`, `confirm.ts:14`, `icons.ts:140,187`,
  `working.ts:132`, `calm-statusline.mjs:33,39,221`, `claude-hud-statusline.mjs:20-21`, `shell.ts:52,149`; as demais
  ficam **SKIPPED**. Linhas podem ter deslocado (EU avisa: `ui/editor.ts` e `ui-visual/motion/*` mudaram há horas).
- O que nem UP nem eu verificamos: ordem de carga entre `ui/a11y.ts` e `ui-visual/header.ts` (INV §2); se a sessão
  usa `calm-statusline.mjs` ou `claude-hud-statusline.mjs`; auto claro/escuro por modo 2031.
- Fontes externas com status `snippet` estão marcadas "não verificado na página" nas seções 2 e 3. O R5 usou um único
  provedor (Keenable; Exa HTTP 402) e não cumpriu a verificação cruzada (Lacunas de `research/r5-tui-paletas-perf.md`).
- Nenhum teste, gate ou suíte rodou. Isto é um documento, não prova de que as sugestões passam no gate do repositório.

## 6. Apêndice: script de contraste (≤ 40 linhas)

Arquivo usado: `/tmp/pal3/c2.py` (38 linhas). Uso: `python3 c2.py` (estado atual) e `python3 c2.py prop.json` (com as
sugestões). O solver de OKLCH (`/tmp/pal3/solve.py`, 26 linhas, bisseção de L mantendo C e h) gerou os hex; não o
reproduzo aqui para respeitar o limite de linhas; os hex são validados só pelo script abaixo.

```python
import json,sys
T='/home/marcio/code/pi-harness/themes/'
W=(.2126729,.7151522,.072175)
def rgb(h): return [int(h.lstrip('#')[i:i+2],16) for i in (0,2,4)]
def lin(c): c/=255; return c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4
def Y(h): return sum(w*lin(x) for w,x in zip(W,rgb(h)))
def wcag(a,b): p,q=sorted((Y(a),Y(b)),reverse=True); return (p+.05)/(q+.05)
def apca(t,b):  # APCA 0.0.98G; Lc<0: texto claro em fundo escuro
    f=lambda h:(lambda y:y if y>=.022 else y+(.022-y)**1.414)(sum(w*(x/255)**2.4 for w,x in zip(W,rgb(h))))
    yt,yb=f(t),f(b)
    if yb>yt: s=(yb**.56-yt**.57)*1.14; return 0 if s<.1 else (s-.027)*100
    s=(yb**.65-yt**.62)*1.14; return 0 if s>-.1 else (s+.027)*100
def mix(f,b,r):  # = mixRgb de ui-visual/diff.ts:128
    return '#%02x%02x%02x'%tuple(round(round((y*(1-r)+x*r)*1e6)/1e6) for x,y in zip(rgb(f),rgb(b)))
def load(n,ov={}):
    j=json.load(open(T+n+'.json')); v=j.get('vars',{})
    c={k:v.get(x,x) for k,x in j['colors'].items()}; c.update(ov)
    c['page']=v.get(j['export']['pageBg'],j['export']['pageBg']); return c
BG=('page','customMessageBg','userMessageBg','toolPendingBg','toolSuccessBg','toolErrorBg','selectedBg')
FG=('text','muted','dim','accent','error','warning','success','mdLink','mdCode',
    'toolDiffAdded','toolDiffRemoved','toolDiffContext')
def pares(c,MIX=.3):  # TINT=.14 sobre customMessageBg (diff.ts:33,234); ênfase=MIX sobre o tint (diff.ts:259)
    g={k:c[k] for k in BG}; cm=c['customMessageBg']
    ta,tr=(mix(c[k],cm,.14) for k in('toolDiffAdded','toolDiffRemoved'))
    g.update(tintAdd=ta,tintRem=tr,emphAdd=mix(c['toolDiffAdded'],ta,MIX),emphRem=mix(c['toolDiffRemoved'],tr,MIX))
    for f in [k for k in c if k in FG or k.startswith('syntax') or k=='thinkingText']:
        for b,h in g.items():
            if b[:4]=='emph' and f!='text' or c[f]=='': continue
            own='toolDiffAdded' if b=='tintAdd' else 'toolDiffRemoved'
            if b[:4]=='tint' and f!=own and f[:6]!='syntax': continue
            yield f,b,c[f],h,wcag(c[f],h),apca(c[f],h)
if __name__=='__main__':  # python3 c.py [overrides.json]
    ov=json.load(open(sys.argv[1])) if len(sys.argv)>1 else {}
    for n in('pi-noite','pi-escuro','pi-claro','tokyo-night'):
        c=load(n,ov.get(n,{})); print('==',n)
        for f,b,x,h,w,a in pares(c,ov.get('MIX',{}).get(n,.3)):
            if w<5: print(f'{f:16}{b:16}{x} {h} {w:5.2f} Lc{a:6.1f}','FALHA' if w<4.5 else 'limite')
        for k in('border','scrollbarThumb'): print(k,c[k],[f'{b}:{wcag(c[k],c[b]):.2f}' for b in BG[:3]])
```

`prop.json` (sobreposição por token, aplicada depois de resolver `vars`; `MIX` por tema):

```json
{"pi-noite":{"selectedBg":"#202b4e","toolDiffRemoved":"#f97890","error":"#f97890","syntaxFunction":"#7ea7fc",
  "syntaxOperator":"#a9b1d6","syntaxPunctuation":"#a9b1d6"},
 "pi-escuro":{"toolDiffRemoved":"#ff8479","error":"#ff8479","syntaxComment":"#a0acb8","syntaxString":"#ff8877",
  "syntaxKeyword":"#ff81b5"},
 "pi-claro":{"toolDiffAdded":"#0f712c","success":"#0f712c","toolDiffRemoved":"#bd0413","error":"#bd0413",
  "syntaxComment":"#505e6b","syntaxFunction":"#2a656c","syntaxString":"#bb080a"},
 "tokyo-night":{"selectedBg":"#202b4e","syntaxKeyword":"#ba99f7","syntaxComment":"#a9b1d6","syntaxFunction":"#80a8fe",
  "toolDiffRemoved":"#fe8499"},
 "MIX":{"pi-noite":0.18,"tokyo-night":0.18}}
```

Resultado observado [medido]: `python3 c2.py` imprime 41 linhas `FALHA` (pares token/fundo; hex iguais contam
separados); `python3 c2.py prop.json` imprime 0. Bordas, thumb e `dim` com margem ≥ 4,8 foram checados à parte
(mesma função `wcag`, valores nas tabelas 2.2-2.4); a verificação de `success` daltônico idem.
