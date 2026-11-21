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
- `comandos`: `/goal`, `/plan`, `/agents`, `/tasks` e `/team` existem (`COMMANDS` em `check.py`; `/subagents` não é comando).
- `skills`: todo `SKILL.md` e todo agente do stage tem frontmatter com `name` e `description`, sem `name`
  repetido.
- `mcp`: cada servidor de `mcp.json` está declarado e bem formado (comando no PATH ou URL http(s) com host).

## Braços

| Braço | Diretório de agente no stage | Comandos, skills e agentes lidos de |
|---|---|---|
| `ny-pi` (e demais com `pi`) | `<stage>/.pi/agent` | o stage (`claude-home/`, extensões do `pi-code`) |
| `nycode` | `<stage>/.nycode/agent` | o checkout: `packages/coding-agent/src/extensions` e `packages/coding-agent/resources` |

- O mapa está em `LAYOUTS` (`check.py`). O braço `nycode` recebe `NYCODE_OFFLINE=1` (os demais, `PI_OFFLINE=1`); o
  `NYCODE_CODING_AGENT_DIR` é exportado pelo próprio `bench/arms/nycode`.
- O stage do `nycode` monta `mcp.json` copiando `packages/coding-agent/examples/config/mcp.json` sem alteração (marcadores
  `${VAR}`, sem segredo, nunca o arquivo do dono). É o mesmo arquivo, byte a byte, que o `install.sh` do ny-pi copia do
  `mcp.json.example` (e4f8729), então os dois braços são medidos com as mesmas declarações (D-40): 6 servidores, nenhum com
  `exposure` nem `enabled`. Sem `exposure`, a extensão `mcp` ativa o `codemode` a partir da configuração, antes de qualquer
  servidor conectar; por isso o inventário tem a ferramenta `codemode` nos dois braços, com ou sem rede.
- Os servidores `npx` sobem na partida do `pi`/`nycode`: sem rede eles só falham (o `pi -p` segue). Fora de um sandbox
  sem rede o `npx` baixa pacotes do npm; rode o verificador num sandbox de rede fechada quando isso importar.
- Referência `ny-pi`: `import/ny-pi` não tem `bin/pi` desde F5. Aponte `BENCH_NYPI_SRC` para um checkout do ny-pi (ou um
  `git archive` extraído; sem `.git` ali, defina também `BENCH_STAGE`). Sem a variável o braço sai 2 com a causa.
- Medição em rede fechada: monte o stage fora do sandbox (`BENCH_STAGE=<dir> bench/arms/<braço> --version`; o build
  precisa de npm) e rode o verificador dentro de um sandbox sem rede com o mesmo `BENCH_STAGE`. `BENCH_STAGE` que
  começa com `bench-` é recusado.

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
- Variáveis de sessão (`PI_*`, `CLAUDE_*`, `ANTHROPIC_*`, `NYCODE_*`) são removidas do ambiente, para o resultado ser o
  mesmo dentro e fora de uma sessão do pi.
- Testes: `python -m pytest -q bench/contract` (usam um `pi` ou `nycode` falso em shell, sem o binário real).

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
  sem input comprovadamente inofensivo: `subagent`, `web_fetch`, `codemode`, `tool_search`,
  ferramentas `mcp__*`, de navegador ou desktop, e qualquer ferramenta desconhecida.
- Um caso `falha` em `sem-erro-de-interface` com "sem tool_result" indica que o `pi` não devolveu a chamada
  (erro ou tempo esgotado de 90 s).
- Os nomes das ferramentas são comparados sem diferenciar maiúsculas (`Read` e `read` são a mesma).
- O servidor falso cobre só o que o `pi` usa: `POST` com resposta SSE (ou JSON sem `stream`), um bloco por
  turno; não valida o pedido.

## Velocidade local (`speed.py`)

Mede a sobrecarga do harness sem modelo e sem depender da API (o tempo de parede do gate varia com a API).
Cada braço roda `pi -p` no servidor falso (resposta instantânea) com um roteiro fixo de 3 turnos: `bash`
(`echo ok`), `read` de um arquivo pequeno do diretório de trabalho e texto final. Os braços se intercalam a cada
repetição (ny-pi, pi-vanilla, ny-pi, ...), com relógio monotônico.

```sh
python3 bench/contract/speed.py --arms ny-pi,pi-vanilla --reps 7 --json /tmp/speed.json
python3 bench/contract/speed.py --arms ny-pi,pi-vanilla --reps 5 --cold
```

- `boot_s`: início do processo até a 1ª requisição. `turn_gap_s`: mediana por execução do intervalo entre o fim
  da resposta de um turno e a próxima requisição (ferramenta mais sobrecarga entre turnos). `exit_s`: fim da
  última resposta até o processo terminar. `total_s`. `first_request_bytes` e `first_request_tokens_est`
  (bytes/4) da 1ª requisição.
- Saída: mediana e p90 por braço e por métrica; a razão pareada é a mediana das razões por repetição do 1º braço
  sobre cada um dos outros (`boot_s`, `turn_gap_s`, `total_s`). Braço ausente ou `pi` que falha: exit 2.
- Quente (padrão): um stage por braço, reaproveitado, com uma rodada de aquecimento não contada. `--cold`: stage
  novo e diretório temporário novo a cada execução, sem aquecimento. O cache de transpilação das extensões (jiti)
  fica em `<node_modules ao lado do arquivo>/.cache/jiti` ou, sem ele, em `$TMPDIR/jiti`; o medidor aponta
  `TMPDIR` para um diretório próprio, então o frio começa sem cache e o quente reaproveita o dele. Nenhum cache
  do pi vanilla é apagado (não tem extensões).
- `claude-vanilla` também roda (`ANTHROPIC_BASE_URL` para o servidor falso); o token é um valor falso gravado em
  um arquivo temporário (`BENCH_CC_CREDENTIALS`), que só alcança `127.0.0.1`: nenhum gasto de API. Ele grava a
  sessão em `BENCH_CC_VANILLA_DIR`.

Limitações: é a sobrecarga de um roteiro pequeno nesta máquina, não o tempo de uma tarefa real; o cache de
páginas do SO não é descartado (precisa de root), então o "frio" cobre só o cache do jiti e o stage; `boot_s`
inclui o script do braço (leitura do token, ~dezenas de ms); só a máquina parada dá números comparáveis (rode
sob o `flock` do bench quando um gate estiver ativo); a 1ª requisição é a primeira de qualquer tipo.
