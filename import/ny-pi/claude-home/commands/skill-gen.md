---
description: "Gera uma skill do pi a partir da URL de uma documentação (Firecrawl MCP, com alternativa sem chave)"
disable-model-invocation: true
argument-hint: "<url-da-documentação>"
---

<!-- Porte para o pi (2026-11-11) do /firecrawl:skill-gen (firecrawl 1.0.9, plugin desligado no Claude). Mudanças: a CLI
`firecrawl` virou o MCP do pi (mcp__firecrawl__firecrawl_map/scrape/crawl, carregados com tool_search); map e crawl
exigem sessão autenticada, então sem chave a coleta cai para firecrawl_scrape/web_fetch página a página; locais de
skill do pi (projeto .pi/skills ou .agents/skills, global ~/.pi/agent/claude-home/skills); perguntas com `question`;
regras de nome e descrição conferidas nos docs do pi (skills.md: minúsculas, números e hífens, até 64; descrição até
1024); skill global passa pelo validador do harness. -->

URL da documentação: **$ARGUMENTS** (vazio: peça a URL com `question` e pare até ter).

Crie uma skill completa, pronta para um agente usar: só o que é útil e não óbvio (conhecimento de procedimento,
detalhes do domínio, recursos reutilizáveis).

## 1. Colete a documentação

Carregue as ferramentas com `tool_search` ("firecrawl map scrape crawl").
1. Mapeie: `mcp__firecrawl__firecrawl_map` com `url` e `search` "<ferramenta> API reference getting started".
2. Raspe as páginas-chave (referência da API, quickstart, conceitos, autenticação, exemplos) com
   `mcp__firecrawl__firecrawl_scrape` (formato markdown).
3. Site grande: `mcp__firecrawl__firecrawl_crawl` com `maxDiscoveryDepth: 2` e `limit: 15`.

Se map ou crawl responder que precisa de autenticação ou de créditos, siga só com `firecrawl_scrape` (ou `web_fetch`)
na URL dada e nos links dela. Pule changelog, blog e comunidade. Guarde as URLs de onde veio cada fato.

## 2. Escopo

Pergunte com `question`, no máximo 2 perguntas (pule se já estiver claro): o nome (sugira um kebab-case) e os 2-3 usos
principais (o que o usuário diria para acionar a skill).

## 3. Planeje

Para cada uso, pense em como fazê-lo do zero e no que ajudaria a repeti-lo:
- `scripts/`: o mesmo código seria reescrito toda vez;
- `references/`: o agente teria de redescobrir esquemas, especificações ou conhecimento do domínio;
- `assets/`: o mesmo boilerplate seria necessário toda vez.

## 4. Apresente o plano (OBRIGATÓRIO antes de escrever qualquer arquivo)

A árvore de diretórios proposta, o que cada arquivo terá e o frontmatter (`name`, `description`). Espere a aprovação;
pedido de mudança: revise e apresente de novo.

## 5. Pergunte onde salvar (OBRIGATÓRIO, sem padrão)

Com `question`:
1. **Projeto**: `.pi/skills/<nome>/` (ou `.agents/skills/<nome>/`, que outros agentes também leem) no cwd.
2. **Global**: `~/.pi/agent/claude-home/skills/<nome>/` (todas as sessões do pi deste harness).
3. **Outro caminho**: o usuário informa.

## 6. Construa

Só depois do plano aprovado e do local escolhido. Scripts: rode-os (uma amostra, se forem muitos parecidos) antes de
entregar.

## 7. Valide e informe PASS/FAIL de cada item (corrija o que falhar)

1. Frontmatter: `name` em minúsculas, números e hífens, sem hífen no início, no fim ou duplo, até 64 caracteres,
   igual ao nome do diretório; `description` não vazia, até 1024 caracteres, dizendo o que faz e quando usar.
2. `wc -l SKILL.md` abaixo de 500.
3. Sem documentação auxiliar no diretório da skill (README.md, CHANGELOG.md, INSTALLATION_GUIDE.md).
4. Arquivos de `references/` a um nível do SKILL.md (sem subdiretórios dentro de `references/`).
5. Global: `python3 ~/.pi/agent/claude-home/bin/checks/check-instructions.py` sem problemas novos.
6. Carga real: `pi --session-dir "\$(mktemp -d)" -p "/skill:<nome>"` não acusa erro de skill (ou `/reload` e
   `/skill:<nome>` na TUI).

## 8. Entregue

Resumo do que foi feito, a árvore com contagem de linhas, os resultados da validação, o local e as URLs usadas.

## Referência do formato

```
<nome>/
├── SKILL.md       (obrigatório)
├── scripts/       (opcional: código para tarefas determinísticas)
├── references/    (opcional: docs carregados sob demanda)
└── assets/        (opcional: modelos e arquivos usados na saída)
```

- `description` é o mecanismo de ativação: o que faz E quando usar, com gatilhos concretos; o "quando usar" vai aqui,
  não no corpo (o corpo só carrega depois).
- Corpo no imperativo, abaixo de 500 linhas. O agente já é capaz: cada parágrafo precisa justificar o custo em tokens.
  Exemplos curtos valem mais que explicação.
- Grau de liberdade conforme a fragilidade: texto (várias abordagens válidas), pseudocódigo ou script parametrizado
  (há um padrão preferido), script exato (operação frágil, consistência crítica).
- Divulgação progressiva: SKILL.md com o essencial e links para `references/<tema>.md`, dizendo quando ler cada um;
  referência com mais de 100 linhas abre com um sumário; com mais de 10 mil palavras, dê padrões de `rg` para achar.
- Fluxos em passos numerados; decisões como "Criando? → fluxo A; Editando? → fluxo B".
- Saída com formato fixo: dê o modelo; estilo que depende de exemplo: dê exemplos de entrada e saída.
- Cada informação mora num lugar só (SKILL.md ou references), nunca nos dois.
