# Marca e README do nycode

Estado: **plano, nada aplicado** (F2 e F12 do [mega plano](00-mega-plano.md)). Este guia fixa o logo do nycode, o novo
topo do `README.md`, o destino de cada menção a pi.dev, Earendil e Discord, o que migra do README do ny-pi e os pontos
de marca fora do README. Identificadores: F0 a F12, D-nn ([11](11-decisoes-e-pendencias.md)), K1 a K14
([02](02-arquitetura-alvo.md)). Fatos do logo: [anexo C](anexos/C-logo-historico.md), reconferidos em 2026-11-20.

Fontes lidas: worktree `/home/marcio/source/nycode.wt/migration` (HEAD `fb05db936`, `README.md` com 206 linhas);
ny-pi em `origin/main` (e4f8729) só por `git show`. O que não foi possível verificar vem marcado "não verificado".

## 1. O logo: fatos e verificação

O commit `9ea437bf7` é o último em que os dois arquivos existem; foram removidos em `c410d670e` (2026-11-20). Nunca
houve PNG. O commit é alcançável de dentro do worktree (`git cat-file -t 9ea437bf7` devolve `commit`).

| Arquivo em `docs/assets/` | Bytes | sha256 |
|---|---|---|
| `nycode-pixel.svg` | 7000 | `7269f242f8f7c6dca765f8a780cf72f3a0d471a40e41e2524fc7f705328a9dd2` |
| `nycode-wordmark-ansi.txt` | 53176 | `22201bcbda73ca8176350bc818ebea4fc70400f3572c507383decf19e836613f` |

Conferência executada em 2026-11-20, dentro do worktree (saída registrada):

```bash
git show 9ea437bf7:docs/assets/nycode-pixel.svg | sha256sum
# 7269f242f8f7c6dca765f8a780cf72f3a0d471a40e41e2524fc7f705328a9dd2  -
git show 9ea437bf7:docs/assets/nycode-wordmark-ansi.txt | sha256sum
# 22201bcbda73ca8176350bc818ebea4fc70400f3572c507383decf19e836613f  -
```

As duas somas coincidem com o anexo C. O SVG final tem `viewBox 0 0 168 52`, nenhum retângulo de fundo, 37 elementos
`<path>` e 37 preenchimentos cinza de `#606060` a `#f0f0f0` (contagem feita no blob). A versão antiga, com fundo
preto, é `6ac81de56` (sha256 `596a1b1a...`, no anexo C) e **não** deve ser restaurada. O `docs/assets/` não existe hoje
no worktree. Os arquivos `logo/pi_logo_*` e o `logo.svg` do chord são do pi e do chord, não do nycode.

## 2. Restaurar `docs/assets/` (F2)

Rodar na raiz do worktree, em ramo próprio da F2 (só escreve arquivos locais; o PR segue o fluxo da F2):

```bash
mkdir -p docs/assets
git show 9ea437bf7:docs/assets/nycode-pixel.svg > docs/assets/nycode-pixel.svg
git show 9ea437bf7:docs/assets/nycode-wordmark-ansi.txt > docs/assets/nycode-wordmark-ansi.txt
sha256sum -c <<'SUMS'
7269f242f8f7c6dca765f8a780cf72f3a0d471a40e41e2524fc7f705328a9dd2  docs/assets/nycode-pixel.svg
22201bcbda73ca8176350bc818ebea4fc70400f3572c507383decf19e836613f  docs/assets/nycode-wordmark-ansi.txt
SUMS
```

A saída esperada é `docs/assets/nycode-pixel.svg: OK` e `docs/assets/nycode-wordmark-ansi.txt: OK`; qualquer `FAILED`
interrompe a fase. O `.gitattributes` do fork (`* text=auto eol=lf`) não altera arquivo já em LF; depois do `git add`,
`git show :docs/assets/nycode-pixel.svg | sha256sum` confirma o blob (não executado). Reversão: `git rm -r docs/assets`.

## 3. Novo topo do `README.md` (F2)

### 3.1 Bloco proposto

