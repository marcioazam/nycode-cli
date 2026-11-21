# Faixa ui-paletas (relatório bruto do subagente, 2026-11-19)

**Status: complete.** Mediu os contrastes e li o código; não vi a TUI rodando.

**Evidência e lacunas**
- **Cálculo:** scripts em `/tmp/pal/*.py` (WCAG 2.2 sem arredondar, APCA 0.0.98G, OKLab/OKLCH, Machado 2009 com severidade 1,0 para CVD). Os valores abaixo são medidos.
- **Pares avaliados:** texto, `dim`, `muted`, accent, erro, aviso, sucesso, diff e código sobre `page`, `customMessageBg`, `userMessageBg`, `toolPendingBg`, `toolSuccessBg`, `toolErrorBg` e `selectedBg`. Também os tints de diff (`mixRgb(cor, customMessageBg, 0,14)` e a ênfase `MIX 0,3`) e as bordas.
- **Pares descartados:** `searchMatchBg` só serve ao `searchMatchText`, e esse par passa. Por isso não contei os demais tokens sobre ele.
- **Pares fora do cálculo:** o contexto do diff fica em fundo neutro e não entra nas falhas dos tints. O link (`mdLink`/`mdLinkUrl`) e o código inline (`mdCode`) passam em todos os fundos reais, então não aparecem nas tabelas.
- **Tema ativo:** o ativo é `pi-claro/pi-noite` (onda 9); `tokyo-night` é histórico, mas selecionável. O fundo da página vem de `export.pageBg`. O kitty do dono usa `#1a1b26`, e a diferença para o `pi-escuro` (`#1c1c1e`) é desprezível.
- **`mono`:** não tem cores (`""`), então herda as do terminal. Não é calculável.
- **256 cores:** é inferência. Usei a quantização padrão do cubo xterm; não li o quantizador do core do pi, que não achei em disco.
- **Mock:** `bin/ny-pi-mock` não rodou. Exige sandbox bwrap, Pi e tmux, e não há garantia de segundos.
- **Não verificado:** não usei navegador nem leitor de tela, e não vi a TUI. Os painéis de plano e agentes são patches do pi-code, com 12 patches "ambíguos" no inventário, então não os avalio.
- **Codegraph:** sem índice; usei `rg`.

## 1. Paletas

Só falhas e limites. Falha é `< 4,5:1`; limite é `< 5:1`. `PASSA?` usa 4,5:1 para texto e 3:1 para borda e UI. APCA aparece como Lc (negativo = texto claro sobre fundo escuro).

### pi-noite (escuro, ativo)

| par | hex/hex | WCAG | APCA Lc | passa? |
|---|---|---|---|---|
| `dim` / `selectedBg` | #8a93bd / #283457 | 4,07 | −38 | **não** |
| `text` / ênfase `+` (MIX 0,3) | #c0caf5 / #566949 | 3,68 | −52 | **não** |
| sintaxe / ênfase `+` | #7aa2f7 / #566949 | 2,36 (função); 3,25 (string) | −30 / −46 | **não** |
| `toolDiffRemoved` / tint `−` | #f7768e / #433241 | 4,48 | −44 | **não** |
| `syntaxFunction` / tint `+` | #7aa2f7 / #373e3c | 4,34 | −44 | **não** |
| `syntaxOperator`/`Punctuation` (dim) / tint `+` | #8a93bd / #373e3c | 3,63 | −36 | **não** |
| `dim` / `toolErrorBg`, `toolSuccessBg`, `toolPendingBg` | #8a93bd / #3b2934, #29302a, #242d3c | 4,50 / 4,51 / 4,61 | −40 | limite |
| `text` / ênfase `−` | #c0caf5 / #794658 | 4,58 | −58 | limite |
| `error` / `selectedBg` | #f7768e / #283457 | 4,62 | −44 | limite |
| `border`, `borderMuted`, `mdHr`, `mdQuoteBorder` / `page`, `customMessageBg` | #3b4261 / #1a1b26, #262734 | 1,74 / 1,50 | n/a | **não (3:1)** |

