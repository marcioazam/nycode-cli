# Extensões de economia de contexto (2026-11-12)

Origem: avaliação do `floydous/pi-agent-kernel` v0.6.0 (clone em `/tmp/pak-1162441`). Decisão: não instalar o
pacote (troca `read`/`edit`/`write`/`bash`; o `read({paths})` e o `edit({files})` dele passam vazios pelo
`claude-tools.ts` do pi-code, então o `guard.py` não bloqueia `.env`). Aproveitar três ideias como extensões
próprias, sem trocar ferramenta nenhuma. Pedido do usuário: "execute estes" (itens 1–3).

## Objetivo e aceitação

1. `extensions/bash-clamp/`: no `tool_result` do `bash`, saída acima de 100 linhas, 20 KB ou com linha acima de 300
   caracteres vira cabeça + cauda (em erro: cauda maior e janela em volta da primeira linha de diagnóstico), linhas
   longas cortadas, rodapé com o caminho do log completo e a chamada `read` com offset/limit. O status
   (`Command exited with code N`, timeout, abort) continua no fim. Saída pequena passa intacta. Quando o pi já cortou
   (`Full output: PATH`), reusa o arquivo dele em vez de gravar outro. Limites: os do kernel (100 linhas, 20 KB,
   300 caracteres), os únicos com benchmark.
2. `extensions/syntax-check/`: no `tool_result` de `edit`/`write`, parse com tree-sitter
   (`@vscode/tree-sitter-wasm` 0.3.1, MIT, Microsoft; runtime + gramáticas num pacote só). Acrescenta
   `Syntax check: parse error at L:C (...)` só quando o arquivo novo tem erro e o anterior não tinha (ou não existia).
   Linguagem sem gramática, falha de carga ou arquivo > 2 MB: silêncio. Complementa o pi-lsp, que falha quando o
   servidor não acha o projeto (ex.: TypeScript fora de um repositório) ou demora.
3. `extensions/pi-docs/`: a seção `docs` do prompt (≈1,3 KB) vira um ponteiro de uma linha fora de trabalho no pi.
   Modo `auto` (padrão): completa quando o cwd é `$HOME`, fica sob `~/.pi`, ou o `package.json` do cwd cita
   `pi-coding-agent`/`pi-package`; compacta nos demais. `/pi-docs on|off|auto` troca na sessão. Usa
   `systemPromptOptions.sections.docs` (patch de seção, sem quebrar o cache do prefixo).

## Custo e qualidade (rules/harness-economy.md)

- Custo: três handlers locais; o syntax-check carrega ~22 MB de wasm sob demanda (só a gramática usada) e custa
  milissegundos por edição. Nenhuma chamada de modelo extra.
- Ganho: menos tokens por saída grande de bash (pi corta só em 2000 linhas/50 KB); erro de sintaxe visto na mesma
  volta; ~300 tokens a menos de prompt fora do pi.
- Risco: o modelo ler o log mais vezes (mais turnos). Reverter: apagar o diretório da extensão.

## Plano

- [x] Lane única `swarm-worker` (fora de Git: escritores em sequência): as três extensões + testes colocalizados.
- [x] Revisão no thread principal; gate único: testes `node --test` das três, `structure.py`, checks do harness.

## Evidência

- Revisão: `pi-docs` alternaria a seção entre turnos (o prompt já compacto não traz os caminhos); corrigido com memo
  e teste. E2E achou `of 501 lines` para `seq 1 500` (newline final contado); teste vermelho com a correção
  revertida (7 pass/1 fail), verde depois.
- `node --experimental-strip-types --test` nas três: 17/17. Cobertura: bash-clamp 94,9%, syntax-check 95,7%,
  pi-docs 97,7% (linhas). `npm audit` em syntax-check: 0 vulnerabilidades.
- E2E `pi -p --model anthropic/claude-haiku-5-5` em `/tmp/e2e-ce-1219175` (fora do pi): `seq 1 500` voltou com
  100 linhas + rodapé e log de 500 linhas em `/tmp/pi-bash-clamp/`; `edit` para `def f(:` voltou com
  `parse error at 1:7`; a sessão gravou a seção `docs` compacta.
