# Regras do repositório: do ny-pi para o nycode

Estado: **plano, nada aplicado**. Leva as regras de repositório do `marcioazam/ny-pi` ao `marcioazam/nycode` (F2 e F3
do [mega plano](00-mega-plano.md)). Identificadores: F0 a F12, D-nn ([11](11-decisoes-e-pendencias.md)), K1 a K14
([02](02-arquitetura-alvo.md)), P-1 a P-8.

Base: [anexo D](anexos/D-regras-github-brutas.md) (2026-11-20), reconferido no mesmo dia com `gh api` somente leitura
(campos do repositório, Actions, relato privado, correções automáticas e o ruleset 27240802 do ny-pi conferem).
Arquivos do ny-pi lidos de `origin/main` (e4f8729); do nycode, no worktree (`fb05db936`). O que não foi possível
verificar vem marcado "não verificado".

## 1. Princípio: igual ou mais estrito

Toda regra do ny-pi vale no nycode com o mesmo valor ou mais estrito; nenhuma regra do nycode é relaxada para
igualar o ny-pi (`allow_rebase_merge` passa a `false` porque o ny-pi o desliga). Há **uma única exceção**,
[D-07](11-decisoes-e-pendencias.md): a sincronização com o upstream precisa de merge commit.

| Item | ny-pi | nycode alvo | Motivo |
|---|---|---|---|
| `required_linear_history` | presente | **removida** | Merge commit de `sync/upstream-*` quebra histórico linear |
| `allowed_merge_methods` | `["squash"]` | `["squash","merge"]` | Squash perde o ancestral comum com o upstream |
| `allow_merge_commit` (repo) | `false` | `true` | O ruleset só restringe métodos que o repo permite |

Compensação (D-07): sem exclusão de ramo, sem push forçado, PR obrigatório, conversas resolvidas, checks
obrigatórios com ramo atualizado, nenhum ator com dispensa e o job `merge-policy` de
[07](07-ci-qualidade-seguranca.md) (falha e abre issue se um merge commit em `main` não tiver o segundo pai
alcançável a partir de `upstream/main`). O merge commit da importação (F1) entra **antes** do ruleset.

## 2. Tabela mestra de regras

Legenda de "aplicar": `§4.n` = passo de comando da seção 4; `§5.n` = arquivo da seção 5; "—" = já igual, só conferir
(seção 7). "hoje" = valor lido no nycode em 2026-11-20. Tamanho: **60 regras** (R01 a R60); o item 5 dos critérios
globais do [mega plano](00-mega-plano.md) cita 30 linhas e deve ser corrigido para 60.

### 2.1 Configuração de merge, tópicos e descrição

| nº | regra | ny-pi | hoje | alvo | aplicar | fase |
|---|---|---|---|---|---|---|
| R01 | allow_squash_merge | true | true | true | — | F2 |
| R02 | allow_merge_commit | false | true | true (D-07) | §4.2 | F2 |
| R03 | allow_rebase_merge | false | true | false | §4.2 | F2 |
| R04 | allow_auto_merge | true | false | true | §4.2 | F2 |
| R05 | delete_branch_on_merge | true | false | true | §4.2 | F2 |
| R06 | allow_update_branch | true | false | true | §4.2 | F2 |
| R07 | squash_merge_commit_title | PR_TITLE | COMMIT_OR_PR_TITLE | PR_TITLE | §4.2 | F2 |
| R08 | squash_merge_commit_message | PR_BODY | COMMIT_MESSAGES | PR_BODY | §4.2 | F2 |
| R09 | has_issues, has_discussions, has_projects | true | true | true | — | F2 |
| R10 | has_wiki | false | false | false | — | F2 |
| R11 | web_commit_signoff_required | false | false | false | — | F2 |
| R12 | visibilidade e licença | pública, MIT | pública, MIT | igual | — | F2 |
| R13 | tópicos | 13 | nenhum | 14 (lista em §4.4) | §4.4 | F2 |
| R14 | descrição | 1 frase em inglês | texto de Rust, velho | §4.4, 2 etapas | §4.4 | F2, F12 |

### 2.2 Ruleset `main` (cada regra separada)

| nº | regra | ny-pi | hoje | alvo | aplicar | fase |
|---|---|---|---|---|---|---|
| R15 | ruleset `main`: ativo, `bypass_actors` vazio | sim (id 27240802) | nenhum | sim | §4.6 | F3 |
| R16 | `deletion` | sim | não | sim | §3, §4.6 | F3 |
| R17 | `non_fast_forward` | sim | não (clássica: sem force push) | sim | §3, §4.6 | F3 |
| R18 | `required_linear_history` | sim | não | **não** (D-07) | §3 | F3 |
| R19 | PR: 0 aprovações, dismiss_stale true, code owner false | sim | sem PR obrigatório | igual | §3, §4.6 | F3 |
| R20 | `required_review_thread_resolution` | true | false | true | §3, §4.6 | F3 |
| R21 | `require_extra_approval_for_unattributed_changes` | true | n/d | true | §3, §4.6 | F3 |
| R22 | `allowed_merge_methods` | squash | n/d | squash, merge (D-07) | §3, §4.6 | F3 |
| R23 | status checks: strict true, do_not_enforce_on_create false | sim | strict true | igual | §3, §4.6 | F3 |
| R24 | contextos obrigatórios | 4 | 6 | 10 (D-05) | §3, §4.6 | F3 |
| R25 | proteção clássica de `main` | 404 (não existe) | existe, 6 contextos | removida | §4.7 | F3 |

### 2.3 Actions, segurança, rótulos e comunidade

| nº | regra | ny-pi | hoje | alvo | aplicar | fase |
|---|---|---|---|---|---|---|
| R26 | Actions: enabled, allowed_actions, sha_pinning_required | true, all, false | igual | igual | — | F3 |
| R27 | workflow padrão `read`; Actions não aprovam PR | read, false | igual | igual | — | F3 |
| R28 | alertas do Dependabot | ativo | ativo | ativo | — | F2 |
| R29 | correções automáticas de segurança | enabled | enabled | enabled | — | F2 |
| R30 | secret scanning e push protection | enabled | enabled | enabled | — | F2 |
| R31 | non_provider_patterns e validity_checks | disabled | disabled | disabled | — | F2 |
| R32 | alertas de secret scanning abertos | 0 | 8 | 0 (D-16) | §4.5 | F0 |
| R33 | relato privado de vulnerabilidade | ativo | ativo | ativo | — | F2 |
| R34 | CodeQL | workflow próprio | default setup, `rust` | workflow (D-20) | §4.5, §5.9 | F3 |
| R35 | Scorecard | workflow semanal | ausente | workflow semanal | §5.9 | F3 |
| R36 | rótulos exclusivos do ny-pi | 14 | 0 | 14 | §4.3 | F2 |
| R37 | rótulo `rust` | não existe | existe | removido | §4.3 | F0 |
| R38 | descrição de `dependencies` e `github_actions` | do ny-pi | padrão GitHub | do ny-pi | §4.3 | F2 |
| R39 | perfil de comunidade | 100% | 71% | 100% | R54, R43 | F2 |

