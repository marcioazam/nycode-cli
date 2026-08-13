# ADR-0005: O confinamento do shell é do sistema operacional, aplicado no processo filho

- **Status:** aceito
- **Data:** 2026-08-13
- **Contexto relacionado:** [`spec.md`](../../../.specs/nycode-rs/spec.md) FR-11, NFR-3, NFR-4

## Contexto

A ferramenta `bash` roda `bash -lc` a partir da raiz do workspace com o ambiente
completo do usuário. A única contenção é o timeout de 90s, o stdin fechado em
`/dev/null` e o teto de 64 KiB por fluxo de saída. O `ToolContext::resolve`
contém caminhos para `read`, `write` e `edit`, mas um comando de shell não passa
por ele — e o `McpTool` o contorna por construção, com comentário próprio
dizendo isso. Na prática, o gate de permissão do harness é uma convenção que
qualquer comando ignora.

O `pi`, harness de referência, também não confina o shell. Essa é uma
divergência que o NFR-6 exige registrar, e este ADR é onde ela fica registrada.
O Codex CLI, por outro lado, trata confinamento como base: Seatbelt no macOS,
bubblewrap no Linux e WSL2, sandbox nativo no Windows, e a documentação da
OpenAI é explícita quanto ao motivo — o sandbox reduz fadiga de aprovação, e
sem ele o agente precisa perguntar a cada comando ou não perguntar nunca.

A restrição que decide a forma da solução é do próprio workspace:
`unsafe_code = "forbid"`. Isso elimina chamar `sandbox_init` ou `landlock_*` por
FFI direto. Restam duas famílias: crates que já embrulham o syscall em API
segura, ou delegar a um executável do sistema.

Uma segunda restrição vem do NFR-1. O confinamento precisa ser aplicado por
comando, não por processo: aplicá-lo ao `nycode` inteiro no startup fecharia o
acesso do próprio harness ao cofre de credenciais e ao gateway.

## Decisão

O confinamento é aplicado ao processo filho, por plataforma, com uma política
padrão única chamada `workspace-write`: leitura ampla do sistema de arquivos,
escrita restrita à raiz do workspace mais os diretórios temporários, rede
negada.

- **Linux.** `bwrap` do pacote `bubblewrap` quando disponível no `PATH`, que é
  o mesmo caminho do Codex e não exige `unsafe`. Sem `bwrap`, não há
  confinamento e o aviso obrigatório abaixo é o que o usuário recebe.
- **macOS.** `sandbox-exec` com perfil gerado, invocado como processo, porque
  `sandbox_init` só existe por FFI.
- **Demais plataformas.** Sem confinamento.

A restrição que não é negociável: **quando o confinamento não está disponível,
o usuário é avisado em `stderr` no primeiro comando de shell da sessão, e a
resposta do modelo carrega o fato de que o comando rodou sem confinamento.**
Rodar sem sandbox em silêncio é exatamente a degradação que o NFR-4 proíbe, e a
diferença entre "protegido" e "achou que estava protegido" é a única que
importa aqui. A ausência de sandbox nunca é implícita.

O aviso vale sempre que o comando de shell for alcançável na sessão, e não
apenas quando a sessão foi aberta com permissão de escrita: a sessão interativa
usa o gate `Ask`, que alcança `bash` mediante aprovação no prompt.

## Consequências

Positivas: um comando que tenta escrever fora da raiz é barrado pelo kernel e
não pela boa vontade do modelo, o que torna `--allow-writes` uma decisão
proporcional em vez de um cheque em branco; o buraco do `McpTool` que contorna
`resolve` fecha por uma via aparentada, mas não por esta — servidores MCP também
são processos filhos e precisam de uma política própria, decidida no
[ADR-0017](0017-duas-politicas-de-confinamento.md); e nada disso precisa de
`unsafe`.

Negativas: o comportamento passa a depender do ambiente, e um `bwrap` ausente
muda o que o mesmo comando faz na mesma máquina — daí o aviso ser obrigatório.
Delegar a `bwrap` e a `sandbox-exec` significa depender de executáveis externos,
o que arranha o espírito do NFR-3, embora não a sua letra, que fala do binário
do NyCode CLI e não do que ele invoca. O Windows fica descoberto nesta rodada.
Testar isto exige matriz por plataforma, e o piso de cobertura de 90% por
arquivo vai doer no módulo que decide qual estratégia usar — a resposta é
injetar o detector de disponibilidade, não dispensar o arquivo.

Descartadas: **`birdcage`**, que é multiplataforma e resolveria Linux e macOS
numa API só, rejeitado porque depende de `seccompiler` 0.3 enquanto a versão
corrente é 0.5, e porque o próprio README diz que não impede a maioria dos
syscalls — para o caso de uso, contenção de sistema de arquivos e rede é
justamente o que se quer, mas a defasagem da dependência decide. **`extrasafe`**,
que combina seccomp, Landlock e user namespaces com ergonomia boa, rejeitado por
suportar apenas `x86_64`, o que quebraria o alvo `aarch64` que o workflow de
release já publica. **`seccompiler` puro**, rejeitado porque seccomp filtra
syscall e não caminho: não expressa "escreva só aqui", que é a política que se
quer. **Container por comando**, rejeitado por custo de startup incompatível com
NFR-1 e por exigir daemon. **Aplicar o sandbox ao processo `nycode` inteiro**,
rejeitado porque cortaria o próprio acesso do harness ao cofre e ao gateway.

## Revisão

Reabrir quando o Windows entrar no conjunto de plataformas suportadas de fato,
quando `extrasafe` ganhar `aarch64`, ou se a dependência de executável externo
provar-se frágil em campo. Reabrir também se a política `workspace-write` se
mostrar restritiva demais na prática — o sinal a observar é usuário desabilitando
o confinamento por hábito, que indicaria política errada e não sandbox errado.

## Emenda — 2026-08-13

Uma auditoria da fronteira de confiança encontrou três afirmações deste ADR sem
correspondência no código. Emendadas acima, com o registro aqui para que a
mudança não pareça reescrita da história.

**Removido: o fallback para o crate `landlock` no Linux.** Nunca foi construído;
`detect_on` vai direto para indisponível quando não há `bwrap`. Uma segunda
camada declarada e ausente é pior que uma camada só, porque quem lê para de
procurar. Reabrir é barato se o caso aparecer.

**Removida: a flag `--no-sandbox`.** O ADR dizia que ela existe. Não existe em
nenhuma versão do binário. O que a substitui é a regra que já estava aqui e
continua: a ausência de confinamento nunca é implícita, e o aviso é obrigatório.

**Corrigida: a consequência sobre servidores MCP.** O ADR declarava que o buraco
do `McpTool` fechava por esta mesma via. Não fechava — `sandbox::wrap` só era
chamado pela ferramenta de shell. E ao tentar fechá-lo descobriu-se que a
política `workspace-write` é inaplicável a um servidor MCP, porque `--unshare-net`
nega justamente o que a maioria deles existe para fazer. A correção está no
[ADR-0017](0017-duas-politicas-de-confinamento.md).

**Esclarecido: quando o aviso vale.** O ADR dizia "no primeiro comando de shell
da sessão", e a implementação condicionava o aviso à sessão ser gravável — o que
deixava a sessão interativa com gate `Ask` alcançar `bash` sem aviso nenhum. O
critério correto é o comando ser alcançável, não a sessão ser gravável.
