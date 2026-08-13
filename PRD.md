# PRD — NyCode CLI

> Requisitos de produto: WHAT e WHY. O detalhamento formal de FR/NFR vive em
> [`.specs/nycode-rs/spec.md`](.specs/nycode-rs/spec.md); este documento existe
> para o contexto de produto que a spec não carrega.

## 1. Visão geral

- **Problema:** a Nylla opera um gateway self-hosted que expõe credenciais
  próprias como API padrão OpenAI e Anthropic, e depende inteiramente de clientes
  de terceiros para consumi-lo. Cada cliente traz sua própria política de
  autenticação, seu ciclo de release e seu risco de descontinuidade. Não existe
  superfície de agente que a Nylla controle ponta a ponta.
- **Usuários-alvo:** desenvolvedores da Nylla trabalhando em repositórios no
  terminal, e scripts de automação que encadeiam o binário num pipeline.
- **Métricas de sucesso:**
  1. Um desenvolvedor instala o binário e completa uma tarefa real de codificação
     sem editar nenhum arquivo de configuração.
  2. O harness de paridade não acusa divergência observável contra a referência.
  3. Os três invariantes de NFR (startup, memória, binário auto-contido) passam
     no CI a cada commit.

## 2. Objetivos e não-objetivos

**Objetivos.** Um binário único, `nycode`, que abre uma sessão de coding agent
num repositório e já está falando com o `nylla-gateway`, sem o usuário configurar
endpoint, credencial ou catálogo de modelos.

**Fora de escopo.**

- Runtime JavaScript ou TypeScript embutido. Extensões não são código in-process
  ([ADR-0002](docs/architecture/decisions/0002-extensions-are-out-of-process.md)).
- Instalador de pacotes próprio. A distribuição de capacidades usa MCP.
- Interface gráfica, web ou de editor. O alvo é o terminal.
- Hospedar inferência. O NyCode CLI é cliente.

**Não-objetivo de proveniência.** O código-fonte vazado do Claude Code e qualquer
derivado dele estão proibidos como referência, para qualquer contribuidor, humano
ou agente. Ver a seção correspondente da
[spec](.specs/nycode-rs/spec.md) e o [`NOTICE`](NOTICE).

## 3. Personas e casos de uso

| Persona | Caso de uso | Superfície |
|---|---|---|
| Desenvolvedor no terminal | Abrir uma sessão num repositório e trabalhar iterativamente | `nycode` interativo |
| Desenvolvedor em script | Rodar um prompt e capturar o resultado num pipe | `nycode -p "..."`, resposta em stdout |
| Automação de CI | Encadear o binário e ramificar pelo resultado | Códigos de saída distintos por `stop_reason` |
| Operador do gateway | Apontar o cliente à própria infraestrutura | `NYCODE_BASE_URL` e `NYCODE_API_KEY` |

## 4. Requisitos funcionais

O conjunto normativo é **FR-1 a FR-20** na
[spec](.specs/nycode-rs/spec.md#requisitos-funcionais). Resumo por estado de
entrega:

**Entregue.** Sessão interativa com editor multilinha, histórico e rodapé de
custo (FR-1); sessão headless com resposta em stdout (FR-2); as ferramentas
nativas de mutação `read`, `write`, `edit` e `bash` (FR-3, parte de mutação);
streaming incremental com cancelamento que não corrompe a sessão (FR-4);
persistência de sessão com `--continue` e `--resume` (FR-5); leitura de
`AGENTS.md`, `CLAUDE.md`, `.claude/rules/` e `SKILL.md` (FR-8); provider
alternativo por configuração (FR-9); credenciais no cofre do sistema
operacional (FR-10).

Também entregues, pelas ondas B e C do
[roadmap](docs/product/ROADMAP.md): o catálogo descoberto do endpoint (FR-6); o
conjunto somente-leitura `grep`, `find` e `ls` (FR-3, parte de leitura); o
confinamento do shell pelo sistema operacional (FR-11); os três modos de saída,
com `--output-format json` (FR-12); slash commands do projeto (FR-13); a sessão
em árvore com `/tree` e `/fork` (FR-14); subagentes pela ferramenta `task`
(FR-15); hooks de ciclo de vida (FR-16, com a ressalva abaixo); plan mode por
`/plan` (FR-17); direcionamento durante o turno (FR-18); troca de modelo por
`/model` (FR-19); e imagem por `--image` (FR-20).

**Parcial.** Só FR-7, e por um motivo estreito: os três mecanismos de extensão
estão ligados, mas dos quatro eventos de hook que o
[ADR-0009](docs/architecture/decisions/0009-hooks-sao-executaveis-com-contrato-json.md)
desenhou, só `pre-tool-use` dispara. Os outros três estão declarados e adiados.

A tabela por requisito, com a verificação de cada um, está em
[`docs/requirements/REQUIREMENTS.md`](docs/requirements/REQUIREMENTS.md); esta
seção resume e aquela manda.

## 5. Requisitos não-funcionais

NFR-1 a NFR-6 na [spec](.specs/nycode-rs/spec.md#requisitos-não-funcionais).
Os que são verificados automaticamente estão tabelados em
[`docs/INDEX.md`](docs/INDEX.md#invariantes-travados-no-ci). Em particular:

- **NFR-5 (qualidade):** cobertura de 95% agregada e 90% por arquivo de produção,
  com exemptions declaradas que só encolhem
  ([ADR-0003](docs/architecture/decisions/0003-pisos-de-cobertura-95-agregado-90-por-arquivo.md)).

## 6. Dependências e riscos

| Risco | Natureza | Mitigação |
|---|---|---|
| OAuth de assinatura viola termos de provedores | Aceito, com decisão registrada | Atrás da feature `subscription-oauth`, fora do build padrão, verificado no CI ([ADR-0001](docs/architecture/decisions/0001-subscription-oauth-is-a-flagged-accepted-risk.md)) |
| Disponibilidade do `nylla-gateway` | Dependência externa | Provider alternativo configurável (FR-9) |
| Esforço de port maior que o retorno | Escopo | Kill-gate da Wave 0, dimensionado em 111.189 linhas de referência na spec |
| Divergência silenciosa da referência | Corretude | Harness `nycode-parity` compara contrato observável |

## 7. Log de decisões

Decisões significativas viram ADR em
[`docs/architecture/decisions/`](docs/architecture/decisions/README.md).

---
Status: vivo · Fonte normativa: [`.specs/nycode-rs/spec.md`](.specs/nycode-rs/spec.md)
