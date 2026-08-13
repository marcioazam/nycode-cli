# ADR-0017: O confinamento tem duas políticas, e quem invoca escolhe qual

- **Status:** aceito
- **Data:** 2026-08-13
- **Contexto relacionado:** [`spec.md`](../../../.specs/nycode-rs/spec.md) FR-7, FR-11, FR-16, NFR-4; [spec da feature](../../specs/001-fronteira-de-confianca/spec.md) FR-5 a FR-8

## Contexto

O [ADR-0005](0005-sandbox-de-so-por-processo-auxiliar.md) decidiu confinar o
processo filho com uma política única, `workspace-write`: leitura ampla, escrita
restrita à raiz e ao temporário, rede negada. E declarou, na seção de
consequências positivas, que "o buraco do `McpTool` que contorna `resolve` fecha
pela mesma via, já que servidores MCP também são processos filhos".

Não fecha. `sandbox::wrap` é chamado num único lugar do workspace, o
[`bash.rs`](../../../crates/nycode-agent/src/tools/bash.rs). O servidor MCP e o
hook sobem crus, e o comentário em
[`mcp/tool.rs`](../../../crates/nycode-agent/src/mcp/tool.rs) afirma que "o
isolamento aqui é o do sistema operacional" sobre um isolamento que não existe.
O ADR-0009 tem o mesmo problema em forma de restrição: hooks "rodam sob o mesmo
confinamento do ADR-0005", e não rodam.

Envolver os dois é mecanicamente trivial. O
[`session.rs`](../../../crates/nycode-mcp/src/session.rs) já passa um
`tokio::process::Command` para `TokioChildProcess::new`, então basta construir
esse `Command` a partir do `argv` confinado.

O que não é trivial é a política. Tentar aplicar `workspace-write` a um servidor
MCP revela que a consequência do ADR-0005 não estava só por implementar: ela é
inaplicável na forma escrita. `--unshare-net` nega rede, e um servidor MCP
existe para falar com uma API — busca em documentação, consulta a issue tracker,
pesquisa web. Confiná-lo com a política do shell não o protege: o inutiliza.

A assimetria é real e tem razão. O comando de shell precisa escrever no
workspace e não precisa de rede: um comando que baixa código sai do que o
usuário revisou. O servidor MCP precisa de rede e não precisa escrever no
workspace: ele responde perguntas, não edita arquivos. São dois perfis de risco
diferentes, e uma política só é errada para um dos dois necessariamente.

## Decisão

O confinamento passa a receber a política como parâmetro. Quem invoca escolhe;
o processo confinado não escolhe o próprio confinamento.

Duas políticas:

- **`workspace-write`** — a atual, sem mudança de forma. Leitura ampla, escrita
  na raiz e no temporário, rede negada. Aplicada ao comando de shell e ao hook.
- **`network-client`** — leitura ampla, porque o servidor precisa do próprio
  runtime e das bibliotecas dele; escrita apenas no temporário; rede permitida;
  raiz do workspace **não** gravável. Aplicada ao servidor MCP por stdio.

Quatro restrições:

- **O hook usa `workspace-write`**, que é o que o ADR-0009 já dizia. Um hook é
  política local — formatar antes de gravar, negar um comando — e não tem
  motivo para alcançar a rede.
- **Rede permitida não é consentimento.** O `network-client` deixa o servidor
  MCP alcançar a rede, e isso o torna canal de saída. O controle desse risco não
  é o sandbox, é o consentimento do
  [ADR-0016](0016-extensao-do-workspace-exige-consentimento.md): o usuário
  aprovou aquele servidor específico. As duas decisões compõem, e nenhuma das
  duas sozinha basta.
- **Uma política que permite por omissão não é relatada como equivalente a uma
  que nega.** Hoje `is_enforced()` devolve o mesmo para Linux e macOS, e os
  perfis não são equivalentes — o do macOS abre com `(allow default)`. O relato
  passa a distinguir, porque anunciar confinamento onde ele é frouxo é a mesma
  degradação silenciosa que o NFR-4 proíbe.
- **A degradação é igual nas duas.** Sem confinamento disponível, o processo
  ainda sobe e o aviso é obrigatório, pela mesma razão que o ADR-0005 já deu.

## Consequências

Positivas: a consequência que o ADR-0005 declarou passa a ser verdade, e o
`McpTool` deixa de ser o caminho que contorna toda contenção do harness; a
restrição que o ADR-0009 impôs a hooks passa a existir; o comentário de
`mcp/tool.rs` passa a descrever o que acontece; e a política vira valor, o que
torna as duas exercitáveis numa máquina só, do mesmo jeito que `Platform` já
resolveu para a detecção.

Negativas: duas políticas custam o dobro para manter e a matriz de teste por
plataforma dobra junto. Um servidor MCP que legitimamente serve o sistema de
arquivos do workspace — o caso do servidor de filesystem — para de funcionar sob
`network-client`, e a resposta certa é uma declaração explícita na configuração
daquele servidor, não afrouxar o padrão; enquanto essa declaração não existir, o
caso fica descoberto e é preciso dizer isso em voz alta em vez de descobrir em
campo. Confinar o servidor MCP acrescenta um `exec` ao caminho de startup de
cada servidor, que é onde o NFR-1 mede. E `network-client` permite rede a um
processo declarado pelo repositório, o que só é aceitável porque o ADR-0016 põe
o consentimento antes — se aquele ADR for revertido, este vira um buraco.

Descartadas: **aplicar `workspace-write` ao servidor MCP**, rejeitado porque
nega rede e a rede é a razão de existir da maioria dos servidores; o resultado
seria confinamento que ninguém usa, com o usuário desabilitando a proteção para
recuperar a função. **Não confinar o servidor MCP**, que é o estado atual,
rejeitado porque é exatamente o buraco que o ADR-0005 dizia ter fechado.
**Uma política só, parametrizada por flags soltas no ponto de chamada**,
rejeitado porque espalharia a decisão de segurança pelos chamadores: política é
decisão, e decisão fica num lugar com nome. **Perfil configurável pelo usuário
por arquivo**, rejeitado por enquanto porque configuração de sandbox mal escrita
é pior que sandbox nenhum, e ninguém pediu; reabrir quando alguém pedir com caso
de uso.

## Revisão

Reabrir quando o caso do servidor MCP de filesystem aparecer de fato, caso em
que a saída é uma terceira política ou uma declaração por servidor, e não
afrouxar o `network-client`. Reabrir se o `exec` adicional por servidor aparecer
na medição do NFR-1. E reabrir se o ADR-0016 for revisto: `network-client`
depende do consentimento existir antes dele, e sem essa dependência a política
precisa ser reavaliada inteira.