- **Textos principais:** `text` 10,6:1 sobre a página e 9,15 sobre `customMessageBg` (Lc −72). `muted` 8,1 e 6,99 (Lc −57 a −59).
- **`dim`:** 5,69 e 4,91 (Lc −42 a −44).
- **Aviso (▲):** sobre o fundo derivado `#2c2725` o amarelo faz 7,37:1.

### pi-escuro

| par | hex/hex | WCAG | APCA Lc | passa? |
|---|---|---|---|---|
| `toolDiffRemoved` / tint `−` | #ff6961 / #4a3535 | 4,05 | −41 | **não** |
| `syntaxComment` / tint `+`; `syntaxKeyword` / tint `+`; `syntaxString` / tint `+` | #98a4b0, #ff7ab2, #ff8170 / #2d4334 | 4,21; 4,42; 4,39 | −43 a −46 | **não** |
| `syntaxComment` / tint `−` | #98a4b0 / #4a3535 | 4,50 | −44 | limite |
| `dim` / `toolPendingBg`, `userMessageBg` | #98989d / #12363f, #243246 | 4,50 / 4,52 | −41 | limite |
| `accent` / `toolPendingBg`, `userMessageBg` | #409cff | 4,56 / 4,58 | −42 | limite |
| `error` / `userMessageBg` | #ff6961 | 4,60 | −43 | limite |
| `scrollbarThumb` / `userMessageBg` | #757579 / #243246 | 2,83 | n/a | **não (3:1)** |
| `border` / `page`, `customMessageBg` | #48484a / #1c1c1e, #2c2c2e | 1,86 / 1,53 | n/a | **não** |

### pi-claro

| par | hex/hex | WCAG | APCA Lc | passa? |
|---|---|---|---|---|
| `toolDiffRemoved` / tint `−` | #d70015 / #eed0d7 | 3,76 | 51 | **não** |
| `toolDiffAdded` / tint `+` | #1d7a34 / #d4e1dc | 4,02 | 57 | **não** |
| `syntaxComment` / tint `−` | #5d6c79 / #eed0d7 | 3,77 | 54 | **não** |
| `syntaxComment` / tint `+` | #5d6c79 / #d4e1dc | 4,02 | 58 | **não** |
| `syntaxFunction` / tint `−`, `+` | #326d74 | 4,10 / 4,37 | 56 / 60 | **não** |
| `syntaxString` / tint `−`, `+` | #c41a16 | 4,18 / 4,46 | 55 / 59 | **não** |
| `dim` / `userMessageBg` | #6a6a6f / #e0edf9 | 4,52 | 65 | limite |
| accent, error, success, `mdLink` / `userMessageBg` | #0066cc, #d70015, #1d7a34 | 4,68 / 4,53 / 4,54 | 62–65 | limite |
| `border` / `page`, `customMessageBg` | #c7c7cc / #fff, #f2f2f7 | 1,68 / 1,51 | n/a | **não** |
| `scrollbarThumb` / `customMessageBg`, `userMessageBg` | #8e8e93 | 2,92 / 2,74 | n/a | **não** |

- **Textos principais:** `text` 16,8:1 e `muted` 10,0:1 sobre a página. `dim` 5,38 (Lc 77).
- **Margem:** quase todos os pares de cor semântica ficam entre 4,5 e 5,0 sobre as caixas.

### tokyo-night (histórico)

