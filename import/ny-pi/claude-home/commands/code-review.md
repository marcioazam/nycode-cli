---
description: "Revisão de alto sinal de um PR do GitHub (bugs e violações de AGENTS.md/CLAUDE.md), com validação de cada achado; --comment publica"
disable-model-invocation: true
argument-hint: "<número ou URL do PR> [--comment]"
---

<!-- Porte para o pi (2026-11-11) do /code-review:code-review (plugin code-review 1.0.1, desligado no Claude). Mudanças:
os níveis haiku/sonnet/opus viraram agentes do pi (o pi não tem modelo por chamada): triagem em `Explore` (fixado em
Haiku, somente leitura) e revisão/validação em `code-reviewer` (modelo da sessão); as regras vêm de AGENTS.md e
CLAUDE.md (o pi lê os dois); o MCP github_inline_comment do plugin não existe no pi, então os comentários saem numa
única review pela REST (`gh api .../pulls/N/reviews`, event COMMENT, conferido em docs.github.com/rest/pulls). Sem
`--comment` nada é publicado. -->

Argumentos: `$ARGUMENTS`. PR = o número ou a URL dados; sem nenhum, o PR da branch atual (`gh pr view --json number`).
Publicar só se `--comment` estiver nos argumentos. Use `gh` para tudo do GitHub, nunca `web_fetch`. Crie uma lista
com `todo` antes de começar.

Regras para todo subagente (repita-as em cada brief): as ferramentas funcionam, não faça chamadas de teste; só chame
ferramenta com propósito; somente leitura.

1. **Triagem.**
   - Você mesmo, antes de qualquer subagente: `gh pr view <PR> --json state,isDraft,url`. `state` diferente de `OPEN`
     ou `isDraft: true`: responda só "PR <n> não revisado: <fechado|mergeado|draft>." e **encerre o command aqui**,
     sem passar para o passo 2.
   - `Explore`: o PR não precisa de revisão (automático, trivial e obviamente certo) ou já tem revisão deste fluxo
     (`gh api repos/{owner}/{repo}/issues/<n>/comments --jq '.[].body'`, procurando "## Code review"; o
     `gh pr view --comments` pode falhar no GraphQL)? Se sim, diga qual e encerre. PR gerado por agente ainda é
     revisado.
2. **Arquivos de regras** (`Explore`): caminhos (não conteúdo) dos `AGENTS.md` e `CLAUDE.md` da raiz e dos diretórios
   que contêm arquivos modificados pelo PR (`gh pr diff <PR> --name-only`).
3. **Resumo** (`code-reviewer`): `gh pr view <PR>` e `gh pr diff <PR>`; devolve o resumo das mudanças, título,
   descrição e o SHA do head (`gh pr view <PR> --json headRefOid`).
4. **Revisão em paralelo**: um `subagent` com `tasks` de 4 `code-reviewer`, cada um com título, descrição e resumo do
   PR. Cada achado: descrição, `arquivo:linha` e motivo ("regra do AGENTS.md" citando a regra, ou "bug").
   - 1 e 2: aderência às regras; para cada arquivo, só valem os arquivos de regras do diretório dele e dos pais.
   - 3: bugs óbvios só no diff, sem ler contexto de fora; só os significativos.
   - 4: problemas no código introduzido (segurança, lógica errada), só dentro do código mudado.

   **Só alto sinal.** Marque: não compila ou não faz parse (sintaxe, tipo, import faltando, referência não
   resolvida); resultado errado com certeza, qualquer que seja a entrada; violação clara de regra que dá para citar.
   Não marque: estilo; problema que depende de entrada ou estado; sugestão subjetiva; problema pré-existente; o que
   parece bug mas está certo; picuinha; o que um linter pega (não rode linter); qualidade geral (falta de teste,
   segurança genérica) salvo se uma regra exigir; regra silenciada no código (comentário de lint-ignore). Na dúvida,
   não marque: falso positivo gasta a confiança e o tempo de quem revisa.
5. **Validação**: para cada achado dos agentes 3 e 4, e de regra dos agentes 1 e 2, um `code-reviewer` em paralelo,
   com o título e a descrição do PR e o achado, confirma com alta confiança que ele é real (a variável realmente não
   existe; a regra vale para esse arquivo e foi violada), lendo o código que precisar.
6. Fique só com os validados.
7. **Saída no terminal**: cada achado em uma linha com `arquivo:linha`; sem achados: "Nenhum problema encontrado.
   Verificados bugs e aderência a AGENTS.md/CLAUDE.md." Sem `--comment`, pare aqui.
8. Com `--comment` e sem achados: `gh pr comment <PR> --body` com:

   ```
   ## Code review

   Nenhum problema encontrado. Verificados bugs e aderência a AGENTS.md/CLAUDE.md.
   ```
9. Com `--comment` e achados: liste para você os comentários (um por problema único, nunca duplicado) e publique
   todos numa única review: escreva o JSON num arquivo (`mktemp`) e rode
   `gh api repos/{owner}/{repo}/pulls/<PR>/reviews --method POST --input <arquivo>` com
   `{"commit_id": "<SHA do head>", "event": "COMMENT", "body": "## Code review", "comments": [{"path": "...",
   "line": N, "side": "RIGHT", "body": "..."}]}` (faixa: acrescente `start_line` e `start_side`). Cada comentário:
   descrição breve; bloco ```suggestion só quando aplicá-lo resolve o problema por inteiro e a correção é pequena
   (até 5 linhas, um lugar); senão descreva a correção. Cite e linkte a regra ou o código no formato
   `https://github.com/<owner>/<repo>/blob/<SHA completo>/<arquivo>#L<início>-L<fim>`, com uma linha de contexto antes
   e depois (SHA literal, nunca `\$(git rev-parse HEAD)`). Mostre a URL da review publicada.
