# Auditoria SOTA do ny-pi (2026-11-19)

Registro vivo. Ramo `feat/ui-onda9-harness`, árvore suja com trabalho alheio (232 caminhos em 2026-11-19 04:01): nada
de commit, push ou PR nesta tarefa; cada correção toca só os arquivos listados em `02-seguranca-performance.md`.

## Pedido do dono (2026-11-19)

1. Buscar gaps e bugs, analisar logs.
2. Executar somente correções de segurança e de performance (com testes). Todo o resto é análise e documento.
3. Avaliar paletas e UI e sugerir ajustes (sem executar).
4. Escrever até 3 planos SOTA para um gerenciador multiagente (interface que esconde o chat, grafo de agentes,
   conexões e responsabilidades). Não implementar.
5. Pesquisa web ampla (meta: 150 buscas em provedores e tipos de fonte diferentes) para acertar mais que o Claude
   Code no benchmark custando menos. Só documento e plano.
6. Documento com o máximo de melhorias sugeridas.

## Aceitação

- AC1: cada defeito listado tem `arquivo:linha`, falha concreta e correção mínima proposta.
- AC2: cada correção executada é de segurança ou performance, tem teste que falha sem ela e passa com ela.
- AC3: os documentos 03 a 06 existem, citam fonte por afirmação externa e separam fato de suposição.
- AC4: o registro de pesquisa soma as buscas por provedor e por tipo de fonte.
- AC5: nenhum arquivo fora de `docs/audit-2026-11-19/` e da lista de 02 foi alterado por esta tarefa.

## Documentos

| arquivo | conteúdo | estado |
|---|---|---|
| `01-gaps-bugs-logs.md` | defeitos, lacunas de teste, análise de logs | pendente |
| `02-seguranca-performance.md` | correções executadas, evidência, rollback | pendente |
| `03-ui-paletas.md` | avaliação de UI e paletas, ajustes sugeridos | pendente |
| `04-gerenciador-multiagente-planos.md` | até 3 planos para a interface de grafo de agentes | pendente |
| `05-benchmark-custo-sota.md` | plano para superar o Claude Code em acerto com menor custo | pendente |
| `06-melhorias.md` | lista priorizada de melhorias | pendente |
| `research/` | um arquivo por tema de pesquisa, com fontes | pendente |

## Checkpoint

2026-11-19, fim da sessão. Documentos 01–06 escritos; `research/` com R1–R7 (R4 em `faixas/r4-artigos.md`) e
`verificacao-cruzada.md`. Correções U1–U4 feitas e testadas; gate único rodado (vermelho por arquivos de outras
sessões; detalhes em `02-seguranca-performance.md`, seção Gate). Nada commitado.

Decisões abertas para o dono: `optin` do `supervisor.sh`; negar `.env.<qualquer>` (muda teste existente); aplicar o
matcher `Grep` no `settings.json` vivo; sandbox de SO; Haiku em papéis de leitura; as 5 perguntas do doc 04.

Não executado: `run-security.sh`, cobertura, markdownlint, teste de instalação, mock de UI, pi real com as mudanças.