### 2.4 Arquivos versionados (anexo D, seção 7)

| nº | arquivo | ny-pi | hoje | alvo | aplicar | fase |
|---|---|---|---|---|---|---|
| R40 | `.github/CODEOWNERS` | sim | não | sim | §5.1 | F2 |
| R41 | `.github/dependabot.yml` | `/` e `/npm` | não | `/` e `/` (monorepo) | §5.2 | F2 |
| R42 | `.github/rulesets/main.json` | sim | não | JSON da seção 3 | §3 | F2 |
| R43 | `.github/PULL_REQUEST_TEMPLATE.md` | sim | não | adaptado | §5.4 | F2 |
| R44 | `.github/ISSUE_TEMPLATE/` | 3 arquivos | 4 arquivos | 3 arquivos | §5.3 | F2 |
| R45 | `.github/DISCUSSION_TEMPLATE/` | 2 arquivos | não | 2 arquivos | §5.4 | F2 |
| R46 | `.github/release.yml` | sim | não | sim | §5.5 | F2 |
| R47 | `.github/zizmor.yml` | sim | não | sim | §5.6 | F2 |
| R48 | `.github/APPROVED_CONTRIBUTORS` | não | sim (278) | removido (D-18) | §5.7 | F2 |
| R49 | `.github/workflows/` | 5 | 2 | união (ver 07) | [07](07-ci-qualidade-seguranca.md) | F3 |
| R50 | gancho de commit | `.githooks/` | `.husky/` | `.husky/` + vazamento | §5.8 | F2 |
| R51 | `.pre-commit-config.yaml` | sim | não | opção do contribuidor | §5.8 | F2 |
| R52 | vazamento: `.gitleaks.toml`, `.leak-allow`, `.gitleaksignore` | 2 | 1 | 3 fundidos | §5.10 | F2 |
| R53 | `.editorconfig` | 2 espaços | não | tabulação no TS | §5.11 | F2 |
| R54 | `CODE_OF_CONDUCT.md`, `SUPPORT.md` | sim | não | sim | §5.13 | F2 |
| R55 | `.gitattributes` | LF, binários | LF, bat, ps1, binários | fundido | §5.12 | F2 |
| R56 | `SECURITY.md` | do harness | do upstream | fundido | §5.14 | F2 |
| R57 | `CONTRIBUTING.md` | técnico | portão lgtm | reconciliado | §6 | F2 |
| R58 | `LICENSE` e `NOTICE` | MIT, 7 componentes | MIT, 1 origem | atribuições | §5.15 | F2 |
| R59 | `AGENTS.md` | não tem | 155 linhas | reconciliado | §6 | F2 |
| R60 | `CHANGELOG.md` | raiz | por pacote | por pacote (D-19) | §5.16 | F2 |

Notas por regra:

- R13: os 13 tópicos do ny-pi mais `nycode` (limite de 20 do GitHub não reverificado); `pi-coding-agent` fica.
- R21: o JSON versionado no ny-pi **não** traz `require_extra_approval_for_unattributed_changes` nem
  `required_reviewers`, mas a API os devolve no ruleset ativo (comparação com `jq -S`, 2026-11-20). O JSON alvo
  traz os dois para o `diff` de conferência fechar. Aceitação dos dois no POST: não verificado.
- R24: `docs/fork` cita `audit` como obrigatório, mas a proteção clássica lida **não** o contém (6 contextos); vale a
  API. Os 10 contextos são os de D-05.
- R25: a clássica e o ruleset **se somam** no mesmo ramo (vale a exigência mais restritiva de cada ponto; comportamento
  do GitHub, não reverificado). Por isso a clássica só sai com o ruleset ativo e provado (seção 4.7); deixá-la
  depois disso apenas duplicaria os 6 contextos antigos.
- R32: 8 alertas abertos (credenciais OAuth de cliente do upstream e um `plan.md` histórico); fechar exige
  autorização do dono (D-16, "aguarda o dono").
- R34: o "default setup" está `configured` com `actions` e `rust`.

## 3. JSON alvo do ruleset (`.github/rulesets/main.json`)

Derivado do ruleset ativo do ny-pi (anexo D, seção 2) com D-07 (sem `required_linear_history`; `allowed_merge_methods`
com `squash` e `merge`) e D-05 (10 checks). Versionado em F2 **sem aplicar**; aplicado em F3 pelo passo 4.6.

```json
{
  "name": "main",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [],
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "pull_request", "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": true,
        "required_reviewers": [],
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": true,
        "require_extra_approval_for_unattributed_changes": true,
        "allowed_merge_methods": ["squash", "merge"] } },
    { "type": "required_status_checks", "parameters": {
        "strict_required_status_checks_policy": true,
        "do_not_enforce_on_create": false,
        "required_status_checks": [
          { "context": "build-check" },
          { "context": "test (coding-agent)" },
          { "context": "test (durable)" },
          { "context": "test (chord)" },
          { "context": "test (other)" },
          { "context": "mcp-conformance" },
          { "context": "ci-static" },
          { "context": "ci-security" },
          { "context": "instruction-budget" } ] } }
  ]
}
```

Contra o JSON do ny-pi mudam só: `required_linear_history` some e `allowed_merge_methods` vira `["squash","merge"]`
(D-07); os contextos vão de 4 para 10 (D-05).

> **D-29 (2026-11-20).** O ruleset entra em F3 com 9 contextos: `bench-pr` fica fora até o dono liberar as rodadas de
> benchmark. Ao liberar, um PR acrescenta `{ "context": "bench-pr" }` a este bloco e ao `.github/rulesets/main.json`, e o
> ruleset aplicado é atualizado por `PUT` com o mesmo arquivo. Onde este documento diz "10 contextos", leia 9 até lá.

- `bypass_actors: []` significa que nem o dono contorna o ruleset: um ruleset errado trava todo merge, inclusive o que
  o corrigiria. Por isso o passo 4.6 só roda com os 10 checks reportando e a clássica continua até o ruleset ser
  provado; a saída é o `DELETE` do ruleset, que o dono também pode fazer pela interface.
- `bench-pr` é um status de commit do verificador local, não um workflow (anexo A, seção 6); PR não funcional: D-21.

## 4. Comandos, em ordem segura de aplicação

Todo `POST`, `PATCH`, `PUT` e `DELETE` abaixo
**escreve no GitHub** e só roda com a autorização da tarefa de F2 ou F3. Onde a decisão está "aguarda o dono"
([11](11-decisoes-e-pendencias.md): D-15, D-16, D-17, D-22) o comando traz "**exige autorização do dono**".
**Nenhum comando desta seção foi executado**; só os `GET` da introdução rodaram.