- `structure.py --project-root ~/.pi/agent/extensions`: `over-7-code-files:.:9`, pré-existente (9 arquivos na raiz
  antes desta mudança; as novas ficam em subdiretórios).
- Não feito: A/B de custo (`pelo-em-ovo`) — precisa de teto de gasto do usuário.

## pi-lsp pós-edit enxuto (2026-11-12)

Origem: avaliação do `samfoy/pi-lsp-extension` v1.4.0 (não instalado: colide com os nomes de ferramenta do pi-lsp e
cobre 5 servidores contra 18). Ideia aproveitada: o diagnóstico automático depois de `edit`/`write` mostra só erros.

- Evidência (111 sessões em `~/.pi/agent/sessions`): 148 avisos de configuração ("root markers not found",
  "Request initialize failed"), 52 "✅ no diagnostics", 61 diagnósticos reais; ≈77% do texto pós-edit é ruído.
- Aceitação: em `updateDiagnosticsForFile` (só o hook pós-edit) não sai "root markers not found" nem "skipped …
  maxFileSizeBytes"; avisos de config e falhas de servidor saem uma vez por sessão; só erros (severity 1 ou sem
  severity), no máximo 10, mais "… N more errors"; nada a dizer = nada acrescentado. `lsp_diagnostics` e
  `_shared/output.ts` ficam iguais (consulta explícita completa).
- Fora: só consultar o LSP com servidor já rodando (troca velocidade por erros de tipo vistos na hora); medir antes
  com `pelo-em-ovo`.
- Reverter: desfazer os trechos "PATCH local (vendor)" em `vendor/pi-lsp/extensions/pi-lsp/index.ts` e apagar
  `post-edit.ts` e `post-edit.test.ts`.

### Evidência

- Lane `swarm-worker`: `pi-lsp/post-edit.ts` (30 linhas, `formatPostEdit` + `oncePerSession`), `post-edit.test.ts`
  (47 linhas), patch em `updateDiagnosticsForFile` e um campo `reported` em `LspManager` (`index.ts` 697 → 707 linhas).
  Desvio: `_shared/output.ts` não carrega sob strip-types (import `./paths` sem extensão), então o formatador está
  inline e o pós-edit não traz as linhas `related:` (a consulta explícita traz).
- Gate: `node --experimental-strip-types --experimental-test-coverage --test post-edit.test.ts shutdown.test.ts`:
  8/8, `post-edit.ts` 100% de linhas/ramos/funções; as três extensões novas: 17/17; `structure.py` em
  `vendor/pi-lsp/extensions`: sem achados.
- E2E `pi -p --model anthropic/claude-haiku-5-5` (`/tmp/e2e-lsp-1287907`): (a) `.py` fora de projeto, edit válido →
  resultado só "Successfully replaced 1 block(s) in ok.py." (antes: avisos de root markers de ruff e pyright);
  (b) projeto com `pyproject.toml`, `return "x"` em função `-> int` → só o erro do pyright `reportReturnType`.
- Risco aceito: uma falha de servidor repetida aparece uma vez por sessão; depois, só via `lsp_diagnostics`.

## pi-test-harness: descartado (2026-11-12)

Spike em `/tmp/pth-spike-1325556`: `@marcfargas/pi-test-harness@0.6.1` (npm pack sem scripts, grego.py sem achados)
com `@earendil-works/*@1.5.2`. Incompatível: (1) importa `getModel` de `pi-ai`, que o 1.5.2 não exporta mais;
(2) com um shim local, falha em "No API key found for openai" porque o truque de auth sobrescreve métodos privados
de `session._modelRegistry` que mudaram. Último release 2026-05-22. Caminho nativo (`registerFauxProvider` de
`@earendil-works/pi-ai/compat` + `createAgentSession`) carrega a extensão, mas a auth do provider faux não fecha via
`auth.json` nem `modelRuntime.setRuntimeApiKey`; parado no limite de tentativas. Mantido: testes unitários +
E2E `pi -p` com Haiku.