Substitui as linhas 1 a 9 (`README.md:1-9`: o `<p>` com o logo do pi e o `<p>` com os selos do Discord e do npm):

```html
<p align="center">
  <img src="docs/assets/nycode-pixel.svg" alt="nycode" width="480">
</p>
<p align="center">
  <a href="https://www.npmjs.com/package/@nycode/coding-agent"><img alt="npm"
    src="https://img.shields.io/npm/v/@nycode/coding-agent?style=flat-square" /></a>
</p>
```

O primeiro `<p>` é o bloco que o `README.md` tinha em `9ea437bf7` (anexo C, seção (b)). Não há link para `pi.dev` nem
para o Discord. O selo do npm fica (linha 8); se `@nycode/coding-agent` está publicado: não verificado (a publicação é
F11, D-13). Proposta: tirar o selo em F2 e devolvê-lo em F11. Os selos de CI do ny-pi (`ci-static`, `ci-security`,
`instruction-budget`, Scorecard, licença) entram em F3, quando os workflows existirem no nycode.

### 3.2 Diff proposto, linha a linha

Fases: **F2** muda o topo, o que aponta para serviços que o nycode não opera e o que contradiz D-18; **F6**, o que
deixa de ser verdade com o harness embutido; **F11**, o que depende de instalador e publicação próprios; **F12**
consolida. Veredito: remover, substituir (por quê) ou manter (exceção D-12).

- Linha 2-4: `<a href="https://pi.dev">` com `<img src="https://pi.dev/logo-auto.svg">`. Veredito: substituir pelo
  bloco 3.1. Fase: F2.
- Linha 7: selo do Discord (`discord.com/invite/3cU7Bz4UPx`). Veredito: remover; o nycode não tem Discord (D-18).
  Fase: F2.
- Linha 11: aviso "New issues and PRs ... are auto-closed". Veredito: remover; o portão `lgtm` sai (D-18). Fase: F2.
- Linha 13: `# Nycode`. Veredito: manter (único H1). Fase: —.
- Linha 19: "skips features like sub-agents and plan mode". Veredito: substituir: o harness vem como extensões
  embutidas (04, A12). Fase: F6.
- Linha 28: `curl` de `pi.dev/install.sh` com pipe para o shell. Veredito: substituir por `npm install -g
  --ignore-scripts @nycode/coding-agent` (README:40); instalador próprio só em F11 (D-12). Fase: F2, F11.
- Linha 34: `irm` de `pi.dev/install.ps1` (PowerShell). Veredito: remover o bloco do Windows até F11. Fase: F2, F11.
- Linha 37: "The installer pins all dependencies and updates ... `nycode update`". Veredito: reescrever para o npm; o
  instalador volta em F11. Fase: F11.
- Linha 54: "See the documentation (`pi.dev/docs/latest`) ... or visit pi.dev for demos". Veredito: substituir por
  link para `packages/coding-agent/docs/`; remover "demos". Fase: F2.
- Linha 59: `nix run github:marcioazam/nycode-cli/stable`. Veredito: corrigir para `marcioazam/nycode`; se o ref
  `stable` existe: não verificado. Fase: F11.
- Linha 66: "bundled model data comes from a pi.dev model catalog ... overlays newer catalog data from pi.dev".
  Veredito: **manter**: exceção D-12 (catálogo do upstream). Fase: —.
- Linha 86: link para `earendil-works/pi-chat`. Veredito: remover: pacote do pi, compatibilidade com o nycode não
  verificada. Fase: F2.
- Linha 100: "Longer term plans ... [RFCs](https://rfc.earendil.com/keyword/nycode)". Veredito: remover o trecho;
  manter `CONTRIBUTING.md` e `AGENTS.md`. Fase: F2.
- Linha 176: "The pi.dev installer installs from `install-lock/`". Veredito: "The installer" até F11, "o instalador do
  nycode" depois. Fase: F11.
- Linha 182-196: seção "Share your OSS coding agent sessions" (`badlogicgames`, `badlogic/nycode-share-hf`, dataset).
  Veredito: remover a seção: é a prática do autor do pi. Fase: F2.