Ordem: 4.0 registrar o estado; 4.1 arquivos por PR; 4.2 `PATCH` do repo; 4.3 rótulos; 4.4 tópicos e descrição;
4.5 segurança; 4.6 `POST` do ruleset (só com os 10 checks reportando); 4.7 `DELETE` da proteção clássica.

### 4.0 Registrar o estado antes (leitura)

```bash
E=docs/migration/ny-pi-core/evidencias; mkdir -p $E; R=marcioazam/nycode
gh api repos/$R > $E/F2-repo-antes.json; gh api repos/$R/branches/main/protection > $E/F3-classica-antes.json
```

### 4.1 Arquivos de regra por PR (F2)

Um PR de governança com os arquivos da seção 5 (R40 a R48, R50 a R60), incluindo `.github/rulesets/main.json` da
seção 3 **sem aplicá-lo**. Merge por squash (a clássica exige os 6 checks atuais). F1 já está mesclada. Conferência:
seção 7. Reversão: `git revert` em novo PR.

### 4.2 `PATCH` do repositório (R02 a R08)

Só depois de F1 mesclada: F1 usa merge commit e `allow_merge_commit` fica `true` (D-07).

```bash
gh api -X PATCH repos/marcioazam/nycode \
  -F allow_squash_merge=true -F allow_merge_commit=true -F allow_rebase_merge=false \
  -F allow_auto_merge=true -F delete_branch_on_merge=true -F allow_update_branch=true \
  -f squash_merge_commit_title=PR_TITLE -f squash_merge_commit_message=PR_BODY
# conferência (esperado: true true false true true true PR_TITLE PR_BODY)
gh api repos/marcioazam/nycode --jq '[.allow_squash_merge,.allow_merge_commit,.allow_rebase_merge,
  .allow_auto_merge,.delete_branch_on_merge,.allow_update_branch,
  .squash_merge_commit_title,.squash_merge_commit_message]|join(" ")'
# reversão (valores de 2026-11-20, anexo D, seção 1)
gh api -X PATCH repos/marcioazam/nycode -F allow_rebase_merge=true -F allow_auto_merge=false \
  -F delete_branch_on_merge=false -F allow_update_branch=false \
  -f squash_merge_commit_title=COMMIT_OR_PR_TITLE -f squash_merge_commit_message=COMMIT_MESSAGES
```

### 4.3 Rótulos (R36 a R38; R37 em F0)

Cores e descrições lidas do ny-pi em 2026-11-20 (`gh api 'repos/marcioazam/ny-pi/labels?per_page=100'`). São 14
(5 `area:`, 4 `P`, 5 `type:`); os 12 rótulos em comum têm a mesma cor.

| Nome | Cor | Descrição |
|---|---|---|
| `area: bench` | `c5def5` | Benchmark runner, suites, gate |
| `area: ci` | `c5def5` | Workflows and local CI |
| `area: claude-home` | `c5def5` | Contract, rules, skills, agents, hooks |
| `area: extensions` | `c5def5` | pi extensions under extensions/ |
| `area: installer` | `c5def5` | install.sh, wrapper, publish list |
| `P0` | `b60205` | Broken for everyone; fix now |
| `P1` | `d93f0b` | Important; next in line |
| `P2` | `fbca04` | Normal priority |
| `P3` | `0e8a16` | Nice to have |
| `type: benchmark` | `5319e7` | Benchmark suites, gate or results |
| `type: bug` | `d73a4a` | Something does not work as documented |
| `type: docs` | `0075ca` | Documentation only |
| `type: feature` | `a2eeef` | New behaviour or capability |
| `type: security` | `b60205` | Security issue or hardening |

As descrições de `area:` citam `extensions/`, `install.sh` e `claude-home`, que deixam de existir
([02](02-arquitetura-alvo.md), seção 8). Proposta: criar com o texto do ny-pi (paridade) e reescrever em F12.

```bash
# criação: o loop lê nome, cor e descrição do ny-pi
gh api 'repos/marcioazam/ny-pi/labels?per_page=100' \
  --jq '.[] | select(.name | test("^(area: |P[0-3]$|type: )")) | [.name,.color,.description] | @tsv' |
while IFS=$'\t' read -r name color desc; do
  gh api -X POST repos/marcioazam/nycode/labels -f name="$name" -f color="$color" -f description="$desc" --silent
done
# R38: só estas 2 descrições diferem entre os rótulos comuns
gh api -X PATCH repos/marcioazam/nycode/labels/dependencies -f description='Dependency updates (Dependabot)'
gh api -X PATCH repos/marcioazam/nycode/labels/github_actions -f description='GitHub Actions updates (Dependabot)'
# R37 (F0, item 4 do plano; nenhuma D-nn pendente): apagar o rótulo o tira de todos os PRs e issues que o usam
gh api -X DELETE repos/marcioazam/nycode/labels/rust
```

Conferência: `gh api 'repos/marcioazam/nycode/labels?per_page=100' --jq length` devolve `26` (12 comuns + 14 novos,
sem `rust`). Reversão: `DELETE repos/marcioazam/nycode/labels/<nome codificado>` para cada novo; para `rust`, `POST`
com `-f name=rust -f color=000000 -f description='Pull requests that update rust code'`.

### 4.4 Tópicos e descrição (R13, R14)

```bash
gh api -X PUT repos/marcioazam/nycode/topics \
  -f 'names[]=agent-evaluation' -f 'names[]=ai-agents' -f 'names[]=ai-harness' -f 'names[]=benchmark' \
  -f 'names[]=claude' -f 'names[]=cli' -f 'names[]=coding-agent' -f 'names[]=developer-tools' \
  -f 'names[]=llm' -f 'names[]=nycode' -f 'names[]=pi-coding-agent' -f 'names[]=prompt-caching' \
  -f 'names[]=python' -f 'names[]=typescript'
gh api -X PATCH repos/marcioazam/nycode \
  -f description='Terminal coding agent, a fork of pi (earendil-works/pi); the ny-pi harness is being merged in.'
```

A descrição tem duas etapas, pela regra de honestidade: a de F2 acima e, em F12 (depois da paridade de F10),
`Terminal coding agent: a fork of pi with the ny-pi harness built in, measured against Claude Code and plain pi.`
Conferência: seção 7. Reversão: `echo '{"names":[]}' | gh api -X PUT repos/marcioazam/nycode/topics --input -` e
`PATCH` com a descrição antiga (em `evidencias/F2-repo-antes.json`).

### 4.5 Segurança (R28 a R35)

R28 a R31 e R33 já são iguais: só conferir (seção 7).

**CodeQL (R34, D-20).** Desligar o "default setup" **antes** de mesclar o PR de F3 com `codeql.yml`: duas
configurações na mesma linguagem conflitam no upload (comportamento do GitHub, não reverificado).

