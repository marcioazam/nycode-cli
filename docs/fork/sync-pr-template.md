<!--
Corpo do PR de sincronização com o upstream (`earendil-works/pi`): `gh pr create --body-file docs/fork/sync-pr-template.md`.
Política e procedimento: docs/migration/ny-pi-core/08-sincronizacao-upstream.md. Método de fusão: merge (nunca squash
nem rebase). Preencha todos os campos; campo sem valor medido leva "não medido" e o motivo. Título do PR:
`chore(sync): upstream <U12>`.
-->

# Sincronização com o upstream

## Commits

| Campo | Valor |
|---|---|
| U (commit do upstream) | `<sha40>` (ponta de `main` ou tag `v...`) |
| R (commit imagem renomeada) | `<sha40>` (ramo `upstream-renamed/<sha12>`) |
| R_prev (imagem anterior) | `<sha40>` (primeira sincronização: `f523ebd25`) |
| Trailer `Rename-Pipeline` de R | `<sha256>` |
| Pais de R conferidos | `R^1 == R_prev` e `R^2 == U`: sim / não |

## Métricas (seção 9 do 08)

| # | Métrica | Valor |
|---|---|---|
| 9.1 | Tempo da sincronização (minutos, do `git fetch` à fusão) | |
| 9.2 | Arquivos em conflito (`git diff --name-only --diff-filter=U` logo depois do `git merge`) | |
| 9.3 | Delta próprio (`git diff --stat upstream-renamed/<sha12>..HEAD` sem `resources/`, `import/`, `bench/`, `scripts/fork/`, `docs/`) | |
| 9.4 | Atraso (`git rev-list --count main..origin/upstream/main` antes de sincronizar) | |
| 9.5 | Costuras intactas (`bash scripts/ci/seams/check-seams.sh`) | seams N/14 |
| 9.6 | Resoluções reaproveitadas pelo `rerere` | |

Arquivos em conflito e regra aplicada a cada um (ordem da seção 6 do 08):

- `<caminho>`: <regra>

## Resultado do `merge-policy`

Job `merge-policy` do push em `main` depois da fusão: passou / falhou (link da execução). Para falha: hash do merge
commit, issue aberto e `git revert -m 1`.

## Checks

| Check | Resultado | Ponta testada (SHA) |
|---|---|---|
| `npm ci --ignore-scripts` | | |
| `npm run check` | | |
| `./test.sh` | | |
| `bash scripts/ci/seams/check-seams.sh` | | |
| `scripts/ci/run-static.sh` | | |
| CI remoto (`build-check`, `test (...)`, `audit`) | | |

Não executado e por quê: <lista ou "nada">.

## Registro

Arquivo `docs/fork/syncs/AAAA-MM-DD-<sha12>.md` com este corpo preenchido (ver
[`docs/fork/syncs/README.md`](syncs/README.md)).