| par | hex/hex | WCAG | APCA Lc | passa? |
|---|---|---|---|---|
| `dim` / `selectedBg` | #8a93bd / #283457 | 4,07 | −38 | **não** |
| `text` / ênfase `+` | #c0caf5 / #556a4e | 3,66 | −52 | **não** |
| `toolDiffRemoved` / tint `−` | #f7768e / #423347 | 4,43 | −44 | **não** |
| `syntaxKeyword` / `customMessageBg`, `userMessageBg`, `toolPendingBg`, `toolSuccessBg` | #9d7cd8 | 4,38 / 4,38 / 4,30 / 4,42 | −37 | **não** |
| `syntaxKeyword` / `selectedBg`; / tint `+`; / tint `−` | #9d7cd8 | 3,67; 3,24; 3,52 | −35 a −32 | **não** |
| `syntaxComment` (`dark5`) / tint `+`, `−` | #8a93bd | 3,59 / 3,90 | −36 / −38 | **não** |
| `syntaxFunction` / tint `+` | #7aa2f7 | 4,29 | −44 | **não** |
| `border` / `customMessageBg` | #5f688e / #24283b | 2,68 | n/a | **não (3:1)** |
| `mdQuoteBorder` / página | #414868 | 1,91 | n/a | **não** |

### Resumo por tema

| tema | textos principais | falhas reais | pontos a tratar |
|---|---|---|---|
| pi-noite | ≥ 5,69 | 6 pares (diff, seleção) | ênfase `+` com 3,68 e `dim` sem margem |
| pi-escuro | ≥ 4,5, vários no limite | 5 pares (diff) | `−` sobre tint com 4,05 |
| pi-claro | ≥ 4,5, vários no limite | 8 pares (diff) | os dois tints do diff |
| tokyo-night | ≥ 4,3 | 10 pares | keyword roxa nas caixas |

- **Diff em tema claro:** o gate atual não cobre sintaxe dentro dos tints.
- **Bordas:** nos 4 temas ficam em 1,5–1,9:1, exceto o tokyo sobre as caixas (2,68). Só importa como WCAG 1.4.11 onde a borda define o controle (a borda do editor sem foco; a focada usa ciano).
- **Lacuna do gate:** `theme-contrast.test.ts` não cobre `dim` sobre `selectedBg`. Também não cobre texto sobre a ênfase do diff, sintaxe sobre os tints, `syntaxKeyword` sobre as caixas de tool e borda a 3:1. Por isso tudo isso passou na onda 9.

### Daltonismo (ΔE em OKLab ×100)

| tema | sucesso/erro normal | deuteranopia | protanopia | razão de luminância | tints do diff (normal → deut) |
|---|---|---|---|---|---|
| pi-noite | 26,8 | **9,0** | 19,9 | 1,45 | 4,7 → **2,1** |
| pi-escuro | 34,6 | **3,7** | 19,7 | 1,40 | 6,5 → **0,7** |
| pi-claro | 31,9 | **8,1** | 11,2 | **1,00** | 5,2 → **1,2** |
| tokyo-night | 26,8 | 9,0 | 19,9 | 1,45 | 4,7 → 2,2 |

- **pi-escuro:** verde e vermelho praticamente colapsam na deuteranopia.
- **pi-claro:** os dois têm a mesma luminância, então só o matiz diferencia.
- **Mitigação no código:** o diff usa `+`/`−` (`diff.ts:297`) e o estado usa palavra e glifo `✓`/`✕`. O sucesso/erro em barras do HUD só se separa por cor e limiar de texto. Não é falha de 1.4.1, mas é frágil.
- **Dependência só de cor:**
  - O fundo das caixas (`toolSuccessBg`/`toolErrorBg`) é redundante com a palavra no título.
  - Na onda 12 (D10) o sucesso passa a não ter palavra, só ausência. O `✕ erro` continua explícito.

### Consistência semântica entre os temas

| papel | pi-noite | pi-escuro / pi-claro | tokyo-night |
|---|---|---|---|
| `accent` | azul `#7aa2f7` | azul | **magenta** `#bb9af7` |
| `mdCode` | magenta | roxo | **verde = success** |
| `syntaxString` | verde | **vermelho** (≈ erro, ΔE 4,6 e 3,7) | verde |
| `thinkingMax`/`Xhigh` | accent | warn (amarelo) | amarelo |
| `thinkingMedium` | text | accent | magenta |
| `bashMode` | magenta | roxo | verde-água |
| `syntaxKeyword` | `text` (sem cor) | rosa / magenta | roxo |
| `syntaxType` (= "executando") | ciano `#7dcfff` | ciano / **azul-marinho `#0b4f79`** | `#2ac3de` |