```bash
gh api -X PATCH repos/marcioazam/nycode/code-scanning/default-setup -f state=not-configured
gh api repos/marcioazam/nycode/code-scanning/default-setup --jq .state     # esperado: not-configured
```

Reversão: `PATCH` com `-f state=configured -f 'languages[]=actions'` (linguagens aceitas hoje: não verificado).
**Scorecard (R35)** é só o arquivo `scorecard.yml` (5.9).

**Alertas de secret scanning (R32, D-16): exige autorização do dono.** Fechar como credencial pública de cliente OAuth
do upstream (opção recomendada de D-16):

```bash
gh api 'repos/marcioazam/nycode/secret-scanning/alerts?state=open' --jq '.[]|[.number,.secret_type]|@tsv'
# exige autorização do dono (D-16, aguarda o dono); um comando por alerta listado acima
gh api -X PATCH repos/marcioazam/nycode/secret-scanning/alerts/<numero> -f state=resolved \
  -f resolution=wont_fix -f resolution_comment='Public OAuth installed-app client credential from upstream pi.'
```

O alerta do `plan.md` segue outro caminho (D-16); reescrever histórico **não** é proposto. Reversão: `PATCH` com
`-f state=open`. Conferência: a listagem `state=open` devolve 0.

### 4.6 `POST` do ruleset (R15 a R24), só com os 10 checks reportando

Pré-condição, verificada num PR de teste contra `main` (a clássica ainda vale):

```bash
PR=<numero do PR de teste>
SHA=$(gh pr view "$PR" --repo marcioazam/nycode --json headRefOid --jq .headRefOid)
{ gh api "repos/marcioazam/nycode/commits/$SHA/check-runs?per_page=100" \
    --jq '.check_runs[]|select(.conclusion=="success").name'
  gh api "repos/marcioazam/nycode/commits/$SHA/status" --jq '.statuses[]|select(.state=="success").context'
} | sort -u > /tmp/reportados.txt
printf '%s\n' build-check 'test (coding-agent)' 'test (durable)' 'test (chord)' 'test (other)' \
  mcp-conformance ci-static ci-security instruction-budget bench-pr | sort -u | comm -13 /tmp/reportados.txt -
```

A saída do `comm` tem de ser **vazia** (nenhum contexto exigido sem relato). Só então:

```bash
gh api -X POST repos/marcioazam/nycode/rulesets --input .github/rulesets/main.json
ID=$(gh api repos/marcioazam/nycode/rulesets --jq '.[]|select(.name=="main").id')
diff <(gh api repos/marcioazam/nycode/rulesets/$ID | jq -S '{name,target,enforcement,bypass_actors,conditions,rules}') \
     <(jq -S . .github/rulesets/main.json) && echo IGUAL        # conferência: diff vazio
```

Depois, abrir um segundo PR e conferir que o merge exige os 10 contextos e que `bench-pr` bloqueia. Reversão
(D-05 e D-07 adotadas): `gh api -X DELETE repos/marcioazam/nycode/rulesets/$ID`.

### 4.7 `DELETE` da proteção clássica (R25), só depois do ruleset ativo

Pré-condição: `IGUAL` em 4.6 e o segundo PR bloqueado. Backup em `evidencias/F3-classica-antes.json` (4.0).

```bash
gh api -X DELETE repos/marcioazam/nycode/branches/main/protection
gh api repos/marcioazam/nycode/branches/main/protection -i | head -1       # conferência: HTTP/2.0 404
# reversão (valores do anexo D, seção 3)
cat > /tmp/classica.json <<'JSON'
{ "required_status_checks": { "strict": true, "contexts": ["build-check","test (coding-agent)",
    "test (durable)","test (chord)","test (other)","mcp-conformance"] },
  "enforce_admins": false, "required_pull_request_reviews": null, "restrictions": null }
JSON
gh api -X PUT repos/marcioazam/nycode/branches/main/protection --input /tmp/classica.json
```

## 5. Reconciliação dos arquivos versionados

Caminhos do ny-pi são de `origin/main` (e4f8729); os do nycode, do worktree (`fb05db936`).

### 5.1 `CODEOWNERS` (R40)

Só o ny-pi tem (`* @marcioazam`); vem igual. Com `require_code_owner_review: false` (R19) só pede revisão. A exceção
`.github/CODEOWNERS:^\* @` do `.leak-allow` migra junto (5.10).

### 5.2 `dependabot.yml` (R41)

ny-pi: `github-actions` em `/` e `npm` em `/npm` (some, [02](02-arquitetura-alvo.md), seção 8), semanal, espera de
7 dias, um grupo por ecossistema. Destino: `package.json:4-11` declara os workspaces `packages/*`, `apps/*`, o
tutorial do chord e três exemplos do `coding-agent`; há um `package-lock.json` raiz e quatro outros
(`packages/coding-agent/install-lock/`, gerado do raiz por `scripts/generate-coding-agent-install-lock.mjs`
(`AGENTS.md:67`), e um por exemplo); o `.npmrc` tem `save-exact=true` e `min-release-age=2`. Alvo (proposta; o
comportamento do Dependabot com workspaces a partir da raiz não foi verificado):

```yaml
version: 2
updates:
  - package-ecosystem: github-actions
    directory: /
    schedule: { interval: weekly }
    cooldown: { default-days: 7 }
    groups: { github-actions: { patterns: ["*"] } }
  - package-ecosystem: npm
    directory: /
    schedule: { interval: weekly }
    cooldown: { default-days: 7 }
    groups: { npm: { patterns: ["*"] } }
```

Decisões: o `install-lock/` **fica fora** (gerado; edição do Dependabot faria `check:install-lock:coding-agent`
falhar); exemplos com lock próprio ficam fora; `cargo` em `packages/env/daemon` fica fora (origem dos
`dependabot/cargo/*` de D-15; incluir é decisão nova); a espera de 7 dias soma-se ao `min-release-age=2`. Um grupo
`npm` com `*` reúne versões maiores, como no ny-pi.

### 5.3 Modelos de issue (R44)

Os 3 do ny-pi contra os 4 do fork. Resultado: **3 arquivos**, `bug.yml`, `feature_request.yml`, `config.yml`.

- `bug.yml` (fork, `labels: ["bug"]`) **fica**, fundido com `bug_report.yml` do ny-pi (`type: bug`), que não migra:
  campos do ny-pi (o que aconteceu, esperado, passos, área, impacto, versão, plataforma), rótulo `type: bug`, o
  aviso de segurança do ny-pi e a frase do fork "valide com `nycode -ne`" (`-ne` é `--no-extensions`,
  `args.ts:189`; desliga também as extensões embutidas, `args.ts:327`, então separa core de harness). Edições: "Área"
  vira `Core`, `Extensões embutidas`, `Recursos embarcados`, `Benchmark`, `Distribuição`, `CI`, `Outra`; a versão vira
  a saída de `nycode --version`; saem o texto de auto-fechamento e os links `marcioazam/nycode-cli/blob/main/...`
  (o remoto é `marcioazam/nycode`; se a URL antiga redireciona: não verificado).
