# Robustez a falhas (camada 2, sem modelo)

Cada braço (`ny-pi`, `nycode`, `pi-vanilla`, `claude-vanilla`) roda contra um servidor Anthropic falso que injeta uma falha
por execução. Reaproveita `bench/contract/fake_api.py` (roteamento, captura, serializador SSE) por import. Custo zero:
nada sai da máquina e nenhum modelo é chamado.

Roteiro: o modelo pede `read` de `probe.txt` e depois responde o texto fixo `FAULTS-DONE-7731`. A falha atinge o
primeiro pedido que declara ferramentas; chamadas auxiliares sem ferramentas recebem texto normal.

| Cenário | Injeção |
|---|---|
| `rate-limit` | 429 `rate_limit_error` com `retry-after: 1` |
| `overloaded` | 529 `overloaded_error` |
| `mid-stream-cut` | 200 SSE, conexão fechada após 3 eventos, sem `message_stop` |
| `slow-first-byte` | primeiro byte após 8 s (abaixo do timeout) |
| `malformed-sse` | evento `data:` com JSON truncado no meio do stream |
| `bad-tool-json` | `tool_use` com `partial_json` inválido |
| `unknown-tool` | `tool_use` de ferramenta inexistente |

Métricas por (braço, cenário): `status` (`ok`: texto final presente; `failed`: saiu com erro e sem texto; `silent`:
exit 0 sem texto, erro mascarado; `hung`: sem terminar em 120 s), código de saída, nº de requisições com ferramentas
(retries aparecem como requisições extras), segundos.

```sh
python3 bench/faults/run.py --arms ny-pi,nycode,pi-vanilla,claude-vanilla [--scenarios rate-limit,overloaded] [--json out.json]
python3 -m pytest bench/faults
```

Exige o token OAuth dos braços vanilla (`BENCH_CC_CREDENTIALS`), que só é enviado a 127.0.0.1. O stage do `ny-pi` e do `nycode`
é construído como em `bench/contract/check.py` (`<stage>/.pi/agent` e `<stage>/.nycode/agent`, com `NYCODE_OFFLINE=1`
para o `nycode`; a referência `ny-pi` exige `BENCH_NYPI_SRC`, ver `bench/contract/README.md`). Exit 0 = medido (falha de braço é resultado); 2 = argumento inválido.
Limite: k=1 por padrão e um cenário por execução; a falha é pontual (primeiro pedido), não persistente.
