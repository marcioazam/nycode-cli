# Suítes S4 (plan) e S5 (multi)

Avaliam o repositório ny-pi (braço `ny-pi`) contra as referências vanilla. Neutras de capacidade: medem o resultado (testes ocultos), nunca o formato de plano ou o uso de subagentes.
Plano e decisões: `docs/bench/pi-harness-ci-2026-11-13.md` (D10, D11, D14).

- `plan/`: 12 casos. 8 `outcome` multi-passo (refatoração, migração de formato, bug a rastrear) e 4 `ask`
  (pedido ambíguo ou contraditório). O prompt começa com `Planeje antes de implementar.`.
- `multi/`: 10 casos `outcome` com 3 módulos independentes cada, testes ocultos por módulo; o prompt diz que o
  trabalho é paralelizável.

## Contrato de caso

`bench/suites/<suite>/<case_id>/`:

| Item | Conteúdo |
|---|---|
| `case.json` | `id`, `suite` (`plan`/`multi`), `kind` (`outcome`/`ask`), `prompt`, `timeout_s` (<=900), `budget_usd` (<=1.5), `split` (`dev`/`heldout`), `security` (false), `test_cmd`, `ask_terms` (só `ask`) |
| `repo/` | estado inicial (Python stdlib); vira o cwd do agente |
| `hidden/` | testes pytest copiados para `<workdir>/hidden` só após o agente terminar (`outcome`) |
| `oracle/` | arquivos que, copiados sobre `repo/`, fazem `hidden/` passar (`outcome`) |

`ask` não tem `hidden/` nem `oracle/`.

Nota: `outcome` = `test_cmd` sai 0. `ask` = árvore inalterada (git status limpo) e resposta final com `?` citando
ao menos um `ask_term` (comparação sem diferenciar maiúsculas, por substring).

Held-out (D14): 30% de cada suíte, `sorted(ids)` + `random.Random(20261113).sample`, gravado em `split`.

## Verificar

```bash
python3 bench/suites/check_oracles.py [--suite plan|multi] [--case ID]
python3 -m pytest bench/suites -q -p no:cacheprovider
```

`check_oracles.py` exige, por `outcome`, `repo/`+`hidden/` falhando (no-op) e `repo/`+`oracle/`+`hidden/`
passando; valida os campos, o held-out e o mínimo de casos. Sai 1 com a lista de problemas.
