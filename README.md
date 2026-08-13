# NyCode CLI

Harness de coding agent em terminal, escrito em Rust, que já vem apontado para um
[`nylla-gateway`](https://github.com/nylla/nylla-gateway) self-hosted.

```bash
export NYCODE_BASE_URL=https://seu-gateway/v1
export NYCODE_API_KEY=...
nycode -p "explique este repositorio"
```

## Por que existe

O gateway expõe credenciais próprias como API padrão OpenAI e Anthropic, e até
aqui dependia inteiramente de clientes de terceiros para ser consumido. Cada um
traz sua própria política de autenticação, seu ciclo de release e seu risco de
descontinuidade. O NyCode CLI é a superfície de agente que a Nylla controla
ponta a ponta.

## Números medidos

Os requisitos não-funcionais que justificam o projeto são invariantes travados no
CI, não aspirações:

| | Piso | Medido | Gate |
|---|---:|---:|---|
| Startup da sessão montada | 15.000 µs | **3.880 µs** | `perf-gate.sh` |
| Memória de uma sessão ociosa | 14 MiB | **10,3 MiB** | `perf-gate.sh` |
| Chegada do processo (`--version`) | 1.148 µs | **558 µs** | `perf-gate.sh` |
| Memória na chegada | 8 MiB | **5,8 MiB** | `perf-gate.sh` |
| Binário auto-contido | 16 MiB | **13,1 MiB, roda de qualquer diretório** | `perf-gate.sh` |
| Cobertura agregada de produção | 95% | **97,8%** em 1.076 testes | `coverage-gate.sh` |
| Divergência da referência | zero | 5 dimensões implementadas e **observadas**; a comparação contra a referência espera o binário dela | `parity-gate.sh` |

"Sessão montada" é o número que importa: credencial resolvida, workspace
varrido, árvore de sessão indexada e servidores MCP no ar. É o que os
requisitos descrevem, e medi-lo exigiu parar de medir `--version` — que o
`clap` resolve antes de qualquer uma dessas coisas
([ADR-0013](docs/architecture/decisions/0013-o-gate-mede-a-sessao-montada-e-nao-o-version.md)).

Cada métrica tem dois pisos e vale o mais apertado: um absoluto, perto do valor
medido, e um relativo ao concorrente nativo mais rápido — hoje o `codex-cli`,
que chega em 3.446 µs contra os nossos 558 µs e ocupa 22 MiB contra os nossos
5,8. Um piso só olharia para o próprio umbigo e não veria o mercado passar na
frente
([ADR-0012](docs/architecture/decisions/0012-performance-e-medida-contra-um-concorrente-nomeado.md)).
Os tempos dos dois lados são o menor observado, não a mediana: num runner
compartilhado a mediana mede a contenção e o mínimo mede o programa.

## Estado

| Área | Situação |
|---|---|
| Dialetos de wire | Anthropic Messages, OpenAI Chat Completions, OpenAI Responses |
| Ferramentas nativas | Mutação: `write`, `edit`, `bash`. Somente-leitura: `read`, `grep`, `find`, `ls`. |
| Permissões | Sessão interativa pergunta antes de cada mutação; headless nega sem `--allow-writes`. O shell roda confinado pelo SO — escrita restrita à raiz, rede negada —, e a ausência de confinamento é avisada. |
| Sessões | JSONL append-only, `--continue` e `--resume`. Em árvore: `/tree` lista os pontos de retomada e `/fork` ramifica sem reescrever nada. |
| Contexto | `AGENTS.md`, `CLAUDE.md`, `.claude/rules/`, `SKILL.md` |
| Extensões | Os três mecanismos do ADR-0002: skills, servidores MCP via `.mcp.json` (stdio ou Streamable HTTP) e hooks executáveis em `.nycode/hooks/`, onde `pre-tool-use` pode vetar uma chamada. |
| Catálogo | Descoberto do endpoint e cacheado por 6h em `.nycode/catalog.json`; um modelo que o endpoint não serve é recusado com a lista do que existe. |
| Interface | Sessão interativa com editor multilinha, histórico e rodapé de custo; headless com `-p`; eventos NDJSON com `--output-format json`. |
| Comandos | `/help`, `/tree`, `/fork`, `/plan`, `/model`, `/compact`, `/export`, `/quit`, mais os que o repositório define em `.nycode/commands/`. |
| Subagentes | Ferramenta `task`: contexto próprio, herda a permissão do pai, devolve só o texto final. |
| Cancelamento | `Ctrl+C` interrompe o turno e a sessão guarda o que já aconteceu. |

## Uso

```bash
nycode                                # sessao interativa no diretorio atual
nycode -p "prompt"                    # headless, resposta em stdout
nycode -p "..." --allow-writes        # permite escrita e execucao
nycode -p "..." --continue            # retoma a sessao mais recente
nycode -p "..." --dialect openai-responses
```

Na sessão interativa: `Enter` envia, `Alt+Enter` quebra linha, as setas
verticais navegam o histórico, `Ctrl+C` interrompe o turno e `Ctrl+D` sai.

`stdout` carrega apenas a resposta, o que torna a saída utilizável num pipe. O
progresso de ferramentas vai para `stderr`. Códigos de saída distinguem sucesso
de recusa (3), estouro de limite (4), motivo desconhecido (6) e cancelamento
(130), para que um script encadeando `nycode` não precise parsear texto.

### Configuração

`~/.config/nycode/settings.json`, todo campo opcional. Ausente significa o
padrão, então um arquivo que ajusta uma coisa não repete as outras:

```json
{
  "keep_recent": 8,
  "tool_limit": 64,
  "command_timeout_secs": 120,
  "provider": {
    "base_url": "https://gateway.interno/v1",
    "dialect": "openai-completions",
    "model": "modelo-local",
    "max_tokens": 8192
  }
}
```

O bloco `provider` é o FR-9: apontar o binário para outro gateway, incluindo
qualquer endpoint OpenAI-compatível, sem repetir três flags a cada invocação. A
escolha é por campo — trocar só o `base_url` mantém o diálogo e o modelo
padrão. A flag vence o arquivo, para que quem configurou a máquina ainda consiga
apontar para o gateway de fábrica numa execução sem editar nada.

O arquivo é do usuário e nunca do workspace. Um `settings.json` versionado no
repositório esticaria o próprio prazo de comando e o próprio teto de turnos, que
são os limites que existem para contê-lo, e escolheria para onde a sessão fala.
Um campo que não existe é recusado com aviso em vez de ignorado em silêncio,
porque erro de digitação aceito calado deixa quem configurou achando que
configurou.

## Mapa de documentos

| Documento | Papel |
|---|---|
| [`.specs/nycode-rs/spec.md`](.specs/nycode-rs/spec.md) | WHAT e WHY, requisitos FR/NFR, non-goals |
| [`.specs/nycode-rs/research.md`](.specs/nycode-rs/research.md) | RECON de 4 passes que fundamenta as decisões |
| [`docs/architecture/decisions/`](docs/architecture/decisions/) | ADRs |
| [`NOTICE`](NOTICE) | Atribuições de terceiros e aviso de risco |

## Arquitetura

| Crate | Papel |
|---|---|
| `nycode-ai` | Cliente de wire, catálogo, retentativa, projeção de stream |
| `nycode-agent` | Loop de agente, ferramentas, permissões, sessões, contexto, MCP |
| `nycode-mcp` | Cliente MCP: transporte stdio e Streamable HTTP sobre o SDK oficial |
| `nycode-tui` | Interface de terminal: renderizador diferencial, editor, painel |
| `nycode-auth` | Resolução de credenciais; OAuth de assinatura atrás de flag |
| `nycode-cli` | Binário `nycode` |
| `nycode-parity` | Harness diferencial contra o de referência |

Extensibilidade é out-of-process por decisão medida: embutir V8 custaria +51 MB
no binário e apagaria o ganho que motiva o projeto. Ver
[ADR-0002](docs/architecture/decisions/0002-extensions-are-out-of-process.md).

## Desenvolvimento

```bash
cargo test --workspace --all-features
cargo clippy --workspace --all-targets --all-features
```

Os três gates que fecham o CI:

```bash
# Cobertura: 95% agregado e 90% por arquivo de producao, exemptions so encolhem.
# O relatorio precisa ser completo e mais novo que o codigo que ele descreve.
scripts/coverage-gate-test.sh
cargo llvm-cov --workspace --all-features --json --output-path coverage.json
scripts/coverage-gate.sh coverage.json

# Performance: NFR-1 startup, NFR-2 memoria, NFR-3 binario auto-contido
scripts/perf-gate.sh
```

O CI também verifica que a feature `subscription-oauth` não entrou
transitivamente no build padrão.

## Aviso

O NyCode CLI pode ser compilado com a feature `subscription-oauth`, que **não
faz parte do build padrão**. Ela autentica com tokens OAuth de assinaturas de
consumidor, um padrão que viola os termos de uso de provedores relevantes e já
resultou em suspensão de contas. Leia o
[ADR-0001](docs/architecture/decisions/0001-subscription-oauth-is-a-flagged-accepted-risk.md)
e o [`NOTICE`](NOTICE) antes de habilitá-la. O caminho recomendado é o gateway
com chave de API.

## Licença

MIT. Ver [`LICENSE`](LICENSE) e [`NOTICE`](NOTICE).
