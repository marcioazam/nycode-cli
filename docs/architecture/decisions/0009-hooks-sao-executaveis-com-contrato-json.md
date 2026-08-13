# ADR-0009: Hooks são executáveis com contrato JSON e podem vetar uma chamada

- **Status:** aceito
- **Data:** 2026-08-13
- **Contexto relacionado:** [`spec.md`](../../../.specs/nycode-rs/spec.md) FR-16, NFR-4

## Contexto

O [ADR-0002](0002-extensions-are-out-of-process.md) nomeou três mecanismos de
extensão: servidores MCP, hooks de ciclo de vida e arquivos de skill. Skills
está ligado, MCP ganha transporte no [ADR-0004](0004-cliente-mcp-usa-o-sdk-oficial-rmcp.md),
e hooks não existem em nenhuma forma — nem trait, nem descoberta, nem
configuração. O terceiro mecanismo é uma promessa não cumprida, e FR-7 esteve
declarado entregue apesar disso.

Falta a esta decisão apenas o contrato, porque a forma o ADR-0002 já fixou:
executável, JSON na entrada e na saída, fora do processo. O que precisa ser
decidido é quando um hook roda, o que ele pode fazer, e o que acontece quando
ele falha.

A pergunta difícil é a do veto. Um hook que só observa é um log com passos
extras. O valor está em poder barrar — rodar o formatador antes de aceitar uma
escrita, negar um `bash` que casa com um padrão proibido. Mas um hook que barra
é um hook que pode travar a sessão, e isso precisa de limites.

## Decisão

Hooks são executáveis descobertos em `.nycode/hooks/` e `.claude/hooks/`,
invocados em um evento:

- `pre-tool-use` — antes de uma chamada de ferramenta. **Pode vetar.**

`session-start`, `post-tool-use` e `session-end` foram desenhados nesta decisão e
adiados na emenda de 2026-08-13. Enquanto não forem disparados, não são
descobertos nem anunciados: um evento que o cabeçalho da sessão lista e que nunca
roda é pior que um evento ausente, porque quem o instalou para de procurar.

O contrato é um objeto JSON no `stdin` e um objeto JSON no `stdout`. Em
`pre-tool-use`, uma resposta `{"decision":"deny","reason":"..."}` transforma a
chamada numa negação, e a `reason` chega ao modelo pelo mesmo caminho que já
carrega a negação do gate de permissão — o modelo recebe um motivo corrigível em
vez de um erro opaco.

Cinco restrições:

- **O veto não escala privilégio.** Um hook nega; nenhum hook permite o que o
  gate de permissão negou. As duas decisões compõem por conjunção.
- **Timeout de 5 segundos por hook.** Estourar é falha do hook, não da sessão.
- **Falha é ruidosa e não é veto.** Saída não-zero, JSON inválido ou timeout
  produzem aviso em `stderr` e a chamada segue. Um hook quebrado que bloqueasse
  silenciosamente seria a degradação que o NFR-4 proíbe; um hook quebrado que
  travasse a sessão seria pior.
- **`stdout` do hook nunca vai para o `stdout` do `nycode`.** A regra de que
  `stdout` carrega só a resposta vale para o processo inteiro.
- **Hooks recebem a raiz do workspace no contrato JSON**, no campo `cwd`, e não
  no ambiente: o ambiente do harness não é repassado a processo de extensão.
- **Hooks rodam sob a política `workspace-write`** do
  [ADR-0005](0005-sandbox-de-so-por-processo-auxiliar.md), selecionada como
  descreve o [ADR-0017](0017-duas-politicas-de-confinamento.md). Um hook é
  política local e não tem motivo para alcançar a rede.
- **Um hook só é executado depois de consentimento registrado**, pelo
  [ADR-0016](0016-extensao-do-workspace-exige-consentimento.md).

## Consequências

Positivas: o terceiro mecanismo do ADR-0002 fecha; políticas de repositório —
formatar antes de gravar, negar comando perigoso, registrar auditoria — passam a
ser arquivos versionados em vez de convenção no `AGENTS.md`, que é contexto e
não configuração aplicada; e o contrato de veto reaproveita o caminho de negação
que já existe e já é testado.

Negativas: `pre-tool-use` roda a cada chamada de ferramenta que o hook declara
observar — um hook lento degrada a sessão inteira, e o timeout de 5s é teto, não
garantia. Ler `.claude/hooks/` significa executar código que outra ferramenta
instalou, o que é superfície de confiança nova; a decisão de confiança que este
parágrafo pedia foi construída no
[ADR-0016](0016-extensao-do-workspace-exige-consentimento.md). A escolha de
falhar aberto é deliberada e tem o custo óbvio: um hook de segurança que quebra
deixa de proteger, e por isso o aviso é obrigatório.

Descartadas: **hooks apenas observadores**, rejeitado porque o caso de uso que
justifica a feature é o veto. **Falhar fechado**, rejeitado porque um erro de
sintaxe num hook derrubaria a sessão inteira, e a assimetria de dano favorece
avisar. **Hooks como servidores MCP**, rejeitado porque um hook é síncrono, curto
e local, e o handshake de MCP a cada chamada de ferramenta custa mais que o
trabalho. **Hooks in-process em Lua ou Rhai**, rejeitado pelo ADR-0002.

## Revisão

Reabrir se o custo de `pre-tool-use` aparecer em medição de sessão real, caso em
que a saída é filtrar por nome de ferramenta na configuração antes de invocar o
processo. Reabrir a escolha de falhar aberto se aparecer caso de uso de
segurança que dependa do hook, o que exigiria um tipo de hook declaradamente
crítico, com falha fechada e o custo assumido.

Reabrir os três eventos adiados quando houver caso de uso concreto para eles. O
desenho está preservado acima; o que falta é a invocação.

## Emenda — 2026-08-13

Uma auditoria da fronteira de confiança encontrou quatro restrições desta
decisão sem correspondência no código. Duas subiram, duas desceram.

**Subiu: o confinamento.** O ADR dizia que hooks rodam sob o confinamento do
ADR-0005, e eles subiam crus — `sandbox::wrap` só era chamado pela ferramenta de
shell. Agora rodam sob `workspace-write`, com a política selecionada como o
[ADR-0017](0017-duas-politicas-de-confinamento.md) descreve.

**Subiu: a decisão de confiança.** A seção de consequências negativas dizia que
executar código instalado por outra ferramenta "precisa de decisão de confiança
do projeto antes da primeira execução". Ela foi construída no
[ADR-0016](0016-extensao-do-workspace-exige-consentimento.md).

**Subiu: a falha ruidosa.** O ADR dizia que saída não-zero produz aviso. O
código nunca inspecionava o código de saída do processo, então um hook que
falhava era ignorado em silêncio — que é exatamente o desfecho que a restrição
existia para impedir.

**Desceu: de quatro eventos para um.** Só `pre-tool-use` era disparado, e os
outros três eram descobertos e anunciados no cabeçalho da sessão. Anunciar um
controle que não roda é pior que não tê-lo, e implementá-los sem caso de uso
seria construir para um requisito que ninguém pediu.

**Corrigido: a raiz do workspace.** O ADR dizia que hooks a recebem "no
ambiente". Sempre chegou no campo `cwd` do contrato JSON, e o ambiente do
harness deixou de ser repassado — ele carregava as credenciais do usuário.
