# spec — NyCode CLI

Harness de coding agent em Rust para a Nylla. WHAT e WHY apenas: nenhuma decisão
de implementação, nenhum nome de biblioteca. O COMO vive nos ADRs em
[`docs/architecture/decisions/`](../../docs/architecture/decisions/) e na
[arquitetura](../../docs/architecture/ARCHITECTURE.md).

## Problema

A Nylla opera um gateway self-hosted que expõe credenciais próprias como API
padrão OpenAI e Anthropic, e hoje depende inteiramente de clientes de terceiros
para consumi-lo. Cada cliente traz sua própria política de autenticação, seu
próprio ciclo de release e seu próprio risco de descontinuidade. Não existe uma
superfície de agente que a Nylla controle ponta a ponta.

## Objetivo

Um binário único, `nycode`, que abre uma sessão de coding agent num repositório e
já está falando com o `nylla-gateway`, sem o usuário configurar endpoint,
credencial ou catálogo de modelos.

## Requisitos funcionais

- **FR-1** `nycode` num diretório abre sessão interativa apontada ao gateway.
- **FR-2** `nycode -p "<prompt>"` executa headless e escreve o resultado em stdout.
- **FR-3** O agente dispõe de quatro ferramentas de mutação — ler, escrever,
  editar e executar comando de shell — mais um conjunto somente-leitura de
  busca por conteúdo, busca por nome e listagem de diretório. O conjunto de
  mutação é o padrão; o somente-leitura existe para que uma sessão possa ser
  restringida sem ficar cega.
- **FR-4** A resposta do modelo é transmitida incrementalmente, com cancelamento
  possível a qualquer momento sem corromper a sessão.
- **FR-5** Sessões são persistidas e podem ser continuadas ou retomadas.
- **FR-6** O catálogo de modelos disponíveis é descoberto, não hardcoded.
- **FR-7** Capacidades adicionais chegam por servidores MCP, hooks de ciclo de vida
  e arquivos de skill, sem recompilar o binário.
- **FR-8** As convenções de instrução que a organização já usa — `AGENTS.md`,
  `SKILL.md`, regras de projeto — são lidas sem configuração adicional.
- **FR-9** Um provider alternativo pode ser configurado por arquivo, incluindo
  endpoints OpenAI-compatíveis arbitrários.
- **FR-10** Credenciais são armazenadas no cofre de credenciais do sistema
  operacional, não em texto plano.
- **FR-11** O comando de shell executa sob confinamento do sistema operacional,
  não apenas sob a política de permissão do harness. Quando o confinamento não
  está disponível no ambiente, isso é dito ao usuário, nunca assumido.
- **FR-12** A saída tem três modos: sessão interativa, resposta única em stdout,
  e stream de eventos estruturados para quem integra o binário.
- **FR-13** Prompts reutilizáveis são invocáveis por nome a partir de arquivos do
  projeto, com argumentos, sem recompilar o binário.
- **FR-14** A sessão é uma árvore: qualquer ponto anterior pode ser retomado e
  seguido por outro caminho, com todos os ramos preservados.
- **FR-15** O agente delega uma subtarefa a um agente subordinado com contexto
  próprio, recebendo de volta apenas o resultado.
- **FR-16** Hooks de ciclo de vida são executáveis que recebem e devolvem JSON,
  podendo observar e vetar uma chamada de ferramenta.
- **FR-17** Existe um modo em que o agente apresenta o plano antes de qualquer
  mutação, e só executa depois de aprovação.
- **FR-18** O usuário pode enfileirar uma mensagem enquanto o turno corre, e
  pode direcioná-lo — a mensagem chega após a ferramenta corrente e cancela as
  restantes.
- **FR-19** O modelo pode ser trocado no meio da sessão, e o custo acumulado da
  sessão é visível a qualquer momento.
- **FR-20** Uma imagem pode ser anexada ao pedido, no formato nativo do dialeto
  em uso.

## Requisitos não-funcionais

- **NFR-1** Startup abaixo de 3ms na mediana, medido e travado em CI, e nunca
  acima de um quinto do startup do harness nativo de referência. Os dois pisos
  são duros: o primeiro pega regressão nossa, o segundo pega o concorrente
  passando na frente.
- **NFR-2** Consumo de memória residente abaixo de 8 MiB numa sessão ociosa, e
  nunca acima de metade do consumo do harness nativo de referência.
