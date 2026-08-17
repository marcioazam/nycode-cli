# ADR-0038: a proibição do agente é mecânica e portátil

- **Status:** aceito
- **Data:** 2026-08-17
- **Contexto relacionado:** [ADR-0037](0037-o-contrato-do-agente-tem-orcamento-de-bytes-e-de-linhas.md)

## Contexto

Proibição em prosa decai. Medição (arXiv 2604.20911, preprint): conformidade
a proibição cai de 73% no turno 5 para 33% no turno 16, enquanto obrigação
fica em 100%. A mitigação medida é re-injetar a restrição. O número exato
não está replicado de forma independente; a direção é corroborada por
LIFBENCH (ACL 2025). O desenho não depende da magnitude.

Cada ferramenta impõe de um jeito. O denominador comum dos hooks é
**exit 2 + stderr**. `permissions.deny` / `permission` / `.rules` são
adaptadores do mesmo registro, nunca uma segunda lista.

Cursor `stop`/`beforeShellExecution` é fail-open por default: sem
`failClosed: true` o hook que quebra deixa passar — o oposto da política
deste repositório. Cursor só re-injeta em `sessionStart`, mais fraco que
`UserPromptSubmit` de Claude/Codex.

## Decisão

1. Um registro só: [`scripts/agent-harness/forbidden.txt`](../../../scripts/agent-harness/forbidden.txt).
   Não se parseia prosa do `AGENTS.md`.
2. [`scripts/agent-harness/gen-adapters.sh`](../../../scripts/agent-harness/gen-adapters.sh)
   gera `.claude/settings.json` `permissions.deny`, `opencode.json`
   `permission` e `.codex/rules/nycode.rules`. `--check` no gate.
3. [`scripts/agent-harness/veto.sh`](../../../scripts/agent-harness/veto.sh)
   no PreToolUse / beforeShellExecution / beforeMCPExecution. Exit **2**,
   nunca 1. Cursor com `failClosed: true`.
4. [`scripts/agent-harness/remind.sh`](../../../scripts/agent-harness/remind.sh)
   em `UserPromptSubmit` (Claude, Codex) e `sessionStart` (Cursor). A
   assimetria do Cursor é declarada: não há paridade fingida.
5. Stop continua em [`scripts/agent-stop/verify.sh`](../../../scripts/agent-stop/verify.sh).

## Consequências

Positivas: `--no-verify`, force-push, edição de baseline e `curl | bash`
passam a ser recusa de ferramenta, não um parágrafo que o modelo esquece.

Negativas: o registro tem de ser o único lugar. Adaptador editado à mão
reprova o `--check`. Cursor re-injeta menos vezes.

Descartadas: fatiar `AGENTS.md` por crate; gerar adaptador parseando
português; versionar catálogo de skill de terceiro; `.mcp.json` nesta
onda (lista de servidor é de cada colaborador).

## Revisão

Reabrir se Claude, Codex ou Cursor unificarem o contrato de hook, ou se
`sessionStart` do Cursor ganhar equivalente a `UserPromptSubmit`. Ação
padrão: um script, três JSON, o registro intacto.
