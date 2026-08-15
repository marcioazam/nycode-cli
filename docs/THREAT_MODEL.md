# Modelo de ameaça — NyCode CLI

Isto não substitui o
[checklist de segurança da fronteira de confiança](specs/001-fronteira-de-confianca/checklists/security.md),
que é o registro item-a-item, pass/fail, contra a spec. Este documento é a
vista de mais alto nível — ativos, fronteiras de confiança, ameaças e
mitigação — para quem chega sem ter lido a spec inteira. Onde os dois
divergirem, o checklist vence: ele é revisado a cada mudança de spec, e este
documento não é regerado automaticamente.

## Ativos

- **Credencial do gateway** — resolvida do cofre do sistema operacional (FR-10), nunca em texto plano.
- **Conteúdo do repositório do usuário** — lido pelo agente para montar contexto, e alvo de escrita das ferramentas de mutação.
- **Artefato de sessão** — histórico append-only em disco, fora da árvore versionada.
- **A própria máquina do usuário** — alcançável pelo comando de shell que o agente executa.

## Fronteiras de confiança

| Fronteira | O que cruza | Quem controla o lado de fora |
|---|---|---|
| Processo `nycode` ↔ modelo (via gateway) | Prompt, ferramentas disponíveis, resposta do modelo | O provedor do modelo — entrada não confiável |
| Processo `nycode` ↔ sistema de arquivos | Leitura e escrita das ferramentas | O usuário, mas o conteúdo pode ter sido escrito por terceiro (repositório clonado) |
| Processo `nycode` ↔ shell confinado | Comando textual, saída capturada | O sistema operacional, via bubblewrap/Seatbelt |
| Processo `nycode` ↔ servidor MCP | Ferramentas declaradas, chamadas, resultados | Quem publica o servidor — extensão de terceiro |
| Processo `nycode` ↔ hook | Payload JSON, veto | O workspace — configuração tratada como segurança (FR-8) |

## A Regra de Dois

Um agente que combina **entrada não confiável** + **acesso a dado privado** +
**comunicação externa** ao mesmo tempo é o padrão de risco mais alto em
sistemas agenticos (OWASP ASI). O NyCode CLI combina os três nos três
vértices simultaneamente: o conteúdo do repositório e a saída de servidor MCP
são entrada não confiável; a política de confinamento monta a maior parte do
sistema de arquivos legível; e a chamada ao gateway é comunicação externa,
feita pelo harness e portanto fora do sandbox do comando de shell.

**Estado: parcial, aceito com registro** — ver a seção "Regra de Dois" do
checklist para o que fecha e o que fica. O vértice de execução não consentida
está fechado (todo comando pede permissão nomeada, FR-11); o que não fecha é
a leitura ampla que o confinamento `workspace-write` permite, porque negar
essa leitura quebraria toolchains reais. Não é lacuna descoberta agora — é
uma decisão já tomada, revisitável se o custo de compatibilidade mudar.

## Ameaças e mitigação

| Ameaça | Vetor | Mitigação | Onde é testado |
|---|---|---|---|
| Travessia de caminho | Ferramenta de arquivo recebe `../` ou link simbólico apontando para fora do workspace | Canonicalização depois de normalização léxica, imposta na abertura do arquivo (FR-9, [ADR-0018](architecture/decisions/0018-a-contencao-de-caminho-e-imposta-na-abertura.md)) | `crates/nycode-agent/src/tool/contain_test.rs` |
| Injeção de comando | Conteúdo de repositório ou saída de modelo tenta escapar para o shell fora do comando declarado | O comando de shell é a única entrada interpretada por um shell, e roda confinado; nenhuma outra entrada é interpolada (FR-5, FR-11) | `policy::confinement` |
| Rug pull de servidor MCP | Servidor MCP muda o conjunto de ferramentas depois do consentimento inicial | Revalidação por hash da definição consentida ([ADR-0028](architecture/decisions/0028-o-consentimento-fixa-a-definicao-declarada.md)) | testes de `policy::hooks` e do cliente MCP |
| Injeção de prompt via instrução do projeto | `AGENTS.md`/`SKILL.md`/regra de projeto do repositório carrega instrução maliciosa | Superfície identificada explicitamente (instrução, skill, comando); arquivo de regra tratado como configuração de segurança, não pode apontar para fora da raiz (FR-8, FR-10) | checklist "Postura de agente" |
| Vazamento de segredo por log ou lista de processos | Credencial aparece em representação de depuração ou em `ps` | Representação de depuração trava o campo de credencial; segredo nunca vira argumento de processo filho visível (FR-15, FR-18) | achados B2/C3 do checklist |
| Exfiltração via canal do harness | Rede negada ao processo filho, mas o próprio harness fala com o gateway fora do sandbox | Não fechado — ver "A Regra de Dois" acima. Mitigação parcial: todo comando pede permissão nomeada primeiro | Registrado, sem teste automatizado — é limitação conhecida, não regressão |
| Artefato de terceiro adulterado | Binário de referência ou action de CI substituído | Digest verificado antes de executar, fixado em arquivo versionado (NFR-8, [ADR-0030](architecture/decisions/0030-toda-action-de-terceiro-e-fixada-por-sha-verificado.md)) | `scripts/perf-baseline.txt`, `.pinact.yaml` |

## Revisão

Este documento é revisado quando o checklist de segurança de uma spec nova o
altera, ou quando um achado de auditoria muda o estado de uma linha acima.
Não há cadência fixa — o gatilho é a mudança na fonte, não o calendário.
