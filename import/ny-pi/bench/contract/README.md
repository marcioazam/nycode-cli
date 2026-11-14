# Contrato do harness (sem modelo)

Verificador determinístico e de custo zero: prova que cada função do harness está registrada e responde
sem interface. Nenhum pedido sai da máquina: o `pi` do braço roda em um stage descartável com o provedor
redirecionado para um servidor local falso (`fake_api.py`), que devolve um roteiro em vez de um modelo.

## O que verifica

- `inventario`: ferramentas enviadas ao modelo em `pi -p` (nome e tamanho de descrição + schema), tamanho do
  system por seção de primeiro nível, skills e agentes listados.
- `regras`: `plan_mode_complete` e `question` não são enviadas em `-p`; nenhuma ferramenta chamada com input
  mínimo devolve `UI not available` ou `Not in plan mode`.
- `basicas`: `read`, `write`, `edit`, `bash` e `todo` executam de ponta a ponta (o `tool_result` não é erro e
  o efeito no arquivo existe).
- `plano`: com `--plan`, `plan_mode_complete` está presente e não há escrita: `write`/`edit` ausentes ou, se
  enviadas, uma escrita fora do arquivo de plano é recusada (o arquivo não é criado).
- `comandos`: `/goal`, `/plan` e `/subagents` existem.
- `skills`: todo `SKILL.md` e todo agente do stage tem frontmatter com `name` e `description`, sem `name`
  repetido.
- `mcp`: cada servidor de `mcp.json` está declarado e bem formado (comando no PATH ou URL http(s) com host).

## Como rodar

```sh
BENCH_CC_CREDENTIALS=<arquivo de credenciais> BENCH_REPO=x/y \
  python3 bench/contract/check.py --arm ny-pi --json /tmp/contract.json
python3 bench/contract/check.py --arm ny-pi --only regras
```

- Exit `0`: contrato íntegro. Exit `1`: algum caso em `falha`. Exit `2`: ambiente indisponível (motivo no stderr).
- O stage é montado pelo braço em um diretório temporário e apagado no fim. `BENCH_STAGE` reaproveita um stage
  seu (o `models.json` dele é sobrescrito); um stage compartilhado `bench-*` é recusado.
- O braço lê o token de `BENCH_CC_CREDENTIALS`, mas o token só chega a `127.0.0.1`; os corpos capturados não
  incluem cabeçalhos.
- Variáveis de sessão (`PI_*`, `CLAUDE_*`, `ANTHROPIC_*`) são removidas do ambiente, para o resultado ser o
  mesmo dentro e fora de uma sessão do pi.
- Testes: `python -m pytest -q bench/contract` (usam um `pi` falso em shell, sem o binário real).

## Como ler o JSON

- `arm`, `commit`, `exit` e `summary` (contagem de `ok`, `falha`, `pulado`).
- `inventory`: `tools` (lista de `name` e `chars`), `tools_count`, `tools_chars`, `system_chars`,
  `system_sections` (caracteres por seção; `(texto)` é o que fica fora de qualquer seção), `skills_listed`,
  `agents_listed`, e `skills`/`agents` (`files` e `description_chars` lidos do stage). Serve de registro dos
  blocos de contexto por commit.
- `cases`: `name`, `group`, `status` e `evidence` (trecho curto do `tool_result` ou o local do registro).

## Limitações

- Estático: `comandos`, `skills` e `mcp` leem arquivos do stage (`registerCommand('nome'` nas extensões ou
  `commands/<nome>.md`); não provam o comportamento do comando.
- Pulado: `tools/list` dos servidores MCP (precisa de rede/login; nenhum servidor é iniciado) e as ferramentas
  sem input comprovadamente inofensivo: `subagent`, `web_fetch`, antigravity, `codemode`, `tool_search`,
  ferramentas `mcp__*`, de navegador ou desktop, e qualquer ferramenta desconhecida.
- Um caso `falha` em `sem-erro-de-interface` com "sem tool_result" indica que o `pi` não devolveu a chamada
  (erro ou tempo esgotado de 90 s).
- Os nomes das ferramentas são comparados sem diferenciar maiúsculas (`Read` e `read` são a mesma).
- O servidor falso cobre só o que o `pi` usa: `POST` com resposta SSE (ou JSON sem `stream`), um bloco por
  turno; não valida o pedido.