- `feature_request.yml` (ny-pi) **vem**, com o campo "Effect on cost and the benchmark".
- `contribution.yml` (fork) **sai**: existe para o portão `lgtm` (D-18). `package-report.yml` (fork) **sai**: denuncia
  pacote listado em `pi.dev`, que o nycode não opera.
- `config.yml`: **fica o do ny-pi**, URLs de `marcioazam/nycode`; some o Discord. Idioma: inglês (D-04).

### 5.4 Modelos de PR (R43) e de discussion (R45)

- `PULL_REQUEST_TEMPLATE.md` (ny-pi) vem, sem o item "New files are in `publish.list`" (`publish.list` some) e com
  `scripts/ci/local.sh` condicionado a F3; acrescenta `npm run check` e `./test.sh` (`CONTRIBUTING.md:60-67` do
  nycode). Mantém "Effect on the benchmark" e "How to revert". Sem ele o perfil de comunidade fica em 71%.
- `DISCUSSION_TEMPLATE/ideas.yml` e `q-a.yml` vêm; "ny-pi commit and pi version" vira `nycode --version`.

### 5.5 `release.yml` (R46), 5.6 `zizmor.yml` (R47)

`release.yml` vem sem mudança: categorias por rótulo `type: security|feature|bug|benchmark|docs` e Other; depende
dos rótulos de 4.3. O nycode gera notas por `scripts/release-notes.mjs`; se o GitHub as gera: não verificado.
`zizmor.yml` vem sem
mudança (`unpinned-uses: "*": hash-pin`, zizmor 1.32.0, `--min-severity medium` em `scripts/ci/run-security.sh`,
[07](07-ci-qualidade-seguranca.md)); o fork já fixa actions por SHA.

### 5.7 `APPROVED_CONTRIBUTORS` (R48, D-18)

**Remover.** 278 handles do upstream (275 `pr`, 3 `issue`, contados no arquivo). O workflow que o lia saiu do fork
(`docs/fork`: `approve-contributor`, `pr-gate`); o arquivo está inerte. Antes de apagar, `rg -n
APPROVED_CONTRIBUTORS` para achar referências (não executado). Por PR (4.1); reversão por `git revert`.

### 5.8 Ganchos (R50, R51)

- `.husky/pre-commit` (fork: lockfile, `npm run check`, `apps/p2`, browser smoke, restage): **fica**.
- `.githooks/pre-commit` (ny-pi: caminhos fora de `publish.list`, depois `check-leaks.sh --staged`): **some**; só a
  parte de vazamento migra. A regra de caminhos acaba com `publish.list` (o pacote passa a ser o campo `files` e
  `check:package-install`).
- `.pre-commit-config.yaml` (ny-pi: ruff, shellcheck, shfmt, actionlint, gitleaks por SHA): **fica como opção** do
  contribuidor, com o cabeçalho corrigido (cita `.githooks/pre-commit`).

Alvo: o `.husky/pre-commit` chama o verificador logo após o lockfile e antes de `npm run check` (falha barata primeiro):

```sh
bash scripts/check-leaks.sh --staged $STAGED_FILES || { echo "Leak scan failed."; exit 1; }
```

`$STAGED_FILES` sem aspas quebra nomes com espaço (o gancho do fork é `sh`; o do ny-pi usa array em bash);
`git diff --cached --name-only --diff-filter=ACMR -z | xargs -0` é proposta não testada. `check-leaks.sh` chega em F3
com `scripts/ci/`; até lá o gancho não o chama. O comentário "apps/ existe só em nycode-private" está desatualizado.
`prepare: husky` não roda sob `--ignore-scripts` (`AGENTS.md:65`): o gancho só fica ativo com `npx husky` (não
verificado, husky 9.1.7); documentar no `CONTRIBUTING.md`.

### 5.9 Workflows (R34, R35, R49)

Cinco do ny-pi (`ci-static`, `ci-security`, `instruction-budget`, `codeql`, `scorecard`) e dois do nycode (`ci`,
`npm-audit`): ver [07](07-ci-qualidade-seguranca.md). Aqui: `codeql.yml` com `javascript-typescript`, `python`,
`actions` (D-20); `scorecard.yml` semanal; actions por SHA completo.

### 5.10 Vazamento (R52)

- `.gitleaks.toml` (só ny-pi): regras padrão e 2 listas de permissão (chave AWS falsa de um teste de `atualizador`;
  fixtures em `scripts/fixtures/leak/`). **Vem**, título `nycode`; a primeira lista some quando o teste sair (F8).
- `.leak-allow` (só ny-pi, 4 entradas `caminho:regex`): **vem** sem mudança.
- `.gitleaksignore` (só nycode, 23 linhas por fingerprint `commit:arquivo:regra:linha`): **fica** sem mudança.

Os mecanismos se complementam: o ignore silencia histórico por fingerprint; o toml e o `.leak-allow` valem para o
`check-leaks.sh`. Em F1 o histórico do ny-pi **entra no do nycode**: rodar `gitleaks git` depois do merge e
fingerprintar só falsos positivos, um a um, nunca por glob. `PI_HARNESS_IDENTIFIERS` e
`~/.config/pi-harness/identifiers` (do `check-leaks.sh`) são resíduo de nome: renomear em F3 é proposta.

### 5.11 `.editorconfig` (R53)

O ny-pi manda 2 espaços (4 em py). O fork formata TypeScript pelo Biome: `biome.json` tem `indentStyle: tab`,
`indentWidth: 3`, `lineWidth: 120`, e `package.json`, `tsconfig.json`, `packages/ai/package.json` e `vitest.base.ts`
usam só tabulação. Copiar o do ny-pi faria o editor pôr espaços e o `npm run check` (Biome `--write`) desfazer. Os
`.sh` do fork misturam (`test.sh` com tabulação, `scripts/build-binaries.sh` com 2 espaços); `.yml` e `.nix` usam
espaços. Alvo (proposta):

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true

# Igual ao biome.json do fork (D-06)
[*.{ts,tsx,js,mjs,cjs,json,jsonc}]
indent_style = tab
indent_size = 3
tab_width = 3

[package-lock.json]
indent_style = space
indent_size = 2

[*.py]
indent_size = 4