- **NFR-3** Binário estático, sem runtime externo e sem arquivos irmãos
  obrigatórios — executável a partir de qualquer diretório —, abaixo de 16 MiB e
  nunca acima de um quinto do binário do harness nativo de referência.
- **NFR-4** Fidelidade de wire ao contrato que o gateway documenta: um erro
  in-band, um `stop_reason` fora do vocabulário, ou um sinal de usage estimado
  precisa chegar ao usuário como o gateway o emitiu, nunca degradado em silêncio.
- **NFR-5** Cobertura de 95% agregada e 90% por arquivo de produção, com
  exemptions declaradas que só encolhem. Todo arquivo de produção é examinado,
  inclusive o que não tem linha instrumentada: ausência do relatório é
  declaração revisável, nunca aprovação, e um relatório mais velho que o código
  que ele descreve é recusado.
- **NFR-6** Qualquer comportamento observável divergente do harness de referência
  precisa ser uma decisão registrada, não um acidente.
- **NFR-7** O prefixo enviado ao gateway é estável entre turnos da mesma sessão,
  para que o cache de prompt do backend acerte, e a taxa de acerto é visível ao
  usuário. Um harness que reordena ou reescreve o começo do contexto a cada
  turno transforma cache em custo, e o usuário não tem como perceber.
- **NFR-8** Segurança precede performance. Quando as duas se opõem e não há forma
  que atenda às duas, a segurança define o que é aceitável e a performance se
  acomoda ao que sobra. Três verificações, porque uma regra de prioridade sem
  verificação é decoração: os números de NFR-1 a NFR-3 são medidos sobre o build
  padrão de release com todo controle de segurança ativo; um controle de
  segurança que torne um orçamento inalcançável move o orçamento, nunca o
  contrário, e o número medido que motivou fica registrado; e código que baixa
  artefato de terceiro verifica o digest antes de executar, com o digest esperado
  fixado em arquivo versionado.

## Emenda de escopo — 2026-08-13

FR-11 a FR-20 e NFR-7 entraram depois da redação original, e FR-3 foi ampliado.
A razão é que a spec original descrevia o mínimo para falar com o gateway, não o
mínimo para competir com o que um desenvolvedor já tem instalado. Dois
levantamentos independentes de 2026 colocam o mesmo conjunto como base comum de
qualquer harness sério — loop de editar-rodar-testar, arquivo de instruções,
MCP, plan mode, prompts de permissão e modo headless — e o NyCode CLI atendia
dois desses seis.

Dois desses requisitos divergem da referência e por isso levam ADR próprio:
FR-15, porque o `pi` recusa subagentes por decisão explícita e manda usar tmux;
e FR-11, porque o `pi` não confina o shell. Registrar a divergência é o que o
NFR-6 exige.

## Fora de escopo

- Runtime JavaScript ou TypeScript embutido. Extensões não são código in-process.
- Instalador de pacotes próprio. A distribuição de capacidades usa MCP.
- Interface gráfica ou web própria. O alvo é o terminal. Falar com um editor por
  protocolo padronizado não é ter interface de editor: quem desenha a interface é
  o editor, e o `nycode` continua sendo um processo de terminal.
- Hospedar inferência. O NyCode CLI é cliente.
- Integração com servidor de linguagem, controle de depurador e automação de
  navegador. São diferenciais reais em 2026 e estão fora desta emenda; entram
  por spec própria se entrarem.
- Sessão remota sobre socket: um modo servidor que receba comandos de fora. A
  referência tem a pilha inteira — protocolo em CBOR, servidor e cliente — e
  **nada dentro dela a instancia fora dos testes**: os três pacotes se declaram
  experimentais e não têm consumidor real. FR-12 já entrega o stream de eventos
  estruturados para quem integra o binário, que é a necessidade que um modo
  servidor atenderia. Entra por spec própria se entrar, e a decisão de
  autenticação vem junto: a referência autentica só por permissão de arquivo, e
  isso não basta para o FR-10.

## Emenda de escopo — integração de editor

A integração de editor sai do não-escopo e entra como FR-21, por
[`docs/specs/002-paridade-e-sota-2026/spec.md`](../../docs/specs/002-paridade-e-sota-2026/spec.md).

- **FR-21** Um editor conversa com o `nycode` por protocolo padronizado de
  cliente de agente, sem adaptador de terceiro.