- **Strings vermelhas:** no escuro e no claro elas lêem como erro dentro de código e de diff.
- **`syntaxType` no claro:** "executando" fica azul-marinho, quase da cor do texto.
- **Tokyo-night:** `pi-noite` e `tokyo-night` repetem os mesmos hex-base, mas trocam o papel de accent. Isso é fonte de confusão.

### Tokens

- **Definidos e não usados pelas extensões:** `md*`, `syntax*` (menos `syntaxType`), `thinking*` (menos `thinkingText`), `bashMode`, `scrollbar*`, `searchMatch*`, `customMessageText/Label` e `userMessageText`. Todos são consumidos só pelo core do pi (não verifiquei o core).
- **Usados e não definidos:** nenhum. Todo nome passado a `theme.fg/bg/getFgAnsi` existe em `colors`.
- **Tokens que o código deriva fora do tema:** o fundo do aviso (`warnBgRgb`, `icons.ts`) e os tints do diff. Nenhum dos dois tem token, e só o aviso tem contrato testado.

### 256 cores e NO_COLOR

- **256 cores (inferido):** os fundos de estado colapsam no mesmo índice.
  - **pi-claro:** os 6 fundos (`customMessageBg`, `userMessageBg`, `toolPendingBg`, `toolSuccessBg`, `toolErrorBg`, `selectedBg`) viram `#eeeeee`. Perde-se a seleção e a distinção entre os estados. O `success` `#1d7a34` vira `#00875f` e cai para 3,91:1.
  - **pi-noite:** `userMessageBg`, `toolPendingBg`, `toolSuccessBg` e `toolErrorBg` viram `#303030`. `dim` sobre `toolErrorBg` vai de 4,50 para 3,84.
  - **pi-escuro:** `page`, `toolSuccessBg` e `toolErrorBg` viram `#1c1c1c`; `customMessageBg`, `userMessageBg`, `toolPendingBg` e `selectedBg` viram `#303030`.
  - **Efeitos de movimento:** degradam para texto plano quando `getFgAnsi` não devolve `38;2` (`motion.ts:6`).
  - **HUD:** `calm-statusline.mjs` pinta sempre `38;2` (linhas 33-36), sem consultar o modo de cor. Se o terminal só tem 256 cores, a conversão fica a cargo do terminal.
- **NO_COLOR:** `a11y.ts` troca para o tema `mono`, usa cabeçalho plano e `marcas.ts`/`motion.ts` só tiram cor.
  - **Falta:** não achei `NO_COLOR` em `calm-statusline.mjs`. O `claude-hud-statusline.mjs` o trata (linha 21), mas não confirmei qual dos dois a sessão usa.
  - **Estado sem cor:** o diff usa `+`/`-` e há palavra no estado. O editor em `NORMAL` tem rótulo (`editor.ts:506`).

## 2. Hex ajustados (OKLCH, mesma matiz e croma, só L; contraste novo)