[*.md]
trim_trailing_whitespace = false
```

O `scripts/ci/biome.json` do ny-pi (2 espaços, aspas simples) **não** migra ([02](02-arquitetura-alvo.md), seção 9);
TypeScript importado é reformatado no terceiro commit de cada extensão. Não verificado: se algum dos 389 `.json`
rastreados usa espaços (amostrei 3).

### 5.12 `.gitattributes` (R55)

Os dois têm `* text=auto eol=lf`. ny-pi: 12 extensões binárias. nycode: 11 binárias, CRLF para `*.bat`, `*.cmd`,
`*.ps1`, LF para `*.sh` e `-whitespace` em `packages/agent/docs/**/*.diff`. A única diferença de binários é `tgz`
(só no ny-pi). Alvo: o do nycode **mais** `*.tgz binary`. `*.svg` não é binário em nenhum, o que mantém o diff do logo
([05](05-marca-e-readme.md)) legível.

### 5.13 `CODE_OF_CONDUCT.md` e `SUPPORT.md` (R54)

Vêm do ny-pi. `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1): "ny-pi" vira "nycode"; a denúncia é o relato privado do
GitHub (R33), sem e-mail de terceiros. `SUPPORT.md`: sai da seção "Not supported" o que deixa de existir
(pi e pi-code fixados; sobreposição em `~/.pi/agent`, D-09); "outro ramo que `main`" vira "versões anteriores à
última". Com o modelo de PR (5.4) o perfil deve chegar a 100% (R39): não verificado.

### 5.14 `SECURITY.md` (R56)

Fusão, ponto a ponto (o arquivo é em inglês, D-04):

1. **Modelo de confiança**: fica o do fork (agente local no limite do usuário; injeção de prompt fora de escopo) e
   acrescenta-se o "Threat model" do ny-pi atualizado: bypass desligado por padrão (K3, K4) e lista de negação do
   motor de permissão que vale sob bypass (D-08).
2. **Como relatar**: só o advisory do GitHub de `marcioazam/nycode`. O e-mail `security@earendil.com` do fork é do
   mantenedor do pi: com ele, uma vulnerabilidade do nycode iria ao dono errado.
3. **Escopo**: pacotes e CLI; extensões embutidas e recursos embarcados; motor de permissão e flags de bypass;
   instalador (F11); workflows. **Sai** a "infraestrutura da Earendil em `pi.dev`" (relatar ao upstream).
4. **Fora de escopo**: junta as duas listas; mantém "falha em como o nycode fixa ou embute um terceiro está no escopo".
5. **Prazos**: vem o quadro do ny-pi (7 dias de confirmação, 14 de avaliação; metas, não garantias).
6. **Versões**: última publicada e `main`; antes de 2.0.0 (D-13), só `main`.

Conferência: `rg -n earendil SECURITY.md` só pode achar a menção ao upstream, nunca um contato.

### 5.15 `LICENSE` e `NOTICE` (R58)

- `LICENSE` do nycode: MIT, "Copyright (c) 2025 Mario Zechner". O `docs/fork` exige "LICENSE intacta": o plano a
  **mantém sem alteração**. Uma segunda linha de copyright ("2026 ny-pi contributors", o MIT do ny-pi) é opção do dono,
  não adotada. A atribuição do código importado vai ao `NOTICE`.
- `NOTICE`: hoje cita o upstream, o commit base `073b0bae8488ee20def26e873b77036dac4e9eea` e as mudanças do fork.
  Acrescentar, cada linha na fase em que o código entra: ny-pi (MIT, `marcioazam/ny-pi`, F1 e F2); pi-code 1.7.0
  (MIT, `Copyright (c) 2025 Mario Zechner` e `2026 ilovepixelart`, `ilovepixelart/pi-code`, com a nota dos 19 patches,
  F5 e F6); `pi-lsp` 0.1.7 (MIT, F9); `ponytail` (MIT), `ralph-loop` e `pr-review-toolkit` (Apache-2.0), `claude-red`
  (MIT) como opcionais (F9); skills com licença própria de `claude-home/docs/third-party/` (P-4).
- O texto da licença de cada componente acompanha o `NOTICE`; confirmar o texto exato em F9 (P-4). A frase do `NOTICE`
  do ny-pi "não redistribui código de terceiros" **deixa de ser verdade** em F5 (D-02, D-11) e não migra.

### 5.16 `CHANGELOG.md` (R60)

O nycode tem 11 `CHANGELOG.md` por pacote (`git ls-files`) e `AGENTS.md:132-147` manda escrever só em `[Unreleased]`;
o ny-pi tem um na raiz (44 linhas). D-19: **não criar** o da raiz; as entradas do ny-pi vão para
`packages/coding-agent/CHANGELOG.md`, `## [Unreleased]`, `### Added`, uma por unidade migrada, no PR da unidade. O do
ny-pi fica em `import/ny-pi/` até F12 e depois no histórico do git. Seções liberadas continuam imutáveis.

## 6. Reconciliação de `AGENTS.md`, `CONTRIBUTING.md` e o contrato de trabalho (R57, R59)

Três textos, três leitores. `AGENTS.md` do nycode (155 linhas): regras para desenvolver **este repositório**.
`CONTRIBUTING.md` do nycode (102 linhas) e do ny-pi (29): regras para quem contribui. `claude-home/CLAUDE.md` (66
linhas) e `claude-home/rules/safety.md` (25) do ny-pi: contrato que o **modelo** carrega em toda sessão; migra para
`resources/instructions/` e `resources/rules/` (F8) sob o orçamento de instruções, e **nada dele é copiado para o
`AGENTS.md`**. Se `instruction_budget.py` conta o `AGENTS.md` do repositório: não verificado. Precedência nos
conflitos, só dentro do repositório: vale o gate mais estrito; instrução explícita do dono na tarefa vence os dois.

Siglas: AG = `AGENTS.md` do nycode; CN = `CONTRIBUTING.md` do nycode; CP = `CONTRIBUTING.md` do ny-pi; CC =
`claude-home/CLAUDE.md`; SF = `claude-home/rules/safety.md` (números são linhas).