- Linha 198-200: `## License` e `MIT`. Veredito: manter; a seção "Origin" (3.3) entra antes. Fase: F2.
- Linha 202-206: `<p>` com "pi.dev domain graciously donated by exe.dev" e `exy.png`. Veredito: remover: a doação foi
  ao pi. Fase: F2.

Contagem: 17 entradas ou faixas tratadas. As menções a `pi.dev`, `earendil`, `discord` e `badlogic` (`rg -n -i
'pi\.dev|earendil|discord|badlogic' README.md`) somam 15 linhas (2, 3, 7, 28, 34, 54, 66, 86, 100, 176, 188, 190, 192,
196, 203); 14 viram remover ou substituir e 1 (linha 66) fica por D-12. A imagem `packages/coding-agent/docs/images/
exy.png` fica no repositório (se outra doc a usa: não verificado).

### 3.3 Seção "Origin" (F2)

Inserida antes de `## License`, em inglês (D-04). Texto proposto:

```markdown
## Origin

nycode is a fork of [pi](https://github.com/earendil-works/pi) by Mario Zechner and contributors (MIT). The harness
built into nycode started as [ny-pi](https://github.com/marcioazam/ny-pi), a harness for pi. nycode is not affiliated
with, nor endorsed by, the pi project. The base commit, the changes and the third-party licenses are in
[NOTICE](NOTICE); the sync policy is in [docs/fork](docs/fork).
```

O `NOTICE` do fork cita o upstream e o commit base `073b0bae8488ee20def26e873b77036dac4e9eea`; a frase "not
affiliated" é proposta deste plano, não texto existente. O pi-code entra no `NOTICE` conforme
[04](04-regras-do-repositorio.md), seção 5.15. Os links para o pi são **exceção** (seção 6).

## 4. O que migra do README do ny-pi (F12, com partes em F10)

O README do ny-pi tem 450 linhas (`origin/main`). Seções: `Contents` (20), `How to read this README` (28),
`Where ny-pi wins and where it loses` (41), `Results at a glance` (71), `Benchmarks` (89), `What you get`
(315), `Install` (333), `Link, backup, restore` (351), `Overlay` (359),
`Tests` (366), `Configuration` (372), `Quality gates` (389),
`Comparison with other harnesses` (405), `Community` (423), `Repository layout` (429), `Documentation` (441), `License`
(450).

- How to read this README (28-39): migra? sim; texto igual, "ny-pi" lido como "o harness"; vira regra em
  [04](04-regras-do-repositorio.md), A16. Fase: F2.
- Wins and losses, Results at a glance (41-88): migra? só depois de medir; tabelas só com o braço `nycode` (4.1).
  Fase: F10.
- Benchmarks (89-304): migra? resumo e link; dados brutos vão com `bench/` (F3); o README leva a tabela final. Fase:
  F10.
- Reproduce (305): migra? sim; comando de `bench/` do nycode. Fase: F3.
- What you get (315): migra? sim, reescrito; extensões embutidas e recursos. Fase: F7 a F9.
- Install, Link/backup/restore, Overlay: migra? reescrito; instalação do nycode (npm, instalador); `~/.pi/agent` por
  D-09. Fase: F11.
- Quality gates (389-403): migra? sim, adaptado; 10 checks do ruleset ([04](04-regras-do-repositorio.md), seção 3),
  não 4. Fase: F3.
- Comparison (405-421): migra? só depois de medir; tabela do braço `nycode`; sem comparação de recursos. Fase: F10.
- Community, Layout, Documentation: migra? sim, reescrito; caminhos do nycode (`packages/`, `bench/`, `resources/`).
  Fase: F12.
- License: migra? sim; MIT e seção "Origin" (3.3). Fase: F2.

### 4.1 Regra de honestidade

