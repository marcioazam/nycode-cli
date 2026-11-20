<!-- Anexo D: levantamento bruto de 2026-11-20 pela API do GitHub (só leitura). Regerar antes de F2 e F3. -->
# Regras de repositório: ny-pi (origem) e nycode (destino)

Coleta: `gh api` em 2026-11-20, somente GET. Segredos e variáveis: só nomes (nenhum existe).

## 1. Configuração de merge e do repositório

| Campo | ny-pi | nycode |
|---|---|---|
| `allow_squash_merge` | true | true |
| `allow_merge_commit` | **false** | **true** |
| `allow_rebase_merge` | **false** | **true** |
| `allow_auto_merge` | **true** | false |
| `delete_branch_on_merge` | **true** | false |
| `allow_update_branch` | **true** | false |
| `squash_merge_commit_title` | `PR_TITLE` | `COMMIT_OR_PR_TITLE` |
| `squash_merge_commit_message` | `PR_BODY` | `COMMIT_MESSAGES` |
| `has_issues` / `has_discussions` / `has_wiki` / `has_projects` | true / true / false / true | true / true / false / true |
| `web_commit_signoff_required` | false | false |
| Visibilidade, licença | pública, MIT | pública, MIT |
| Tópicos | `agent-evaluation`, `ai-agents`, `ai-harness`, `benchmark`, `claude`, `cli`, `coding-agent`, `developer-tools`, `llm`, `pi-coding-agent`, `prompt-caching`, `python`, `typescript` | nenhum |
| Descrição | harness para o pi | "Harness de coding agent em terminal, escrito em Rust, apontado para um nylla-gateway self-hosted" (desatualizada) |
| `secret_scanning`, `push_protection`, `dependabot_security_updates` | enabled | enabled |
| `secret_scanning_non_provider_patterns`, `validity_checks` | disabled | disabled |

## 2. Ruleset

ny-pi: um ruleset, `main` (id 27240802), também versionado em `.github/rulesets/main.json`:

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
    { "type": "required_linear_history" },
    { "type": "pull_request", "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": true,
        "required_reviewers": [],
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": true,
        "require_extra_approval_for_unattributed_changes": true,
        "allowed_merge_methods": ["squash"] } },
    { "type": "required_status_checks", "parameters": {
        "strict_required_status_checks_policy": true,
        "do_not_enforce_on_create": false,
        "required_status_checks": [
          { "context": "ci-static" }, { "context": "ci-security" },
          { "context": "instruction-budget" }, { "context": "bench-pr" } ] } }
  ]
}
```

`current_user_can_bypass`: `never`. Sem ruleset de tag. nycode: nenhum ruleset (`[]`).

## 3. Proteção clássica de `main`

- ny-pi: `404 Branch not protected` (usa só o ruleset).
- nycode: protegido. `required_status_checks.strict` true; contextos `build-check`, `test (coding-agent)`,
  `test (durable)`, `test (chord)`, `test (other)`, `mcp-conformance`. `enforce_admins` false. Sem
  `required_pull_request_reviews`. Sem `restrictions`. `required_linear_history` false. `allow_force_pushes` false.
  `allow_deletions` false. `required_conversation_resolution` false. `required_signatures` false. `lock_branch` false.

## 4. Actions

Iguais nos dois: `enabled` true; `allowed_actions` `all`; `sha_pinning_required` false;
`default_workflow_permissions` `read`; `can_approve_pull_request_reviews` false. Segredos, variáveis e segredos do
Dependabot: nenhum. Ambientes: ny-pi nenhum; nycode `copilot` (sem regra de proteção).

## 5. Segurança

| Item | ny-pi | nycode |
|---|---|---|
| Alertas de vulnerabilidade (Dependabot) | ativo (204) | ativo (204) |
| Correções automáticas de segurança | `enabled`, não pausado | `enabled`, não pausado |
| Relato privado de vulnerabilidade | ativo | ativo |
| CodeQL "default setup" | `not-configured` (usa `.github/workflows/codeql.yml`) | `configured`, linguagens `actions` e `rust`, semanal, atualizado em 2026-08-17 |
| Ferramentas nas análises recentes | CodeQL, Scorecard | CodeQL |
| Alertas abertos de code scanning | 2 (Scorecard SAST #5, CII-Best-Practices #9) | não coletado |
| Alertas abertos de secret scanning | 0 | **8** (`google_oauth_client_id` e `_secret` em `packages/ai/src/utils/oauth/google-antigravity.ts`, `google-gemini-cli.ts` e `plan.md`) |
| Alertas abertos do Dependabot | 0 | não coletado |

## 6. Comunidade e outros

- Perfil de comunidade: ny-pi 100%; nycode 71% (faltam código de conduta e modelo de PR).
- Rótulos: ny-pi 26, nycode 13. Só no ny-pi: `area: bench`, `area: ci`, `area: claude-home`, `area: extensions`,
  `area: installer`, `P0`, `P1`, `P2`, `P3`, `type: benchmark`, `type: bug`, `type: docs`, `type: feature`,
  `type: security`. Só no nycode: `rust`.
- Pages: 404 nos dois. Webhooks: nenhum. Chaves de deploy: 0. Limites de interação: nenhum. Autolinks: nenhum.
  Propriedades personalizadas: 404 nos dois.
- Ramos remotos: nycode tem 213 (herdados do antigo projeto em Rust: `dependabot/cargo/*`, `backup/*`,
  `feat/sota-v140-*` e outros). PRs abertos no nycode: 0.

## 7. Arquivos de regra versionados no ramo padrão

| Arquivo | ny-pi | nycode |
|---|---|---|
| `.github/CODEOWNERS` | sim (`* @marcioazam`) | não |
| `.github/dependabot.yml` | sim (`github-actions` em `/`, `npm` em `/npm`; semanal; espera de 7 dias; agrupado) | não |
| `.github/rulesets/main.json` | sim | não |
| `.github/PULL_REQUEST_TEMPLATE.md` | sim | não |
| `.github/ISSUE_TEMPLATE/` | `bug_report.yml`, `feature_request.yml`, `config.yml` | `bug.yml`, `contribution.yml`, `package-report.yml`, `config.yml` |
| `.github/DISCUSSION_TEMPLATE/` | `ideas.yml`, `q-a.yml` | não |
| `.github/release.yml`, `.github/zizmor.yml` | sim | não |
| `.github/APPROVED_CONTRIBUTORS` | não | sim (278 nomes do upstream; inerte, o workflow que o lia foi removido) |
| `.github/workflows/` | `ci-static.yml`, `ci-security.yml`, `instruction-budget.yml`, `codeql.yml`, `scorecard.yml` | `ci.yml`, `npm-audit.yml` |
| Gancho de commit | `.githooks/pre-commit` + `.pre-commit-config.yaml` | `.husky/pre-commit` |
| Vazamento | `.gitleaks.toml`, `.leak-allow` | `.gitleaksignore` |
| `.editorconfig` | sim | não |
| `.gitattributes` | sim | sim |
| `CODE_OF_CONDUCT.md`, `SUPPORT.md` | sim | não |
| `CONTRIBUTING.md`, `SECURITY.md`, `LICENSE`, `NOTICE` | sim | sim |
| `AGENTS.md` | não (o contrato está em `claude-home/CLAUDE.md`) | sim (155 linhas, regras do upstream) |
| `CHANGELOG.md` na raiz | sim | não (um por pacote) |