| tema | token | atual → proposto | mudança de L | contraste novo |
|---|---|---|---|---|
| noite | `dim` | #8a93bd → **#929cc6** | 0,671 → 0,699 | 4,53 sobre `selectedBg` |
| noite, tokyo | alternativa a `dim`: `selectedBg` | #283457 → **#212d4f** | 0,332 → 0,305 | `dim`/`accent`/`error` ≥ 4,5 |
| noite, tokyo | ênfase do diff `MIX` (`diff.ts:31`) | 0,30 → **0,18** | n/a | texto 4,69 (`+`) e 5,55 (`−`) |
| noite | `toolDiffRemoved` | #f7768e → **#f8778f** | 0,723 → 0,725 | 4,52 sobre o tint `−` |
| noite | `syntaxFunction` | #7aa2f7 → **#7ea6fb** | 0,719 → 0,731 | ≥ 4,5 em todos os fundos e tints |
| noite | `syntaxOperator`/`Punctuation` | #8a93bd → **#9ba5cf** | 0,671 → 0,728 | ≥ 4,5 nos tints |
| escuro | `toolDiffRemoved` | #ff6961 → **#ff8076** | 0,707 → 0,776 | 4,51 sobre o tint `−` |
| escuro | `syntaxComment` | #98a4b0 → **#9eaab6** | 0,713 → 0,731 | ≥ 4,5 |
| escuro | `syntaxString` | #ff8170 → **#ff8573** | 0,743 → 0,754 | ≥ 4,5 |
| escuro | `syntaxKeyword` | #ff7ab2 → **#ff7db5** | 0,749 → 0,757 | ≥ 4,5 |
| claro | `toolDiffAdded` | #1d7a34 → **#0f712c** | 0,510 → 0,481 | 4,51 sobre o tint `+` |
| claro | `toolDiffRemoved` | #d70015 → **#bf0000** | 0,553 → 0,488 | 4,51 sobre o tint `−` |
| claro | `syntaxComment` | #5d6c79 → **#515f6c** | 0,524 → 0,480 | ≥ 4,5 |
| claro | `syntaxFunction` | #326d74 → **#2b666d** | 0,498 → 0,475 | ≥ 4,5 |
| claro | `syntaxString` | #c41a16 → **#bd0c0d** | 0,525 → 0,505 | ≥ 4,5 |
| tokyo | `syntaxKeyword` | #9d7cd8 → **#b897f5** | 0,655 → 0,741 | ≥ 4,5 |
| tokyo | `syntaxComment` | #8a93bd → **#9ca6d0** | 0,671 → 0,731 | ≥ 4,5 |
| tokyo | `syntaxFunction` | #7aa2f7 → **#7ea7fc** | 0,719 → 0,734 | ≥ 4,5 |
| tokyo | `dim`/`selectedBg` | `dim` #929cc6 | 0,671 → 0,699 | 4,53 |

- **Bordas (se quiser 3:1 sobre todos os fundos):**
  - noite `border` → #6d7698 (3,02)
  - escuro `border` → #7a7a7c (3,02)
  - claro `border` → #87878c (3,00)
  - tokyo `border` → #687198 (3,00)
  - Mantenha os separadores decorativos (`mdHr`, `borderMuted`) como estão e aplique isto só ao token que contorna o editor.
  - `scrollbarThumb` sobre `userMessageBg` no escuro: #7a7a7e (3,02). No claro: #87878c (3,00).
- **Margem para `dim`:** para ter ≥ 4,8:1 em todas as caixas (nenhum par no limite exato):
  - noite → #8f99c3 (4,84)
  - escuro → #9e9ea3 (4,84)
  - claro → #65656a (4,87)