| nº | regra | origem | conflito? | texto alvo / onde fica |
|---|---|---|---|---|
| A01 | respostas curtas, sem emoji, técnico | AG:5-13 | não | `AGENTS.md`, sem mudança |
| A02 | ler arquivos inteiros; sem `any`; sem import inline | AG:17-30 | não | `AGENTS.md`, sem mudança |
| A03 | formatação TS: tabulação, largura 3, linha 120 | `biome.json` | **sim** (D-06) | `AGENTS.md` + 6.1 |
| A04 | 800 linhas por arquivo, 7 por diretório | CC:30, CP:23 | **sim** (D-06) | `AGENTS.md`, seção "Estrutura" |
| A05 | cobertura de 80% por arquivo | CC:44 | **sim** (D-24) | `AGENTS.md`, "Commands" |
| A06 | nunca `npm test`; nunca vitest completo | AG:51-52 | **sim** | `AGENTS.md` + 6.1 |
| A07 | nunca commitar sem pedido | AG:59 | **sim** | `AGENTS.md`, "Git" + 6.1 |
| A08 | git de várias sessões: só os próprios arquivos | AG:70-90 | **sim** (SF) | `AGENTS.md`, sem mudança |
| A09 | formato de mensagem de commit | AG:80 | **sim** | `AGENTS.md`, escopos novos |
| A10 | changelog só em `[Unreleased]` | AG:132-147 | **sim** (D-19) | `AGENTS.md` e `CONTRIBUTING.md` |
| A11 | portão `lgtm` e auto-fechamento | CN:21-34, AG:94 | **sim** (D-18) | removida |
| A12 | núcleo mínimo; recurso fora do core é extensão | CN:7-11 | **sim** (D-01) | `CONTRIBUTING.md` + 6.1 |
| A13 | classe `core`/`ui`/`optional` | CP:13-19 | não | `CONTRIBUTING.md`, F8 |
| A14 | formato das instruções ao modelo | CP:20-22 | não | `CONTRIBUTING.md`, F8 |
| A15 | terceiros nunca vendorizados | CP:9-11 | **sim** (D-11) | `CONTRIBUTING.md` + 6.1 |
| A16 | regra de honestidade do README | CP:25-29 | **sim** | `CONTRIBUTING.md`, [05](05-marca-e-readme.md) |
| A17 | deps exatas, `--ignore-scripts`, lockfile | AG:63-68 | não | `AGENTS.md`, sem mudança |
| A18 | segredos fora do repositório | CP:6-7, CC:26 | não | `CONTRIBUTING.md`; gancho (5.8) |
| A19 | testes do `coding-agent` sem API real | AG:56 | **sim** | `AGENTS.md` + 6.1 |
| A20 | revisar PR sem trocar de ramo | AG:96-100 | não | `AGENTS.md`, sem mudança |
| A21 | comentário de IA com aviso no fim | AG:106-110 | não | `AGENTS.md`, sem mudança |
| A22 | sobrepor regra exige confirmação | AG:153-155 | **sim** (CC) | `AGENTS.md` + 6.1 |
| A23 | nunca `--no-verify` nem merge administrativo | AG:84, SF:17 | não | `AGENTS.md`, sem mudança |
| A24 | idioma dos documentos | D-04 | não | `docs/` pt-BR; raiz em inglês |
| A25 | regras de `apps/p2` e `apps/p3` | AG:116-130 | não (D-23) | `AGENTS.md`, sem mudança |
| A26 | verificar uma vez antes do commit | CC:41 | **sim** | contrato (F8), fora do `AGENTS.md` |

Contagem: 26 linhas, 15 com conflito "sim".

### 6.1 Resolução dos conflitos

- **A03 (D-06).** O ny-pi formata TypeScript com 2 espaços e aspas simples (`scripts/ci/biome.json`); o fork, com
  tabulação, largura 3, linha 120 (`biome.json`). Vence o fork. Python (`ruff`, `mypy --strict`) e shell (`shellcheck`,
  `shfmt -i 2`) mantêm a do ny-pi. Texto: "TypeScript: Biome do repositório; Python e shell: `scripts/ci/`".
- **A04 (D-06).** O fork tem 50 arquivos de fonte acima de 800 linhas ([02](02-arquitetura-alvo.md), seção 9). Vale
  só para arquivos criados pelo nycode (`src/extensions/<nomes>`, `src/core/permissions/`, `src/migrations/`,
  `resources/`, `scripts/ci/`, `scripts/harness/`, `bench/`); o resto fica em `scripts/ci/lint/structure-upstream.txt`.
- **A05 (D-24).** 80% por arquivo nos arquivos próprios, medido como cobertura do diff (`run-static.sh`); sem
  cobertura retroativa do upstream. Em `pre-launch`, só módulos críticos bloqueiam (CC:45).
- **A06.** `AGENTS.md:51-52` proíbe `npm test` e manda usar `./test.sh`; o ny-pi exige a verificação completa antes do
  commit (CC:41) e `CN:60-67` pede `npm run check` e `./test.sh`. `./test.sh` **é** a execução completa autorizada;
  `npm test` e o vitest direto seguem proibidos. Texto: "A verificação completa é `npm run check` e `./test.sh`".
- **A07, A08.** "Nunca commitar sem pedido" e a entrega por `git-delivery` são compatíveis (a tarefa copia a
  autorização); o conflito é de redação. Texto: "Commit só a pedido do usuário ou com a entrega autorizada na tarefa".
  O `AGENTS.md` proíbe `git reset --hard`, `stash` e `add -A`; o contrato do usuário (SF:18) permite `git reset --hard`
  sob bypass. No repositório vale o mais estrito: continua proibido.
- **A09.** O squash usa `PR_TITLE` (R07) e o modelo de PR pede `!` para quebra. Proposta: o título segue
  `AGENTS.md:80`, com `!` antes de `:`; escopos novos `harness`, `bench`, `ci`, `resources`. A lista atual omite
  `mcp`, `durable`, `chord`, `env`, `schema`, `telemetry`, `codemode`, que são pacotes existentes.
- **A10 (D-19).** `AGENTS.md:132-147` manda escrever em `[Unreleased]`; `CN:69` diz "Do not edit CHANGELOG.md". Valem
  D-19: mantenedores e agentes editam, externos não ("o mantenedor registra a entrada ao mesclar"). As URLs de
  atribuição (`AGENTS.md:146-147`) passam de `earendil-works/pi` para `marcioazam/nycode`.
- **A11 (D-18).** Saem o "Contribution Gate" (`CN:21-34`), as perguntas de auto-fechamento e de fim de semana do FAQ
  (79-85), o Discord (25, 75, 85) e as RFCs da Earendil (99-102); `AGENTS.md:94` vira "See CONTRIBUTING.md". Ficam "The
  One Rule", a qualidade das issues, o bloqueio por spam e os formulários. Política aberta, como no ny-pi.
- **A12 (D-01).** `CN:7-11` e `README.md:19` ("skips features like sub-agents and plan mode") deixam de valer para o
  **produto**, não para o **core**: o harness entra como extensão embutida (`builtin:<nome>`) e o core só muda em K1
  a K14. Texto: mantém a frase e diz que extensões embutidas continuam extensões. A frase do README sai em F6.
- **A15 (D-11).** O ny-pi baixa terceiros na instalação, fixa em `third-party.json` e altera por patch (CP:9-11). No
  nycode **muda**: o pi-code 1.7.0 entra como fonte (D-02), o `pi-lsp` vira extensão embutida (F9) e `third-party.json`
  e `patches/third-party/` deixam de existir. Regra nova (proposta): terceiro entra como (a) dependência exata,
  (b) pacote opcional com SHA fixo ou (c) código importado registrado no `NOTICE` com origem, commit e licença
  (5.15); nunca patch em tempo de execução. Fica da regra antiga: commit completo e licença registrada.
