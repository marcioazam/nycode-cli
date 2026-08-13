# ADR-0007: Subagentes existem e são in-process, divergindo da referência

- **Status:** aceito
- **Data:** 2026-08-13
- **Contexto relacionado:** [`spec.md`](../../../.specs/nycode-rs/spec.md) FR-15, NFR-6

## Contexto

O `pi` recusa subagentes por decisão explícita e documentada: a página do
projeto diz que ele "skips features like sub-agents and plan mode" e recomenda
tmux, extensões, ou um pacote de terceiros. Como o NFR-6 exige que qualquer
divergência observável da referência seja decisão registrada, incluir
subagentes obriga este ADR.

O argumento a favor é de contexto, não de paralelismo. Uma subtarefa consome `X`
tokens de instrução e acumula `Y` de trabalho para produzir `Z` de resposta;
executá-la no fio principal paga `X + Y + Z`, enquanto delegá-la paga `Z`. Numa
sessão longa isso é a diferença entre caber e não caber na janela. O
levantamento de 2026 mostra subagentes em Claude Code, Codex, Copilot CLI,
OpenCode, Grok Build e Kimi Code — deixou de ser diferencial e virou base.

Contra, há o que a Anthropic publicou sobre harnesses de longa duração: agentes
avaliando o próprio trabalho tendem a elogiá-lo, e separar quem faz de quem
julga é uma alavanca forte. Isso não é argumento contra subagentes; é argumento
a favor de que o subagente tenha contexto próprio de verdade, e não uma cópia do
contexto do pai.

A decisão de forma é entre processo separado, coerente com o
[ADR-0002](0002-extensions-are-out-of-process.md), e in-process.

## Decisão

Subagentes existem, como uma ferramenta nativa `task` que constrói um `Agent`
filho no mesmo processo.

Quatro restrições:

- **Contexto próprio de verdade.** O filho recebe o system prompt, a descrição
  da tarefa e o `ToolContext`. Não recebe o histórico do pai. Devolve apenas o
  texto final.
- **Sem recursão.** O filho não recebe a ferramenta `task`. Um subagente que
  gera subagentes transforma teto de tokens em árvore de custo sem fundo.
- **O teto de rodadas é do filho, não compartilhado.** `DEFAULT_TOOL_LIMIT` vale
  por agente, e o pai contabiliza a chamada como uma rodada sua.
- **O gate de permissão é herdado, nunca ampliado.** Um filho não pode escrever
  onde o pai não pode. Delegar não é escalar privilégio.

O ADR-0002 não é contrariado: ele fala de *extensões*, código de terceiros que
o usuário instala. Um subagente é o mesmo binário rodando o mesmo loop com outro
contexto, e não há fronteira de confiança entre pai e filho a defender.

## Consequências

Positivas: uma exploração de repositório deixa de encher o fio principal; o
custo por delegação é um `Agent::new` e não um processo; e o gate herdado torna
a delegação segura por construção em vez de por convenção.

Negativas: divergência declarada da referência, o que significa que o harness de
paridade vai acusar diferença em qualquer prompt que dispare `task` — a
supressão precisa ser explícita no harness, apontando para este ADR, e não um
caso especial silencioso. Um filho no mesmo processo compartilha o teto de
memória do NFR-2, e várias delegações simultâneas pressionam um orçamento de 30
MiB. Não há observabilidade do filho no `stdout`, que carrega só a resposta, de
modo que o progresso precisa ir para o observer, ou o usuário vê o harness
parado.

Descartadas: **subagente como processo separado**, alinhado ao ADR-0002 e com
isolamento de memória de graça, rejeitado porque `nycode` pagaria o próprio
startup de novo por delegação, e porque a credencial teria de ser repassada ou
resolvida outra vez no cofre. **Não ter subagentes, como o `pi`**, rejeitado
porque a economia de contexto não tem substituto dentro de uma sessão — tmux
resolve paralelismo humano, não janela de contexto. **Herdar o histórico do
pai**, rejeitado porque anula a única razão de existir da feature.

## Revisão

Reabrir se a pressão de memória com delegações concorrentes ameaçar NFR-2, caso
em que a saída é serializar as delegações antes de mudar de arquitetura.
Reabrir também se o `pi` passar a ter subagentes, momento em que a divergência
deixa de existir e o desenho deve convergir para o dele.
