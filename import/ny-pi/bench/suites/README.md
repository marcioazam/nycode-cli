# Suítes S4 (plan), S5 (multi) e S8 (hard)

Avaliam o repositório ny-pi (braço `ny-pi`) contra as referências vanilla. Neutras de capacidade: medem o resultado (testes ocultos), nunca o formato de plano ou o uso de subagentes.
Plano e decisões: `docs/bench/pi-harness-ci-2026-11-13.md` (D10, D11, D14).

- `plan/`: 12 casos. 8 `outcome` multi-passo (refatoração, migração de formato, bug a rastrear) e 4 `ask`
  (pedido ambíguo ou contraditório). O prompt começa com `Planeje antes de implementar.`.
- `multi/`: 10 casos `outcome` com 3 módulos independentes cada, testes ocultos por módulo; o prompt diz que o
  trabalho é paralelizável.
- `hard/`: 12 casos `outcome` em repositórios de 20 a 40 arquivos, com `docs/SPEC.md` de regras numeradas e
  testes visíveis que passam no estado inicial (exceção de propósito: `hard-test-triage` começa com 12 testes
  visíveis falhando, e a tarefa é separar defeito de código de teste errado). Três temas: bug longe do sintoma, mudança transversal com
  muitas regras, trabalho longo e largo. Existe porque S4 e S5 saturaram (todos os braços acima de 90%).
  Roda só sob demanda (`--tier hard`), fora do gate de PR. Tudo que os testes ocultos exigem está no prompt
  ou no SPEC: um teste oculto que cobra mais do que o texto pede é defeito da tarefa. Em 2026-11-15 foram
  corrigidos 23 pontos assim em 9 casos: 3 achados lendo as falhas e 20 numa auditoria independente de cada
  asserção contra o prompt e o SPEC (por exemplo: proibição da palavra `legacy` em comentário, "uma única
  chamada" onde o SPEC diz "só esses agregados", tipo de retorno, nome de dia e recuo que o SPEC não fixa,
  ordem de chaves, atributo interno). Cada correção só afrouxa o que o texto não pede; o oracle passa e o
  repositório inicial falha em todos os casos.
  Limite medido: com Sonnet 5.5 a suíte também saturou em acerto (ny-pi e Claude Code 36 de 36, pi puro 34 de
  36), então ela separa custo, turnos e tempo, não acerto.

## Contrato de caso

`bench/suites/<suite>/<case_id>/`:

| Item | Conteúdo |
|---|---|
| `case.json` | `id`, `suite` (`plan`/`multi`/`hard`), `kind` (`outcome`/`ask`), `prompt`, `timeout_s` (<=900), `budget_usd` (<=1.5), `split` (`dev`/`heldout`), `security` (false), `test_cmd`, `ask_terms` (só `ask`) |
| `repo/` | estado inicial (Python stdlib); vira o cwd do agente |
| `hidden/` | testes pytest copiados para `<workdir>/hidden` só após o agente terminar (`outcome`) |
| `oracle/` | arquivos que, copiados sobre `repo/`, fazem `hidden/` passar (`outcome`) |

`ask` não tem `hidden/` nem `oracle/`.

Nota: `outcome` = `test_cmd` sai 0. `ask` = árvore inalterada (git status limpo) e resposta final com `?` citando
ao menos um `ask_term` (comparação sem diferenciar maiúsculas, por substring).

Held-out (D14): 30% de cada suíte, `sorted(ids)` + `random.Random(20261113).sample`, gravado em `split`.

## Verificar

```bash
python3 bench/suites/check_oracles.py [--suite plan|multi|hard] [--case ID]
python3 -m pytest bench/suites -q -p no:cacheprovider
```

`check_oracles.py` exige, por `outcome`, `repo/`+`hidden/` falhando (no-op) e `repo/`+`oracle/`+`hidden/`
passando; valida os campos, o held-out e o mínimo de casos. Sai 1 com a lista de problemas.
