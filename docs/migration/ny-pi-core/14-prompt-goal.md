# Prompt de `/goal` para executar a migração

Condição pronta para colar depois de `/goal`. O limite do comando é de 4000 caracteres; esta tem menos de 3000.
Rodar a partir de um worktree do nycode, com o PR #196 já na `main`. O detalhe de cada passo está nos documentos
citados; o prompt só fixa a ordem, os limites e a condição de parada.

```text
Migrar o harness marcioazam/ny-pi para o core do fork marcioazam/nycode, executando o plano de docs/migration/ny-pi-core/ (PR #196) fase a fase, de F0 a F12, até o checklist 12-checklist-mestre.md estar 100% marcado com evidência.

Como trabalhar:
1. Antes de tudo leia README.md, 00-mega-plano.md, 11-decisoes-e-pendencias.md e a seção da fase atual em 06-guia-de-execucao.md. O plano manda; se ele contradiz o código, pare, corrija o documento num PR de docs e siga.
2. Uma fase por vez, na ordem do grafo de 00. Só abra a fase seguinte quando a atual tiver evidencias/F<n>.md gravado (comando + saída) e seus itens C-F<n>-* marcados.
3. Dentro da fase: um PR squash por unidade (extensão, costura, grupo de regras). Destino de cada arquivo: 03-mapa-de-migracao.md e anexos/E-mapa-arquivo-a-arquivo.tsv. Importação em 3 commits (cópia byte a byte, troca de imports/nomes, formatação). Teste portado verde antes do merge.
4. Paridade antes de melhoria: nenhuma mudança de comportamento durante a migração. Critério e gate em 09-paridade-e-benchmark.md; benchmark só para mudança funcional, na conta claude, em fila única.
5. Regras do repositório e ruleset: 04-regras-do-repositorio.md. Logo e README: 05-marca-e-readme.md (sha256 do anexo C). CI: 07. Sync com upstream: 08, só por PR sync/upstream-*.
6. Em falha: reproduzir, uma hipótese, um novo intento; depois reverter pelo 10-riscos-e-rollback.md e registrar.

Limites duros:
- Nunca --admin, --no-verify, force push nem bypass de check obrigatório.
- Não tocar /home/marcio/code/pi-harness nem as branches feat/ui-onda9*; ler o ny-pi só por git show origin/main.
- Sem compatibilidade PI_*: só nycode migrate from-pi (D-09). Segredos nunca em log, commit ou evidência.
- Ações que exigem o dono (D-15 apagar ramos, D-16 alertas de secret scanning, D-17 escopo npm, D-22 arquivar ny-pi, publicar no npm, apagar proteção clássica): não execute sem autorização explícita nesta conversa. Sem ela, faça todo o trabalho independente e termine o turno com "PLAN BLOCKED: <decisão>".
- Primeiro passo de F0: copiar /tmp/nycode-rename/ para scripts/fork/ (P-9).

A meta está cumprida quando, mostrado na conversa:
(a) 12-checklist-mestre.md com 186 de 186 itens marcados e evidencias/F0.md a F12.md existentes;
(b) os 8 critérios globais de 00-mega-plano.md conferidos, cada um com comando e saída;
(c) gate de paridade do braço nycode não inferior à referência (veredito impresso);
(d) rg "pi.dev/logo" README.md vazio e sha256 de docs/assets/nycode-pixel.svg igual ao do anexo C;
(e) ruleset main ativo igual a .github/rulesets/main.json, com gh pr checks verde no último PR;
(f) import/ny-pi/ removido e git status limpo em main.

Ao fim de cada turno: fase atual, itens fechados no turno com a evidência, o que falta, e o mapa (a)-(f) -> evidência ou pendência.
```

## Variante por fase

Para sessões mais curtas, trocar o primeiro parágrafo por "Executar apenas a fase F<n> de
docs/migration/ny-pi-core/06-guia-de-execucao.md" e a condição de parada por "todos os itens C-F<n>-* marcados e
evidencias/F<n>.md gravado, com os comandos de verificação de saída da fase mostrados na conversa".