Todo número do README do nycode vem de uma medição do braço `nycode` (D-14, D-25). **Até F10**, nenhum número do ny-pi
entra como se fosse do nycode: se aparecer, a frase é "medido como ny-pi sobre pi 1.5.2" e a tabela de comparação
**não** entra. Depois de F10 o número antigo é substituído, não mantido ao lado do novo (regra do ny-pi, README:36-37).
Os números atuais do README do ny-pi (97,8% de 42 tarefas, 134 de 168 no Terminal-Bench, 0,57x de custo) não foram
reverificados neste plano: não verificado.

### 4.2 Sumário proposto do README final

```markdown
- How to read this README
- Where nycode wins and where it loses          (F10)
- Results at a glance · Benchmarks              (F10)
- What you get · Install · Configuration        (F7 a F11)
- Quality gates · Comparison                    (F3, F10)
- Community · Repository layout · Documentation
- Origin · License
```

As seções atuais "Getting started" (23), "Run with Nix" (56), "Packages" (72), "Development" (102), "Building
standalone binaries" (155) e "Supply-chain hardening" (168) ficam. "Permissions & Containerization" (88) é reescrita em
F4 por causa do motor de permissão (K3). "Contributing" (98) perde o link de RFCs.

## 5. Outros pontos de marca

- `config.ts:605` (K14): `APP_TITLE = nycodeConfigName ? APP_NAME : "π"`. Proposta: o ramo `"π"` só vale sem nome de
  configuração; K14 decide o título. Fase: F4.
- Logo da TUI: `rg -l 'pi-logo|PiLogo' packages apps` vazio; o componente real é `components/nycode-logo.ts` (40
  linhas: `nycodeLogoLines`, `supportsNycodeLogo`, `nycodeWordmark`), usado em `interactive-mode.ts:168`. Proposta:
  manter; `CORAL`, `BLUE`, `YELLOW` são a marca da TUI. Defeito: `nycodeWordmark()` devolve `"P"` e `"i"`, resíduo do
  pi; corrigir é escopo de F7. Fase: F7.
- `ui-visual/header.ts` (ny-pi): linha 18: "Logo oficial do pi (cópia de pi-coding-agent components/pi-logo.js)";
  linha 53 mostra `pi` e a versão; linhas 6-8 importam `@earendil-works/*`. Proposta: ao migrar, **não** copiar o
  logo: usar `nycodeLogoLines()`, trocar `pi` por `nycode` e os imports por `@nycode/*`. Fase: F7.
- `nycode-wordmark-ansi.txt` no cabeçalho: 53 176 bytes de texto ANSI truecolor. Proposta: **proposta**: exibir só em
  terminal largo e sem `NO_COLOR`, ou em `nycode --version`; custo por exibição não medido. Fase: F7.
- Favicon e ícones de app: `apps/p2/public/icons/*` e `apps/p2/src/web/NycodeLogo.tsx`. Proposta: fora de escopo
  (D-23). Fase: —.
- `nix/package.nix`: linhas 20, 28 e 168 citam `pi.dev` (homepage na 168). Proposta: `homepage` aponta para o
  repositório do nycode; 20 e 28 seguem D-12 (conteúdo exato: não verificado). Fase: F11.
- `ISSUE_TEMPLATE`: `config.yml` com Discord; `package-report.yml` com `pi.dev` (2, 8, 18, 27); `bug.yml` e
  `contribution.yml` com `nycode-cli/blob/main/CONTRIBUTING.md`. Proposta: [04](04-regras-do-repositorio.md), seção
  5.3. Fase: F2.
- Descrição e tópicos: descrição antiga de Rust, sem tópicos. Proposta: [04](04-regras-do-repositorio.md), seção 4.4
  (escrita no GitHub: exige a autorização da tarefa de F2). Fase: F2, F12.
- Imagem social: nenhum arquivo achado no worktree (`git ls-files` por `social`, `og-`, `banner`); a imagem em
  Settings do GitHub não vem pela API: não verificado. Proposta: opcional: gerar a partir do SVG, 1280x640, enviada
  pelo dono. Fase: F12.

## 6. Exceções: o que continua citando o pi

**Superada em 2026-11-20 por D-30** ([11](11-decisoes-e-pendencias.md)): o pi fica escondido ao máximo, inclusive nos
internos (P-17). Só continuam citando o pi, por exigência legal ou histórica:

