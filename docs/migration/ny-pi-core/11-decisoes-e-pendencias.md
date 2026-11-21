# Decisões e pendências

Cada decisão tem um identificador estável (D-nn) citado nos outros documentos. Estado:

- **adotada**: escolhida neste plano pela opção recomendada; o dono pode reverter antes de F0 fechar.
- **aguarda o dono**: precisa de uma autorização que o plano não pode presumir (ação destrutiva remota, conta
  externa, gasto). O plano segue com a recomendação marcada, mas a fase indicada não começa sem a resposta.

## Resumo

| ID | Decisão | Escolha | Estado | Trava a fase |
|---|---|---|---|---|
| D-01 | Onde o harness entra no fork | Extensão embutida (`builtin:<nome>`) por padrão; core só em 14 costuras listadas | adotada | — |
| D-02 | Qual pi-code importar | 1.7.0 com os 19 patches aplicados (o que foi medido), não a 1.10.1 | adotada | — |
| D-03 | Histórico do ny-pi | Importar com `git filter-repo --to-subdirectory-filter` + fusão de histórias não relacionadas | adotada | — |
| D-04 | Idioma | `docs/` em português; `README.md`, `CONTRIBUTING.md`, `SECURITY.md` e textos para o modelo em inglês, como hoje | adotada | — |
| D-05 | Checks obrigatórios | União dos dois conjuntos (lista em 07) | adotada | — |
| D-06 | Limite de 800 linhas e 7 arquivos | Só para arquivos criados pelo nycode; upstream em lista de base | adotada | — |
| D-07 | Sincronização com o upstream contra "histórico linear, só squash" | Fusão (merge commit) permitida só em PR de `sync/upstream-*`, com auditoria; o resto continua squash | adotada, **única regra do ny-pi afrouxada** | F3 |
| D-08 | Hooks de permissão | Fase A: `guard.py` embarcado; fase B: motor nativo atrás de chave, ligado só com paridade total | adotada | — |
| D-09 | Compatibilidade com `PI_*` e `~/.pi` | Nenhuma em tempo de execução; conversão única por `nycode migrate from-pi` | adotada | — |
| D-10 | Peças que não migram | `cache-prefix-probe`, `version-floor`, `mcp` do pi-code, `no-web-search`, `no-context-files-covers-claude-md`, `compaction-400k.py` | adotada | — |
| D-11 | Terceiros com patch local | `pi-lsp` embutido; `ponytail` e `ralph-loop` em fork próprio com o patch como commit e proposta ao autor | adotada | — |
| D-12 | Serviços do upstream ainda usados (`pi.dev`) | Catálogo de modelos: manter o do upstream. Instalador e aviso de versão: próprios (npm e GitHub Releases). **Superada por D-30 no catálogo**: nenhum serviço `pi.dev` fica | parcialmente superada (D-30) | F11 |
| D-13 | Versão | Primeira versão com o harness: `2.0.0`, pacotes em sincronia | adotada | F11 |
| D-14 | Referências do benchmark | ~~`pi-vanilla` e `cc-vanilla` são medidos de novo uma vez em F10~~ (superada em 2026-11-20). Revista pelo dono em 2026-11-20 ("benchmarks do claude code e pi vanilla já feitos"): valem as referências congeladas de `docs/bench/BASELINE-VANILLA-2026-11.md` (Claude Code 2.1.323, pi 1.5.2); sem nova medição dos vanilla em F10 | adotada | F10 |
| D-15 | Apagar 213 ramos herdados do nycode em Rust | Apagar depois de conferir que nenhum tem PR aberto | **aguarda o dono** | F0 |
| D-16 | 8 alertas de secret scanning no destino | Fechar como credencial pública de cliente OAuth do upstream; remover `plan.md` do alcance | **aguarda o dono** | F0 |
| D-17 | Escopo npm | ~~Criar a organização `@nycode`~~ (substituída). Dono, 2026-11-20: "Sem org vai ser repo opensource": sem organização nem publicação no npm; o canal é o repositório público `marcioazam/nycode` (fonte, etiquetas e GitHub Releases). Os itens npm de F11 (C-F11-01 a C-F11-05, C-F11-07) são reescritos para esse canal num PR de docs no início de F11 | decidida pelo dono | F11 |
| D-18 | Política de contribuição | A do ny-pi (aberta, com modelos); o portão `lgtm` do upstream sai junto com seus workflows já removidos | adotada | — |
| D-19 | Quem edita `CHANGELOG.md` | Mantenedores e agentes, em `## [Unreleased]`; contribuidores externos não | adotada | — |
| D-20 | CodeQL | Workflow próprio (`javascript-typescript`, `python`, `actions`); desligar o "default setup" preso em `rust` | adotada | F3 |
| D-21 | `bench-pr` em mudança não funcional | O verificador publica `success` com a descrição "não funcional, sem rodada" para PR que só toca UI, docs ou CI | adotada | F3 |
| D-22 | Destino do repositório `ny-pi` | Arquivar (somente leitura) com aviso no README; não apagar | **aguarda o dono** | F12 |
| D-23 | `apps/p2`, `apps/p3`, `apps/p2-mac` | Ficam como vieram; fora dos gates novos, como já estão fora do Biome da raiz | adotada | — |
| D-24 | Cobertura | 80% por arquivo nos arquivos próprios, medida como cobertura do diff (regra atual do `run-static.sh`) | adotada | — |
| D-25 | Momento de trocar a base 1.5.2 por 1.6.0 | Antes de migrar código: medir o ny-pi por fora sobre o pi 1.6.0 (F3) para separar o efeito da base do efeito da migração | adotada | F3 |
| D-26 | Braço `omp` do benchmark | Não migra (`bench/arms/omp` e os 3 arquivos `omp` de `evals/harbor`); decisão do dono de 2026-11-15 de comparar só ny-pi, Claude Code e pi puro | adotada | — |
| D-27 | O plano cita `--tier smoke`, que não existe em `bench/suites.toml` | Criar em F3 o tier `smoke` como apelido do `pr` ([09, seção 5.2](09-paridade-e-benchmark.md)) | adotada | F3 |
| D-28 | `gate.py` devolve `NOT_COMPARABLE` entre braços diferentes (`arm_version` e `overlay_sha` em `stats.META_KEYS`) | Modo de paridade entre braços, proposto em [09](09-paridade-e-benchmark.md#criterio-de-paridade); margem de custo 1,10 e uma rodada A/A em F3 | adotada | F3 |
| D-29 | Benchmark durante a migração | Dono, 2026-11-20: "Não é para rodar nenhum benchmark agora", e "adiar itens de bench e seguir". Nenhuma rodada real (nem piloto, baseline ou poster) até o dono liberar; `--dry-run` e testes valem. O ruleset entra em F3 com 9 contextos (sem `bench-pr`); C-F3-09 e C-F3-10 ficam pendentes (P-16) e F3 fecha com esse desvio. Orçamento já autorizado para quando liberar: rodadas `pr` por PR funcional e um único `full` em F10 (substitui `baseline` e `full` do ny-pi@1.6.0 em F3, 09 §6). Prioridade do dono: manter o benchmark por PR funcionando | adotada | F3 |
| D-30 | Esconder o pi | Dono, 2026-11-20: "Para iniciar o binario sera nycode e toda referencia de pi vira nycode, tudo que era pi ou pi-agent e etc vira nycode, respeitando diretrizes juridicas, mas esconder o pi ao maximo". Escolhas do dono na mesma data: (1) **cortar todo tráfego para `pi.dev`**: telemetria de instalação desligada; aviso de versão e changelog pelo GitHub Releases de `marcioazam/nycode`; atribuição (OpenRouter e afins) aponta para o repositório do nycode; `/share`, catálogo remoto, gateway radius e metadados OAuth do MCP desligados por padrão (só com URL configurada); catálogo de modelos sem `pi.dev` (supera D-12 nesse ponto); (2) **renomear tudo, inclusive internos** (identificadores, comentários, testes, links), pelo script de renome do fork (`scripts/fork/`), reaplicado a cada sync (08 §4.3); (3) **crédito no mínimo legal**: `LICENSE` intacto (MIT, "Copyright (c) 2025 Mario Zechner"), `NOTICE` curto, README sem seção sobre o pi; `CHANGELOG.md` históricos ficam; (4) **sem aliases `@mariozechner/*`** para extensões do pi (coerente com D-09); `migrate from-pi` avisa quem os usa. Supera 05 §6 e, no catálogo de modelos, D-12. Execução: P-17 | adotada | F4, F12 |
| D-31 | README com "Pi Vanilla", docs do ny-pi copiados e descrição do repositório | Dono, 2026-11-21: "o readme e infos de benchmarks e proposta de um agent coding barato como pi vanilla e melhor que claude code em acerto no readme 100% sincero"; para o nome do braço barato, "Pi Vanilla". (a) o `README.md` cita "Pi Vanilla" (e "pi 1.5.2") **só** nas seções de proposta e de benchmark, e o nome ny-pi onde explica a origem do harness e dos números; é exceção a D-30 e o resto do README segue sem pi. A proposta é "barato como o Pi Vanilla e pelo menos tão certeiro quanto o Claude Code"; os números são do ny-pi sobre pi 1.5.2, **não** do binário nycode (D-29: sem rodada antes do lançamento), e o README não diz "melhor" nem "mais certeiro" que o Claude Code, porque os dados mostram não inferior, não à frente (probabilidade 0,68, abaixo de 0,80). (b) todos os docs do ny-pi, exceto `docs/ui-ux-gallery`, são copiados agora por outro PR: `claude-home/docs` para `docs/harness`, o resto para `docs/migration/ny-pi-arquivo`. (c) a descrição do repositório passou a "Terminal coding agent with a built-in harness (extensions, hooks, skills and agents), built to cost less than Claude Code without solving fewer tasks." e o tópico `pi-coding-agent` foi removido. Ajusta 05 §6 e o gate de resíduo R1 (P-17, C-F12-06): `README.md` e `docs/harness/` entram nas exceções. Sem mudança na contagem de 186 itens | adotada | F10, F12 |

## Detalhe das decisões com alternativa relevante

### D-01. Extensão embutida em vez de reescrever o core

- Contexto: o pedido é "implementar no core". O fork já tem extensões embutidas compiladas dentro do pacote
  (`src/extensions/index.ts`), sem instalação nem carga por `jiti`, ligáveis em `nycode config`.
- Alternativas: (a) reescrever tudo dentro de `src/core/`; (b) pacote de workspace `@nycode/harness` carregado por
  padrão; (c) extensão embutida.
- Escolha: (c), e (a) apenas nas 14 costuras de [02, seção 4](02-arquitetura-alvo.md#4-mudancas-de-core-n1).
- Por quê: (c) é parte do binário e do pacote, portanto "core" para quem usa, mas quase não toca arquivo do upstream.
  (a) multiplica o conflito a cada sincronização. (b) cria mais um pacote publicado sem ganho.
- Custo aceito: as extensões embutidas continuam limitadas pela `ExtensionAPI`; onde ela não basta, a API cresce
  (K10) em vez de a extensão ler campo privado.

### D-02. Importar o pi-code 1.7.0 remendado

- Alternativa: atualizar para a 1.10.1 (a mais nova no npm em 2026-11-20) durante a importação.
- Escolha: 1.7.0 + 19 patches, exatamente a árvore medida nos benchmarks.
- Por quê: paridade exige uma variável por vez. Depois do corte, cada novidade do pi-code entre 1.7.0 e a versão
  corrente é avaliada como mudança normal (comparação de árvore e gate).
- Consequência: o nycode passa a ser dono desse código; `NOTICE` registra a origem e a licença MIT.

### D-03. Histórico do ny-pi

- Alternativas: (a) `git subtree add` (um merge, histórico preservado, sem reescrever SHAs de quem clona);
  (b) `git filter-repo --to-subdirectory-filter import/ny-pi` num clone novo e `git merge
  --allow-unrelated-histories`; (c) copiar os arquivos sem histórico e deixar o repositório antigo como referência.
- Escolha: (b). O manual do filter-repo descreve este uso ("moving all files into a subdirectory in preparation for
  merging with another repo") e os caminhos já ficam certos em todo o histórico, o que faz `git log --follow` e
  `git blame` funcionarem depois dos `git mv`.
- Restrição de ordem: a fusão é um merge commit; tem de entrar **antes** de o ruleset de F3 limitar os métodos.
- Reversão: reverter o merge commit (nenhum arquivo fora de `import/ny-pi/` é tocado).

### D-07. Sincronização com o upstream e a regra de histórico linear

- Conflito: o ruleset do ny-pi exige `required_linear_history` e `allowed_merge_methods: ["squash"]`. Um fork que
  recebe o upstream por fusão precisa de merge commits: com squash, o git perde o ancestral comum e a sincronização
  seguinte volta a conflitar em tudo o que já foi resolvido.
- Alternativas:
  - A. Remover `required_linear_history`; permitir `squash` e `merge`; `merge` só para PR de ramo
    `sync/upstream-*`. A interface do GitHub não restringe o método por ramo de origem, então um job
    `merge-policy` roda a cada push em `main` e falha (abrindo issue) se um merge commit não tiver o segundo pai
    alcançável a partir do espelho `upstream/main`.
  - Refinamento (medido em [08](08-sincronizacao-upstream.md), 2026-11-20): a fusão direta de `upstream/main` conflita
    por causa do renome (6 de 22 arquivos numa amostra de 8 commits). A forma adotada de A é fundir a **imagem
    renomeada** do upstream: um commit `R` de dois pais (`R` anterior e o commit `U` do upstream), produzido pelo
    script de renome versionado (0 conflitos de conteúdo na mesma amostra). O `merge-policy` confere que `R^2` é
    ancestral do espelho e recalcula a imagem com o script de `main`; por isso aceita commits de resolução de
    conflito no ramo de sincronização, o que a regra literal "segundo pai alcançável" não aceitava
    ([07](07-ci-qualidade-seguranca.md)). A variante exata é testada em F3 antes de o ruleset ser ativado.
  - B. Manter histórico linear; permitir `squash` e `rebase`; sincronizar por `cherry-pick -x` do intervalo de
    commits do upstream. Mantém a regra, mas o conflito é resolvido commit a commit e o ancestral comum não avança.
  - C. Pilha de patches sobre o upstream (modelo VSCodium): o repositório guarda só os patches. Descartado: é o
    modelo "por fora" que esta migração existe para abandonar.
- Escolha: **A**. É a única que mantém o custo de sincronização proporcional ao que mudou no upstream.
- O que continua estrito: sem exclusão de ramo, sem push forçado, PR obrigatório, conversas resolvidas, checks
  obrigatórios com ramo atualizado, sem ator com dispensa.
- Evidência externa: fraca. A pesquisa de 2026-11-20 não abriu fonte primária sobre políticas de forks grandes
  ([13](13-fontes.md)); a escolha se apoia no funcionamento do git (ancestral comum), não em autoridade externa.

### D-08. Hooks de permissão em duas fases

- `guard.py` (799 linhas) é o único controle técnico de segurança do harness; tem `test_guard.py` e fuzz.
- Fase A: roda como hoje, lançado pela extensão `hooks` em `PreToolUse`. Paridade garantida, custo de um processo
  Python por chamada de ferramenta.
- Fase B: `core/permissions/` em TypeScript, ligado por `permissions.engine: "native"` (padrão `"script"`). O padrão
  só muda quando o teste diferencial der o mesmo veredito nos dois motores em 100% do corpus e do fuzz com semente
  fixa, e depois de revisão de segurança.
- Nunca os dois desligados: se o motor escolhido falhar ao iniciar, a chamada é negada.

### D-12. Serviços do upstream

O fork ainda consulta `pi.dev` em: catálogo de modelos (`remote-catalog-provider.ts:14`), instalador
(`package-manager-cli.ts:1244`), aviso de versão e documentação. O registro do fork (`docs/fork/`) lista essas
exceções como intencionais.

- Catálogo de modelos: continuar no do upstream. Hospedar um próprio é custo permanente sem benefício medido.
- Instalador: `npm install -g --ignore-scripts @nycode/coding-agent` e binários em GitHub Releases; o README deixa de
  apontar `pi.dev/install.sh`, que instalaria o pi e não o nycode.
- Aviso de versão e autoatualização: registro npm do `@nycode/coding-agent`.
- OAuth: os identificadores de cliente do upstream continuam (são de aplicativo instalado, públicos por natureza).

### D-14 e D-25. Benchmark e troca de base

- A referência guardada do ny-pi foi medida sobre pi 1.5.2 + pi-code 1.7.0. O nycode é pi 1.6.0.
- F3 mede primeiro "ny-pi por fora sobre pi 1.6.0" (um braço temporário `ny-pi@1.6.0`). Se ele já difere da
  referência, a diferença é da base, não da migração, e vira a nova referência de paridade.
- F10 mede o braço `nycode` contra essa referência e roda `pi-vanilla` e `cc-vanilla` uma vez (mudança de versão é
  gatilho pela regra do dono de 2026-11-15).
- Todas as rodadas usam a conta `claude`, em fila única.

## Pendências que não são decisão

| # | Pendência | Como fechar | Fase |
|---|---|---|---|
| P-1 | Classe (`core`, `ui`, `optional`) de cada peça | Ler a tabela da especificação 0005 (97 linhas) e copiar para a coluna "classe" de [03](03-mapa-de-migracao.md) | F0 |
| P-2 | Conteúdo linha a linha dos patches grandes (`subagent-panel`, 2547 linhas; `goal`, 872) | Lido pelo executor da unidade em F6; não muda o plano | F6 |
| P-3 | Se a `ExtensionAPI` do pi 1.6.0 mudou algum evento usado pelas extensões escritas para a 1.5.2 | `npm run check` das extensões importadas contra os tipos do fork, na primeira unidade de F5 | F5 |
| P-4 | Licença e autoria de cada skill com origem em terceiros (`claude-home/docs/third-party/`) | Conferir e levar ao `NOTICE` | F8 |
| P-5 | Fonte primária para a política de sincronização de forks | Nova rodada de pesquisa quando houver orçamento; não trava | — |
| P-6 | `build-check` falha sem etiqueta `v*.*.*` | Etiqueta `v1.6.0-base` em F0 | F0 |
| P-7 | Skill `release.md` do fork cita workflows removidos (`build-binaries.yml`, `nix.yml`) | Reescrever em F11 | F11 |
| P-8 | O campo de emblema do README conta 15 alertas depois de fechados | Efeito de cache do GitHub; conferir pela API | — |
| P-9 | O script de renome do fork só existe em `/tmp/nycode-rename/` (PC-1 de [08](08-sincronizacao-upstream.md)); reproduz o commit `f523ebd25` com diferença em 230 de 2316 arquivos | Versionar em `scripts/fork/` com teste de reprodução; **copiar para fora de `/tmp` antes de reiniciar a máquina** | F0 |
| P-10 | `ci.yml` e `npm-audit.yml` do fork não passam na política do `run-security.sh` (falta `permissions: {}` no topo e `merge_group`); `npm run check` usa `--write` no CI | Corrigir em F3 ([07](07-ci-qualidade-seguranca.md)) | F3 |
| P-11 | Quatro patches sem teste próprio: `commands-print`, `zz-hotkeys-no-alt`, `zz-panel-main-root`, `zzz-panel-column0` | Escrever teste de caracterização ao portar ([06](06-guia-de-execucao.md#f5)) | F5, F6 |
| P-12 | Logo do nycode tem contraste baixo em fundo branco (1,14 no extremo claro); `extensions/ui-visual/header.ts` copia o logo do pi; `nycodeWordmark()` devolve "P" e "i" | Opções em [05, seção 7](05-marca-e-readme.md); cabeçalho trocado em F7 | F2, F7 |
| P-13 | Estimativa de custo do tier `full` (US$ 86,16) acima do teto noturno de 30; S3 pede `n=50` com 19 tarefas utilizáveis | Ajustar teto ou amostra em F3 ([09](09-paridade-e-benchmark.md)) | F3 |
| P-14 | `packages/coding-agent/test/subagent-extension.test.ts` "escalates SIGTERM to SIGKILL..." é instável sob a suíte inteira (falhou em 1 de 3 `./test.sh` em F0, passa isolado; `evidencias/F0.md`) | Diagnosticar e corrigir num PR próprio antes de F6, que porta o `subagent` | F6 |
| P-15 | `packages/durable` `store-storage-commit.test.ts` ("rolls a 3-batch call back…", third valid) estourou 5000 ms uma vez no CI (`test (durable)`, PR #205: 5145 ms; em 8 runs verdes: 337 a 443 ms) | Resolvida em F3: reproduzida com `CPUQuota=2%` (vermelho, 6300 ms), causa é CPU do runner compartilhado contra o padrão de 5 s do vitest num teste de ~30 ciclos em disco; o teste ganha teto próprio de 30 s (verde a 2%: 7700 ms). Arquivo do upstream, só teste: numa sincronização, manter o teto | F3 |
| P-16 | Benchmark adiado (D-29): medir `ny-pi-pi160` no tier `pr` (C-F3-09), piloto S2 do agente Harbor do `nycode`, `baseline-main` do braço `nycode`, instalar o poster com `~/.config/nycode/bench.env`, provar `bench-pr` num PR de docs (C-F3-10) e devolver `bench-pr` ao ruleset | Fazer quando o dono liberar; antes de F10 (o gate de paridade depende disso) | liberação do dono |
| P-17 | Executar D-30 (esconder o pi) | Unidades, um PR cada: **K15** (F4) cortar `pi.dev` do core (`rg -l "pi\.dev" packages/*/src` lista 14 arquivos em `cd6f7659f`: telemetria, versão, changelog, `/share`, OAuth, catálogo remoto e de modelos, radius, atribuição, instalador, `$schema` dos temas); **K16** (F4) remover os aliases `@mariozechner/*` do carregador de extensões e avisar em `migrate from-pi`; **K17** (F4) README e metadados dos pacotes (`author`, `homepage`, `repository`, `bugs`) sem pi, `NOTICE` curto; **R1** (F12, antes de C-F12-06) estender `scripts/fork/rename.py` aos internos, reaplicar e criar o gate de resíduo (`rg -niw "pi\|pi-[a-z]+\|pi\.dev\|earendil\|mariozechner"` só em `LICENSE`, `NOTICE`, `CHANGELOG.md`, `migrations/from-pi`, `docs/fork`, `docs/migration`, `docs/harness/` e `README.md`, o arquivo inteiro no gate, D-31) | F4, F12 |
