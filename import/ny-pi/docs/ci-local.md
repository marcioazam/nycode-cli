# CI local

`scripts/ci/local.sh` roda nesta máquina os mesmos gates do CI remoto, com os mesmos scripts, binários fixados por
sha256 e pacotes Python com hash, num HOME descartável.

| Gate | Comando que o script chama | Tempo medido (2026-11-15) |
|---|---|---|
| ci-static | `scripts/ci/run-static.sh` | 46 s |
| ci-security | `scripts/ci/run-security.sh` | 14 s |
| instruction-budget | `scripts/ci/instruction_budget.py check` | menos de 1 s |
| ci-mutation (só com `--mutation`) | `scripts/ci/run-static.sh mutation` | depende dos arquivos alterados |

## Uso

```bash
bash scripts/ci/local.sh            # os três gates obrigatórios
bash scripts/ci/local.sh --mutation # mais a mutação dos .py alterados
```

- **Saída:** uma linha por gate (`ok` ou `FAIL` com as últimas 40 linhas do log) e o tempo total.
- **Exit:** 0 tudo verde, 1 algum gate reprovou, 124 limite de tempo.
- **Limite de tempo:** 15 min para a execução inteira (`CI_LOCAL_MAX_S`, default 900). Passar disso é falha.
- **Base da comparação:** `BASE_SHA` (default `origin/main`); rode `git fetch origin` antes.
- **Cache:** `CI_LOCAL_CACHE` (default `~/.cache/ny-pi-ci`) guarda os binários e o venv; a primeira execução instala.
- **Histórico de segredos:** só o histórico do `HEAD` é varrido (`LEAKS_LOG_OPTS=HEAD`), porque um clone compartilhado
  guarda branches de outros trabalhos.

O gate de benchmark não entra aqui: o `bench/tools/bench-pr.sh` já roda nesta máquina (ver `docs/bench/RUNBOOK.md`).

## Quando o CI remoto não roda

Decisão do dono (2026-11-15): se o CI remoto não puder rodar (por exemplo, cobrança do GitHub Actions), o CI local o
substitui. Por isso os checks obrigatórios do ruleset não fixam mais o GitHub Actions como origem.

1. Confirme a indisponibilidade e guarde a evidência (mensagem de cobrança do job).
2. Integre a `main` atual no branch do PR e faça o push.
3. Rode `bash scripts/ci/local.sh --mutation --post` nesse head: cada gate vira um status no commit
   (`ci-static`, `ci-security`, `instruction-budget`, `ci-mutation`), com `success` ou `failure`.
4. Rode o `bench-pr.sh --pr N`.
5. Registre o SHA testado, os comandos, os resultados e os checks remotos indisponíveis.

- **`--post` recusa** árvore suja ou `HEAD` não publicado (exit 2): o status tem de descrever o commit publicado.
- **Um check remoto vermelho não é coberto por um status local verde.** Quando existem um check do Actions e um
  status com o mesmo nome, o GitHub exige os dois. Se a cobrança fizer os jobs falharem na partida, desligue os
  workflows (`gh workflow disable ci-static.yml`, idem `ci-security.yml` e `instruction-budget.yml`) e publique um
  commit novo, para que o head não carregue o check falho; religue quando a cobrança voltar. Este caminho não foi
  exercitado com uma falha real de cobrança.
- **Contrapartida aceita:** qualquer credencial com escrita no repositório consegue publicar esses status.
- Nunca use `--admin` nem desligue a proteção da branch.