A razão de reabrir: quando esta spec foi escrita, integração de editor
significava escrever uma extensão por editor, e o custo era proporcional ao
número de editores. Deixou de ser. Existe protocolo padronizado com adoção em
mais de vinte agentes, registry desde janeiro de 2026 e implementação nativa em
uma família de IDEs — e existe SDK em Rust, o que torna a superfície obrigatória
quatro métodos mais uma notificação.

O que **não** é reaberto: o não-escopo de sessão remota sobre socket permanece
inteiro. O modelo maduro do protocolo é subprocesso local sobre entrada e saída
padrão — o editor lança o binário e conversa com ele, e não há socket escutando
nem decisão de autenticação de rede a tomar. O transporte remoto do próprio
protocolo é declarado work in progress pelos autores dele. Se um dia deixar de
ser, a decisão volta à mesa com a autenticação junto, como o item de sessão
remota abaixo já exige.

## Non-goals de proveniência

**O código-fonte vazado do Claude Code e qualquer derivado dele — mirrors,
`claw-code`, forks "OpenClaude" — estão proibidos como referência, em qualquer
circunstância e por qualquer contribuidor, humano ou agente.** O material tem
proveniência não resolvida, é alvo ativo de DMCA e alguns mirrors foram
observados com malware. Consultá-lo contamina a cadeia de proveniência deste
repositório de forma irreversível.

Referências permitidas: `pi` (MIT), `grok-build` (Apache-2.0), `codex` (Apache-2.0),
`opencode` (MIT), `goose` (Apache-2.0), com as obrigações de atribuição de cada
licença cumpridas em [`NOTICE`](../../NOTICE).

## Dimensionamento medido

Contagem real do `pi` no commit `581d75a89cea21e50d6a26df840352f94427f633`,
excluindo testes e `node_modules`:

| Pacote | Arquivos | Linhas |
|---|---:|---:|
| `coding-agent` | 199 | 58.806 |
| `ai` | 175 | 23.056 |
| `tui` | 39 | 16.716 |
| `agent` | 50 | 12.611 |
| **Total** | **463** | **111.189** |

Correção de uma premissa que circulou na RECON: a afirmação de que a TUI do `pi`
tem "~600 linhas" refere-se ao renderizador diferencial de tela principal
(`tui-main-screen.ts`, 586 linhas), não ao pacote, que tem 16.716 linhas somando
tratamento de teclas, layout, autocomplete, imagens de terminal e alt-screen.

Subsistemas que o NyCode CLI não porta, por decisão de escopo: o instalador de
pacotes (~2.7k linhas), o sistema de extensões TypeScript (~5.3k), exportação HTML
(~0.7k) e renderização LaTeX (~1.4k). O restante é alvo real de port.

FR-11 e FR-15 não têm contrapartida no `pi` e portanto não estão nesta contagem:
somam trabalho em vez de reaproveitá-lo.

Este número é a justificativa do kill-gate: a Wave 0 existe para descobrir em
semanas, e não em meses, se o esforço se paga.

## Critérios de aceite

- Um desenvolvedor instala o binário, roda `nycode` num repositório e completa uma
  tarefa real de codificação sem editar arquivo de configuração.
- O harness de paridade roda o mesmo prompt no `nycode` e na referência contra o
  mesmo gateway e não acusa divergência em sequência de tool calls, estado final
  dos arquivos, contabilidade de tokens, `stop_reason` ou envelope de erro. As
  cinco dimensões são comparadas de fato; uma dimensão fixada em vazio dos dois
  lados é aprovação falsa, não paridade.
- O benchmark de NFR-1, NFR-2 e NFR-3 passa no CI contra os dois pisos de cada
  métrica, e o baseline do harness nativo de referência contra o qual o piso
  relativo é calculado está versionado com versão, data e digest do artefato
  medido. O número de NFR-1 e NFR-2 é o de uma sessão montada — credencial
  resolvida, workspace varrido, sessão indexada e extensões no ar — e não o de
  um caminho que sai antes disso; e o gate que os afere é ele próprio exercido
  por uma bateria que prova que ele ainda reprova.
- Um comando de shell que tenta escrever fora da raiz do workspace é barrado pelo
  sistema operacional, não apenas pela política do harness (FR-11).
- Nenhum requisito é declarado entregue em documento sem que o caminho de
  produção o execute. Um módulo implementado, testado e nunca chamado é
  pendência, não entrega.
- Nenhum marcador `[NEEDS CLARIFICATION]` permanece.
