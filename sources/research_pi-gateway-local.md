# sources — como a referência aponta para um gateway local

Material bruto da Frente 0 da spec 002: o mecanismo que o `pi` 0.84.1, no
commit fixado pelo [`NOTICE`](../NOTICE)
(`581d75a89cea21e50d6a26df840352f94427f633`), de fato lê para escolher o
endpoint. Acesso em 2026-08-16, no checkout local
`/home/marcio/source/pi-reference` nesse commit. MIT, já atribuído.

O critério de pronto não é "encontrei a opção na doc". É um comando cuja
saída foi lida fazendo o `pi` falar com o `nycode-parity-fixture` local.

## O que a variável de ambiente não faz

`Harness::reference` define `ANTHROPIC_BASE_URL`. Esta versão a ignora: o
endpoint vem da definição do modelo. Confirmado de novo nesta pesquisa, não
só no registro de 2026-08-13.

Controle, lido em 2026-08-16. `ANTHROPIC_BASE_URL` apontava para um proxy na
frente do fixture; `ANTHROPIC_API_KEY=fixture`; o diretório de agente estava
vazio, sem `models.json`. O proxy não recebeu pedido nenhum. O `pi` foi à
API real da Anthropic e voltou:

```
401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_011Ce7CSH62dcv31S3nT9shR"}
provider: anthropic
model: claude-opus-4-8
```

O `request_id` é genuíno. A variável foi oferecida e não honrada.

## O mecanismo que ela lê

Três peças, nesta ordem.

**1. O arquivo de definição de modelo.**
`packages/coding-agent/docs/models.md` (commit fixado), abertura e seção
"Overriding Built-in Providers":

> Add custom providers and models (Ollama, vLLM, LM Studio, proxies) via
> `~/.pi/agent/models.json`.

> Route a built-in provider through a proxy without redefining models:
>
> ```json
> { "providers": { "anthropic": { "baseUrl": "https://my-proxy.example.com/v1" } } }
> ```

O exemplo da doc traz `/v1` no `baseUrl`. Para o dialeto
`anthropic-messages` isso está errado contra o SDK que a referência usa —
ver a peça 3. A forma que funcionou, lida, é a origem sem o sufixo.

**2. O diretório é redirecionável por variável, e o nome literal é
`PI_CODING_AGENT_DIR`.**
`packages/coding-agent/src/config.ts`:

```
APP_NAME = pkg.piConfig?.name || "pi"
ENV_AGENT_DIR = `${APP_NAME.toUpperCase()}_CODING_AGENT_DIR`
getAgentDir(): process.env[ENV_AGENT_DIR] || ~/.pi/agent
getModelsPath(): join(getAgentDir(), "models.json")
```

`packages/coding-agent/package.json` desta distribuição não define
`piConfig.name`, só `piConfig.configDir = ".pi"`. Então `APP_NAME` é `pi` e
a variável é `PI_CODING_AGENT_DIR`. Confirmado empiricamente: com ela
apontando para um diretório que contém o `models.json` abaixo,
`--list-models` listou `fixture / nylla-sonnet-4.5` na primeira linha.

Se a distribuição instalada definir `piConfig.name`, o prefixo muda. O
mecanismo é o mesmo. O harness precisa do nome desta distribuição, a que o
NOTICE fixa.

**3. O SDK da Anthropic trata `baseUrl` como origem, não como prefixo de
rota.**
`packages/ai/scripts/generate-models.ts` grava os modelos built-in com
`baseUrl: "https://api.anthropic.com"` — sem `/v1`.
`packages/ai/src/api/anthropic-messages.ts` passa isso para
`new Anthropic({ baseURL: model.baseUrl })`, e o cliente posta em
`/v1/messages`.

Consequência contra o fixture, medida com `curl` no mesmo processo:

| URL pedida | status | rota que o fixture viu |
|---|---|---|
| `$origem/v1/messages` | 200 | `/v1/messages` — o script |
| `$origem/v1/v1/messages` | 404 | `/v1/v1/messages` |
| `$origem/v1/messages` via `$impressa/messages` | 200 | `/v1/messages` |

O fixture anuncia `http://127.0.0.1:<porta>/v1`. Passar essa string como
`baseUrl` do modelo `anthropic-messages` faz o SDK pedir
`/v1/v1/messages`, que o fixture recusa. O `baseUrl` que aponta é a origem,
`http://127.0.0.1:<porta>`.

(O exemplo da doc com `/v1` vale para `openai-completions`, cujo SDK trata
`baseUrl` como prefixo. Misturar os dois dialetos no mesmo campo é o erro
óbvio.)

## O comando cuja saída foi lida

O fixture servindo, o `models.json` abaixo no diretório de agente, a
referência invocada com as mesmas flags que `Harness::reference` já passa
(`--mode json -p`). Sem `--provider` e sem `--model`: o override do
built-in `anthropic` é o que o `pi` escolhe por padrão.

```bash
cargo build -p nycode-parity --bin nycode-parity-fixture
fixture_url=$(target/debug/nycode-parity-fixture | head -n1)   # http://127.0.0.1:<porta>/v1
origem=${fixture_url%/v1}

agent=$(mktemp -d)
cat >"$agent/models.json" <<EOF
{
  "providers": {
    "anthropic": {
      "baseUrl": "$origem",
      "api": "anthropic-messages",
      "apiKey": "fixture"
    }
  }
}
EOF

env -u ANTHROPIC_API_KEY -u ANTHROPIC_BASE_URL -u ANTHROPIC_AUTH_TOKEN \
  PI_CODING_AGENT_DIR="$agent" \
  /home/marcio/source/pi-reference/pi --mode json -p --no-session \
  "diga so a palavra xyzzy-nao-existe"
```

Saída lida em 2026-08-16. Fingerprints que só o fixture emite, e que a API
real da Anthropic não emite:

- `"responseId":"msg_fixture"` (o identificador fixo de
  [`fixture.rs`](../crates/nycode-parity/src/fixture.rs) `turn`)
- `"input":1234` (a contabilidade constante do mesmo script)
- `"id":"toolu_fixture"`

O prompt de sistema da referência contém a string `README.md`, então o
script do fixture — que decide o plano procurando essa string no corpo —
pediu `read`. Isso não é falha do apontamento: o pedido chegou, o script
respondeu, o `pi` interpretou o SSE. É um detalhe do script contra um
prompt de sistema que o `nycode` não envia, e não do mecanismo de endpoint.

Um proxy de registro na frente do fixture, no mesmo run, gravou:

```
POST /v1/messages HTTP/1.1 host=127.0.0.1:<porta> bytes=39140
POST /v1/messages HTTP/1.1 host=127.0.0.1:<porta> bytes=51545
```

Dois pedidos, os dois locais. Nenhum `Host: api.anthropic.com`.

## O que isto fecha, e o que não fecha

Fecha o ponto de decisão da Frente 0. As três saídas — repinar o NOTICE,
interceptar por DNS/proxy, waiver por ADR — não disparam: o `pi` 0.84.1
aceita gateway local pelo mecanismo acima, no commit que o NOTICE já fixa.

Não fecha a paridade. Fecha só a pergunta "por onde apontar". A
materialização — `Harness::reference` escrever este `models.json` num
diretório efêmero e exportar `PI_CODING_AGENT_DIR` — é a Frente 0.2 em
diante, e a decisão de desenho que vira ADR.
