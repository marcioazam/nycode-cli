# Linha de base sem modelo (D-39)

Contrato com a API falsa e falhas injetadas, do braço `nycode` e da referência `ny-pi`, medidos sem modelo nem provedor
real (rodada final da D-40: mesmo `mcp.json` nos dois braços, commit do bench `d594d675753f`, 2026-11-21). Resultado:
contrato 28 ok, 1 falha (`basicas/todo`, nos dois) e 4 pulados em cada braço; falhas injetadas 6 de 7 recuperadas e
`malformed-sse` falha nos dois. Leitura caso a caso: [F10-paridade](../../../migration/ny-pi-core/evidencias/F10-paridade.md).

Este diretório **não** alimenta o `bench-pr`: o gate lê só `../runs.jsonl` e `../meta.json` (com modelo). Nada aqui
substitui nem enfraquece essa base.

## Arquivos

- `contract-<braço>.json`: saída de `bench/contract/check.py --json` (`summary`, `inventory`, `cases`).
- `faults-<braço>.json`: saída de `bench/faults/run.py --json` (um objeto por cenário).

## Como regravar

Por PR, como a linha com modelo, sem rede e com credencial falsa (`BENCH_CC_CREDENTIALS` aponta um JSON falso; o token
do bench nunca é lido). Depois de montar os estágios dos dois braços (`bench/arms/nycode` e `bench/arms/ny-pi`, mesmo
`mcp.json`):

```bash
python3 bench/contract/check.py --arm nycode --json docs/bench/baseline-main/sem-modelo/contract-nycode.json
python3 bench/contract/check.py --arm ny-pi --json docs/bench/baseline-main/sem-modelo/contract-ny-pi.json
python3 bench/faults/run.py --arms nycode --json docs/bench/baseline-main/sem-modelo/faults-nycode.json
python3 bench/faults/run.py --arms ny-pi --json docs/bench/baseline-main/sem-modelo/faults-ny-pi.json
```

O contrato sai com código 1 enquanto `basicas/todo` falhar (resultado, não erro). Ao regravar a linha com modelo, o
`bench-nightly.sh` sugere apagar `docs/bench/baseline-main` e copiar a rodada nova no lugar: preserve este diretório
(copie a rodada nova para dentro de `docs/bench/baseline-main/` sem tocar em `sem-modelo/`).
