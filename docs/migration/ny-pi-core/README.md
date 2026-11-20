# Migração do ny-pi para o core do nycode

Plano e guias para levar o harness [`marcioazam/ny-pi`](https://github.com/marcioazam/ny-pi) para dentro do
[`marcioazam/nycode`](https://github.com/marcioazam/nycode), o fork do pi.

**Estado: plano. Nada foi implementado.** Estes documentos descrevem o trabalho; nenhuma linha de código, regra do
GitHub ou arquivo fora desta pasta foi alterado.

Levantamento: 2026-11-20, sobre `ny-pi@e4f8729` e `nycode@fb05db936`.

## Ordem de leitura

| # | Documento | Para quê |
|---|---|---|
| 00 | [Mega plano](00-mega-plano.md) | Objetivo, princípios, as 13 fases, critérios de aceite, riscos principais |
| 01 | [Inventário](01-inventario-origem.md) | O que existe hoje na origem e no destino, com contagens |
| 02 | [Arquitetura alvo](02-arquitetura-alvo.md) | Onde cada peça passa a morar, costuras no core, configuração |
| 03 | [Mapa de migração](03-mapa-de-migracao.md) | Destino de cada arquivo, módulo, terceiro e dado do usuário |
| 04 | [Regras do repositório](04-regras-do-repositorio.md) | Todas as regras do ny-pi no nycode: GitHub e arquivos |
| 05 | [Marca e README](05-marca-e-readme.md) | Logo do nycode recuperado do histórico; README sem o logo do pi |
| 06 | [Guia de execução](06-guia-de-execucao.md) | Passo a passo com comandos, fase por fase |
| 07 | [CI, qualidade e segurança](07-ci-qualidade-seguranca.md) | Workflows, checks obrigatórios, cadeia de suprimento |
| 08 | [Sincronização com o upstream](08-sincronizacao-upstream.md) | Como o fork continua recebendo o pi |
| 09 | [Paridade e benchmark](09-paridade-e-benchmark.md) | Como provar que o nycode faz o que o ny-pi fazia |
| 10 | [Riscos e reversão](10-riscos-e-rollback.md) | Registro de riscos, como desfazer cada fase |
| 11 | [Decisões e pendências](11-decisoes-e-pendencias.md) | 28 decisões (4 aguardam o dono) e 13 pendências |
| 12 | [Checklist mestre](12-checklist-mestre.md) | 186 itens verificáveis |
| 13 | [Fontes](13-fontes.md) | Comandos e fontes de cada fato; o que não foi verificado |

## Anexos

| Anexo | Conteúdo |
|---|---|
| [A](anexos/A-inventario-ny-pi.md) | Levantamento bruto do ny-pi |
| [B](anexos/B-mapa-core-nycode.md) | Levantamento bruto do core do nycode |
| [C](anexos/C-logo-historico.md) | O logo do nycode no histórico git |
| [D](anexos/D-regras-github-brutas.md) | Regras do GitHub dos dois repositórios |
| [E](anexos/E-resumo-por-regra.md) | Mapa por regra; [um arquivo por linha](anexos/E-mapa-arquivo-a-arquivo.tsv); [gerador](anexos/gerar-mapa.py) |

## Em uma página

- O ny-pi é um harness montado por fora do pi: um wrapper aplica 19 patches no pi-code e 2 no pi a cada início, e
  carrega 23 extensões, 17 agentes, 30 skills e um conjunto de hooks de uma pasta de configuração.
- O nycode já é o fork do pi (1.6.0), renomeado. Ele tem extensões embutidas no binário, e é por elas que quase todo
  o ny-pi entra: código novo em diretórios novos, com 14 edições pequenas em arquivos do upstream.
- A ordem é: congelar e medir (F0), trazer o histórico (F1), regras e marca (F2), CI e benchmark (F3), core (F4),
  camada base do pi-code (F5), subagentes e plano (F6), extensões próprias (F7), agentes, skills e permissões (F8),
  terceiros (F9), paridade (F10), publicação (F11), corte (F12).
- Cada fase só fecha com teste portado e gate do benchmark não inferior à referência.
- Uma regra do ny-pi é afrouxada: histórico linear. Um fork precisa de merge commit para receber o upstream; isso
  fica restrito aos PRs de sincronização e é auditado (D-07).

## Antes de começar

Quatro respostas do dono travam o início de alguma fase
([detalhe](11-decisoes-e-pendencias.md)):

1. D-15: apagar os 213 ramos herdados do antigo nycode em Rust?
2. D-16: fechar os 8 alertas de secret scanning como credencial pública do upstream?
3. D-17: criar a organização `@nycode` no npm?
4. D-22: arquivar o repositório ny-pi no corte?

## Evidências

Cada fase executada grava `evidencias/F<n>.md` nesta pasta (modelo em [06](06-guia-de-execucao.md)). A pasta ainda
não existe porque nada foi executado.
