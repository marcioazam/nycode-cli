---
name: insecure-defaults
description: "Audit a file, directory or repository for insecure default configuration (fallback secrets, default credentials, fail-open switches, weak crypto, permissive access, debug leakage): parallel category sweeps collect candidates, refuting verifiers trace each one to the security decision it reaches, and only survivors are reported with coverage gaps. Use for an insecure-defaults or configuration-hardening audit (/insecure-defaults-audit). Not for committed-secret scanning (gitleaks/trufflehog), a fixed lint pattern (semgrep) or a general security review (security-audit)."
disable-model-invocation: true
---

# Insecure defaults audit (pi)

Porte do plugin `insecure-defaults` 2.0.3 da Trail of Bits (CC-BY-SA-4.0, `LICENSE`). No Claude Code o comando
chamava a ferramenta `Workflow` com `workflows/audit.js`; o pi não tem essa ferramenta. Aqui a parte determinística do
script (guardas, dedup, lotes, cobertura) está em `scripts/pipeline.py` (testes em `scripts/tests/`) e os agentes rodam
pelo `subagent`. O corpus (`references/<categoria>.json` com seeds e `.md` com Report when / Skip when e exemplos) é o
do plugin, sem mudança.

Variáveis: `P=~/.pi/agent/claude-home/skills/insecure-defaults/scripts/pipeline.py`. Cada fase do `$P` imprime uma
linha JSON; **`status` diferente de `ok` encerra a auditoria**: vá direto ao passo 7 com esse status.

| Fase | Quem | Modelo (pi) | Faz |
|---|---|---|---|
| Recon | `swarm-worker` | Sonnet (pin) | classifica o escopo, perfila stack, acessores de config e manifestos de deploy |
| Discover | 6 × `swarm-worker`, em paralelo | Sonnet | uma varredura por categoria, seeds + padrões derivados da stack |
| Verify | N × `security-reviewer`, em paralelo | modelo da sessão | refuta por categoria, até 16 candidatos por agente |
| Report | `swarm-worker` | Sonnet | severidade, correção e cobertura em markdown |

## Passos

1. **Corpus e run.** `python3 $P init <escopo>` (escopo vazio = `.`; rode no diretório do projeto, porque os caminhos
   são relativos a ele). `corpus-unreadable`: pare e diga que o corpus está incompleto; não busque em outro lugar nem
   rode a auditoria assim mesmo. Guarde `run`.
2. **Recon.** `subagent` `{agent: "swarm-worker", task: "Unidade única: siga $run/prompts/recon.md (leia com read).
   Arquivo dono: $run/recon.json, o único que você escreve. Somente leitura no alvo."}` e depois `python3 $P sweeps
   $run`. `recon-failed` ou `scope-missing` encerram.
3. **Discover.** Uma chamada paralela `subagent` `{tasks: [...]}` com as 6 varreduras que `sweeps` listou, cada uma
   `{agent: "swarm-worker", task: "Unidade única: siga <prompt> (leia com read). Arquivo dono: <out>, o único que você
   escreve. Somente leitura no alvo."}` (o pi roda 4 por vez). Depois `python3 $P discover $run`.
   `corpus-unreadable`, `search-failed` e `no-candidates` encerram (`no-candidates` é resultado real: imprima o `note`,
   inclusive que não é prova de ausência). Repasse ao usuário as `notes` (categorias sem busca, varreduras só com seeds).
4. **Verify.** Para os lotes que `discover` listou, chamadas paralelas `subagent` `{tasks: [...]}` de no máximo 8
   tarefas, cada uma `{agent: "security-reviewer", task: "Siga <prompt> (leia com read) e termine com o bloco json
   pedido."}`. Para cada resposta, grave com `write` em `<verdict_out>` **só o conteúdo do último bloco ```json**, sem
   mudar nada (o `pipeline.py` também aceita a resposta inteira e extrai o último bloco). Lote sem resposta ou sem bloco:
   não invente vereditos; deixe o arquivo ausente. Depois `python3 $P verify $run`; `verify-failed` encerra.
5. **Report.** `subagent` `{agent: "swarm-worker", task: "Unidade única: siga $run/prompts/report.md (leia com read).
   Arquivo dono: $run/report.md."}`.
6. **Fim.** `python3 $P finish $run`.
7. **Imprima o resultado** pelo `status`:
   - `findings`, `no-findings-confirmed`: leia e imprima `report.md` na íntegra.
   - `no-candidates`: as varreduras rodaram e não casaram nada, um resultado real. Não há relatório; imprima o `note`,
     inclusive o ponto de que não é prova de ausência.
   - `report-failed`: a auditoria terminou, mas o relatório não foi escrito. Imprima o `note` e apresente você mesmo
     `findings`, `refuted` e `coverage` de `result.json`.
   - qualquer outro: a auditoria **não terminou**, então não é resultado limpo. Imprima o `note` e diga que a execução
     falhou, na fase em que parou.
   Diga sempre o caminho do run (os JSON intermediários ficam lá para revisão).

## Regras que o pipeline garante

- Uma varredura que não leu o corpus ou os seeds aborta tudo; 0 arquivos varridos é falha de busca, nunca "limpo".
- Dedup por `categoria:arquivo:linha`: a mesma linha em duas categorias vira dois candidatos, cada um julgado pelo seu
  corpus.
- Lotes por categoria, no máximo 16 candidatos, diretórios inteiros quando cabem, para nenhum verificador estourar
  turnos e devolver lista parcial.
- Veredito ausente vira `unadjudicated` no relatório; um veredito sem `refuted: false` explícito conta como refutado
  (o padrão do verificador é refutar).

## Quando não usar

- Segredos já commitados: gitleaks ou trufflehog.
- Padrão fixo sem pergunta de alcance: semgrep ou um linter.
- Revisão de segurança geral de um diff: skill `differential-review` ou `security-audit`.