- `LICENSE` (MIT, "Copyright (c) 2025 Mario Zechner"): intacto. `NOTICE`: curto, só o que a atribuição exige.
- `CHANGELOG.md` dos pacotes: histórico imutável (`AGENTS.md`, seção Changelog).
- `docs/fork` e `docs/migration`: registro do fork e da migração.
- `nycode migrate from-pi` (`src/migrations/from-pi*`): lê a configuração antiga do usuário (D-09).

Deixam de ser exceção: a seção "Origin" do README (vira "License: MIT, see LICENSE and NOTICE"), os aliases
`@mariozechner/*`, `pi.dev` como fonte do catálogo de modelos (supera D-12) e o código importado do upstream, renomeado
pelo script do fork a cada sync ([08](08-sincronizacao-upstream.md) §4.3).

## 7. Contraste do logo em tema claro e escuro

O SVG não tem fundo, então a cor visível do fundo é a da página. Os 37 preenchimentos são cinzas de `#606060` a
`#f0f0f0`. Razões de contraste WCAG calculadas neste plano (luminância relativa; **não** renderizado em navegador):

| Preenchimento | Sobre branco `#ffffff` | Sobre o escuro do GitHub `#0d1117` |
|---|---|---|
| `#606060` (extremo escuro) | 6,29 | 3,01 |
| `#f0f0f0` (extremo claro) | 1,14 | 16,61 |

**Aviso:** no tema claro as partes `#f0f0f0` quase somem (1,14, contra o piso de 3 para elementos gráficos); no tema
escuro as partes `#606060` ficam fracas (3,01, no limite). Opções, **propostas**, nenhuma aplicada:

1. Aceitar: o `README.md` de `9ea437bf7` já usava este SVG.
2. Duas imagens com `<picture>` e `prefers-color-scheme` (suporte do GitHub e renderização: não verificados): exige
   variantes clara e escura do SVG, que não existem; criá-las altera o logo e precisa de aprovação do dono.
3. Fundo sólido no SVG: **descartada**; reabre o defeito corrigido em `37ec21742` (retângulo preto).

## 8. Critérios de aceite (F2 e F12)

Só leitura, na raiz do worktree com o PR de F2 aplicado:

```bash
rg -n 'pi\.dev/logo' README.md                         # C-F2-03, esperado: vazio
rg -n 'pi\.dev/install' README.md                      # C-F2-05, esperado: vazio
rg -n 'docs/assets/nycode-pixel.svg' README.md         # C-F2-04, esperado: 1 linha, a de número 2
rg -n -i 'pi\.dev|earendil|discord|badlogic' README.md # C-F2-06, esperado: só o catálogo (D-12) e a seção Origin
sha256sum docs/assets/nycode-pixel.svg docs/assets/nycode-wordmark-ansi.txt   # somas da seção 1
rg -c '^# ' README.md                                  # esperado: 1
rg -n 'Share your OSS|auto-closed' README.md           # esperado: vazio
```

A renderização nos temas claro e escuro **não** é verificável por linha de comando: exige abrir o `README.md` no GitHub
nos dois temas (conferência do dono; não verificado). Em F12, `rg -n 'ny-pi' README.md` só acha a seção "Origin" e,
enquanto F10 não fechou, a frase "medido como ny-pi"; depois de F10, `rg -n 'medido como ny-pi' README.md` é vazio.

## 9. Não verificado

- Renderização do SVG em tema claro e escuro; suporte do `<picture>`; o contraste foi só calculado.
- Se `@nycode/coding-agent` está publicado no npm; se o ref `stable` e a URL `marcioazam/nycode-cli` ainda resolvem.
- Se `exy.png` é usado fora do rodapé do README; conteúdo de `nix/package.nix:20,28`.
- Lista dos aliases `@mariozechner/*`; existência de imagem social configurada no GitHub.
- Números do README do ny-pi (4.1): não reverificados.
- Nenhum comando de escrita foi executado; só `git show`, `sha256sum`, `rg` e `sed` de leitura.