- **A16.** O README do ny-pi abre com a regra "How to read this README" (linhas 28-39): afirmação com amostra e
  intervalo, perda ao lado da vitória, intervalo que cruza zero é "não demonstrado", o não medido é dito, o número novo
  substitui o antigo; CP:25-29 a estende aos PRs. O README do fork não tem regra equivalente. Entra no
  `CONTRIBUTING.md` e no README com D-14 e D-25: **números só com medição do braço `nycode`**; até F10 o texto diz
  "medido como ny-pi sobre pi 1.5.2".
- **A19.** `AGENTS.md:56` vale para `packages/*/test`; só `bench/` gasta tokens (`--budget-usd`). Dizer no `AGENTS.md`.
- **A22.** Manter `AGENTS.md:153-155` e acrescentar "instrução que cita a regra sobreposta já é a confirmação".
- **A26.** Regra de como o agente trabalha, não do repositório: `resources/instructions/contract.md` (F8).

Regras do contrato que ficam só nos recursos embarcados (F8): precedência, entrega por `git-delivery`, plan mode,
orquestração de subagentes, evidência e pesquisa, e o `safety.md` inteiro (sem `rm -rf`, intake de terceiros).

## 7. Critérios de aceite de F2 e F3 para as regras

Só `GET` e leitura local. F2 fecha com as linhas de fase F0 e F2 em `OK`; F3, com as de fase F3, o `diff` do ruleset
vazio, a clássica em 404 e um PR de teste bloqueado por um check obrigatório. Saída em `evidencias/F2.md` e `F3.md`.

```bash
R=marcioazam/nycode
chk() { [ "$2" = "$3" ] && echo "OK    $1" || echo "FALHA $1: obtido [$2] esperado [$3]"; }
J() { gh api repos/$R"$1" --jq "$2"; }
chk R01-R08 "$(J '' '[.allow_squash_merge,.allow_merge_commit,.allow_rebase_merge,.allow_auto_merge,
  .delete_branch_on_merge,.allow_update_branch,.squash_merge_commit_title,.squash_merge_commit_message]|join(" ")')" \
  "true true false true true true PR_TITLE PR_BODY"
chk R09-R12 "$(J '' '[.has_issues,.has_discussions,.has_projects,.has_wiki,.web_commit_signoff_required,
  .visibility,.license.spdx_id]|join(" ")')" "true true true false false public MIT"
chk R13 "$(J '' '.topics|length')" 14;  J '' .description                       # R14: texto de 4.4
ID=$(J /rulesets '.[]|select(.name=="main").id')                                # R15-R24, R42
diff <(gh api repos/$R/rulesets/$ID | jq -S '{name,target,enforcement,bypass_actors,conditions,rules}') \
     <(jq -S . .github/rulesets/main.json) && echo "OK    R15-R24,R42"
chk R18 "$(J /rulesets/$ID '[.rules[].type]|sort|join(" ")')" \
  "deletion non_fast_forward pull_request required_status_checks"
chk R24 "$(J /rulesets/$ID '[.rules[]|select(.type=="required_status_checks")
  .parameters.required_status_checks[]]|length')" 10
gh api repos/$R/branches/main/protection -i 2>&1 | head -1                      # R25: HTTP/2.0 404
chk R26 "$(J /actions/permissions '[.enabled,.allowed_actions,.sha_pinning_required]|join(" ")')" "true all false"
chk R27 "$(J /actions/permissions/workflow '[.default_workflow_permissions,
  .can_approve_pull_request_reviews]|join(" ")')" "read false"
gh api repos/$R/vulnerability-alerts -i | head -1                               # R28: HTTP/2.0 204
chk R29 "$(J /automated-security-fixes '[.enabled,.paused]|join(" ")')" "true false"
chk R30-R31 "$(J '' '.security_and_analysis|[.secret_scanning.status,.secret_scanning_push_protection.status,
  .secret_scanning_non_provider_patterns.status,.secret_scanning_validity_checks.status]|join(" ")')" \
  "enabled enabled disabled disabled"
chk R32 "$(J '/secret-scanning/alerts?state=open' length)" 0
chk R33 "$(J /private-vulnerability-reporting .enabled)" true
chk R34 "$(J /code-scanning/default-setup .state)" not-configured
J /actions/workflows '.workflows[].name'                                        # R34, R35, R49: CodeQL e Scorecard
chk R36-R37 "$(J '/labels?per_page=100' 'length, ([.[]|select(.name=="rust")]|length)'|tr '\n' ' ')" "26 0 "
chk R38 "$(J /labels/dependencies .description)" "Dependency updates (Dependabot)"
chk R39 "$(J /community/profile .health_percentage)" 100
for f in .github/CODEOWNERS .github/dependabot.yml .github/rulesets/main.json .github/PULL_REQUEST_TEMPLATE.md \
  .github/ISSUE_TEMPLATE/{bug,feature_request,config}.yml .github/DISCUSSION_TEMPLATE/{ideas,q-a}.yml \
  .github/{release,zizmor}.yml .husky/pre-commit .pre-commit-config.yaml .gitleaks.toml .leak-allow .gitleaksignore \
  .editorconfig .gitattributes CODE_OF_CONDUCT.md SUPPORT.md SECURITY.md CONTRIBUTING.md LICENSE NOTICE AGENTS.md; do
  git cat-file -e origin/main:$f 2>/dev/null && echo "OK    $f" || echo "FALTA $f"; done       # R40-R47, R50-R60
for f in .github/APPROVED_CONTRIBUTORS .githooks/pre-commit CHANGELOG.md \
  .github/ISSUE_TEMPLATE/{bug_report,contribution,package-report}.yml; do
  git cat-file -e origin/main:$f 2>/dev/null && echo "AINDA EXISTE $f"; done     # R44, R48, R50, R60: sem saída
rg -n -i 'lgtm|discord|rfc\.earendil' CONTRIBUTING.md AGENTS.md .github        # R44, R57, R59: vazio
rg -n earendil SECURITY.md; rg -n 'tgz' .gitattributes; rg -n 'ny-pi|pi-code' NOTICE   # R56, R55, R58
git diff --stat fb05db936 origin/main -- LICENSE                                # R58: vazio
```

Contagens: `rg -c '^\| R[0-9]{2} ' 04-regras-do-repositorio.md` devolve 60; com `A` no lugar de `R`, 26.

## 8. Não verificado

Aceitação de `require_extra_approval_for_unattributed_changes` e `required_reviewers` no `POST`; Dependabot com
workspaces; limite de tópicos; redirecionamento de `marcioazam/nycode-cli`; CodeQL avançado com "default setup"; husky
sob `--ignore-scripts`; `instruction_budget.py` e o `AGENTS.md`; uso dos rótulos `area:` em workflows; perfil de
comunidade em 100%. Nenhum comando de escrita nem exemplo foi executado, exceto os `GET` da introdução.