- **APCA (Lc ≥ 60 para texto de conteúdo):**
  - **Medido:** o `dim` do noite dá Lc −42 e o do escuro −43 a −45, abaixo de 60.
  - **Efeito:** levar o `dim` a Lc 60 o torna mais claro que `muted` (#acb6e2 contra #a9b1d6), e a hierarquia text > muted > dim desaparece.
  - **Proposta:** use `dim` só para metadado (hora, atalho). Mude `thinkingText`, `toolDiffContext`, `mdLinkUrl` e os comentários de código para `muted`.
- **Daltonismo (`pi-escuro`, `pi-claro`):** só um deslocamento de matiz resolve.
  - **pi-escuro:** `success` #30d158 → **#00d5d4**, +46° de matiz, ΔE 15,1 (deut) e 23,2 (prot), 7,6:1.
  - **pi-claro:** `success` → **#007c7c**, ΔE 15,5 e 16,4, 4,51:1.
  - **pi-noite e tokyo:** nenhum deslocamento de `success` resolve. A alternativa é o erro em **#e979bd**, −26°, ΔE 15,0.
  - Como `+`/`−` e as palavras já mitigam, trate como opcional.

## 3. UI: achados (25)

Evidência de todos os achados abaixo é de código, salvo onde marquei "medido".

| SEV | área | arquivo:linha ou doc | problema observável | ajuste sugerido |
|---|---|---|---|---|
| A | movimento/custo | `docs/designs/onda12-macos/PLANO.md` (Travamento) | Pi parado gastou 36–82% de CPU e 100% trabalhando. Causa: `write` sem resultado desenhada como "executando" e relógio contínuo (16/33 ms). O dono pediu "deixar como estava" e o achado ficou aberto. | Parar o relógio quando a ferramenta não tem resultado. Para custo, usar o medidor `perf.mjs`, a cargo do pai. |
| A | diff | `ui-visual/diff.ts:31,265-269` | Texto sobre a ênfase `+` com 3,68:1 em noite e 3,66 em tokyo. Isso é conteúdo, não decoração. WCAG 1.4.3. | `MIX` 0,30 → 0,18. |
| M | diff | `diff.ts:296-297`; `ui/diff.ts` | O número e o sinal `−` falham no tint: noite 4,48, escuro 4,05, tokyo 4,43, claro 3,76 (`+` 4,02). O sinal é o único marcador não-cor do diff. | Hex da §2 (ou `TINT` menor: noite 0,13, escuro 0,06, claro 0,03). Prefira o hex. |
| M | diff/sintaxe | `diff.ts:260-269` | Sintaxe dentro de linhas `+`/`−`: claro (comentário 3,77, função 4,10, string 4,18), escuro (4,21–4,50), tokyo (3,24–4,29) e noite (operador 3,63). | Hex da §2 e incluir sintaxe sobre tints no gate. |
| M | tema | `tokyo-night.json` | `syntaxKeyword` #9d7cd8 faz 4,30–4,42 em todas as caixas de tool. | #b897f5. |
| M | seleção | `ui/history.ts:302`; `ui/diff.ts:145,187` | `dim` sobre `selectedBg` 4,07:1 em noite/tokyo (linhas selecionadas de histórico e diff). | `dim` #929cc6 ou `selectedBg` #212d4f. |
| M | transcript | `themes/*.json` (`userMessageBg`, `tool*Bg`) | Medido: fundos de estado quase iguais ao neutro. Noite: usuário vs `customMessageBg` ΔE 2,1 e pendente 2,1; sucesso = neutro por decisão (D3). Claro: pendente 1,1, sucesso 1,9, erro 1,6. A distinção depende do título e do glifo. | Tratar o fundo como reforço, não como sinal; subir o croma de `toolErrorBg` no claro; checar em 256 cores. |
| M | 256 cores | cálculo (inferido) | Todos os fundos de estado do claro viram `#eeeeee`; no noite quatro viram `#303030`. A seleção some no claro. | Detectar `getColorMode()` e usar o tema `mono`, ou definir fundos com ≥ 1 passo do cubo de diferença. Ler o quantizador do pi. |
| M | texto | `themes/*.json` (`thinkingText`, `toolDiffContext`, `mdLinkUrl`: `dim`) | Conteúdo de raciocínio e contexto de diff em `dim`: WCAG 4,5–4,9, APCA Lc −41 a −45, no limite. | Usar `muted` nesses 3 tokens; `hideThinkingBlock: true` já reduz a exposição. |
| M | daltonismo | `themes/pi-escuro.json`, `pi-claro.json` | Verde e vermelho: ΔE 3,7 (escuro, deut) e luminância igual (claro). O HUD distingue ok/crit só pela cor e pelo limiar escrito. | Hex da §2, ou manter o glifo/palavra junto a cada estado. |
| M | microcopy | `motion/shell.ts:123,149`; `icons.ts:140`; `editor.ts:143`; `folha/confirm.ts:14` | Mistura pt/en no mesmo cartão: `Run ─ comando`, `OK`/`Erro`, `executando`/`atenção`, `INSERT`/`NORMAL`, e a tabela que traduz títulos em inglês do pi-code (`Allow this command?`). No inventário também aparecem E04, E06, E15 e D19 em inglês. | Um idioma por classe de mensagem, como o próprio inventário propõe; trocar `Run` por `Executar`. Atenção ao `Read`/`Edit` nativos do pi. |
| M | estados | `icons.ts:130-140`; `motion/shell.ts:52` | `Estado` só tem `run/warn/ok/err`. Cancelado existe só no bash (`interrompido`). Aguardando permissão aparece só como confirmação em `folha/confirm.ts`, sem estado persistente na caixa. | Estados `cancelado` e `aguardando` em `Estado`, com palavra própria. |
| M | semântica | `themes/*.json` | Mesma função, cor diferente por tema: accent azul/magenta; `mdCode` roxo/verde (= success no tokyo); string vermelha (≈ erro) no escuro/claro. Papéis da tabela §1. | Fixar o papel antes da cor: erro/sucesso só para estado, string não vermelha, accent azul em todos. |
| M | editor | `ui/editor.ts:489-517` | Borda sem foco em 1,5–1,9:1. WCAG 1.4.11 se for a única marca do campo. | #6d7698 (noite) e equivalentes, só no token de borda do editor. |
| M | HUD | `claude-home/bin/hud/calm-statusline.mjs:33-39,221` | Pinta `38;2` sempre, sem `NO_COLOR`. Mede largura com `[...s].length`, então glifo largo ou Nerd Font descontam errado. O último fallback (`tries.at(-1)`) pode passar de `columns` em terminal estreito. | Respeitar `NO_COLOR` (como o `claude-hud-statusline.mjs:21`), medir com `visibleWidth` e truncar. Confirmar qual script a sessão usa. |
| M | cabeçalho | `ui-visual/header.ts:42-46` | Logo de 7 linhas (70 colunas) mais linha em branco: 9 linhas no topo. Abaixo de 71 colunas só a linha de texto. Em 80 colunas ocupa quase 40% de um terminal de 24 linhas. Os atalhos caem na ordem `?`, `/`, `!`. | Compactar a marca em terminais baixos (< 30 linhas). |
| B | largura | `ui-visual/icons.ts:187` | `marcaUsuario` usa `[...t].length` (o comentário já diz que CJK/emoji desalinham a hora). | `visibleWidth`. |
| B | largura | `motion/chrome.ts:55-62` | Atalho e hora só aparecem com ≥ 10 colunas livres. Em 60 colunas o atalho cai, depois a hora; abaixo de 30 só o título. A hora some antes do dono perceber (hipótese: truncar o título pode cortar o nome do arquivo). | Verificar `fit(row, …)` com `splitFile` em 60 colunas. Não medi. |
| B | ícones | `icons.ts:96-106`; `icons.ts:16-18,45-46` | Nerd Font só por kitty ou `PI_NERD_FONT=1`; terminal desconhecido cai em Unicode, mas `PI_NERD_FONT=1` sem a fonte mostra "tofu" sem fallback. Em Unicode `edit`/`write`/`memory` e o estado `pending` usam o mesmo `●`; `read`/`grep`/`find`/`ls`/`lsp` usam `○`. | Distinguir `pending` das famílias por forma; já é a escolha D1 da onda 12, então registrar o custo. |
| B | movimento | `ui/a11y.ts:25-31`; `working.ts:132` | `movimento()` único (normal/reduzido/desligado) respeita `PI_REDUCED_MOTION`, `TERM=dumb` e `NO_PROGRESS`. Não segue `prefers-reduced-motion` do SO (terminal não expõe). `desligado` troca por "trabalhando… · esc interrompe". | Documentar a vari
