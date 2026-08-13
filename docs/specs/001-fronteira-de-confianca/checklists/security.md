# checklist de segurança — fronteira de confiança do agente

Portão pass/fail sobre a [`spec.md`](../spec.md). Um único FAIL bloqueia a fase
de desenho: a spec é revista antes de qualquer código.

O escopo é a fronteira de confiança do agente. Itens que não se aplicam a um CLI
local — CORS, XSS, sessão HTTP — estão marcados como tal em vez de omitidos,
porque a ausência silenciosa não distingue "não se aplica" de "esquecido".

## Entrada e saída

| Item | Estado | Nota |
|---|---|---|
| Entrada do modelo validada antes de virar caminho de arquivo | PASS | FR-9, com canonicalização depois da normalização léxica |
| Travessia de caminho impedida | PASS | FR-9 cobre `..`, caminho absoluto e link simbólico |
| Injeção de comando impedida | PASS | O comando de shell é intencional e confinado (FR-5); nenhuma outra entrada é interpolada em shell |
| Injeção em política de sandbox impedida | PASS | FR-8; era o achado A3 |
| Desserialização segura | PASS | Só JSON por `serde`, sem tipo dinâmico |
| SSRF | PASS | FR-1 exige destino validado para servidor HTTP |
| XSS, CORS, cabeçalho de resposta | N/A | Não há superfície web |

## Autenticação e autorização

| Item | Estado | Nota |
|---|---|---|
| Toda ampliação de privilégio é pedida por nome | PASS | FR-11; era o achado A2 |
| Privilégio de subagente não escala | PASS | Já correto hoje, `subagent_gate` herda do pai |
| Veto de hook não escala privilégio | PASS | Já correto hoje, compõe por conjunção |
| Padrão nega | PASS | FR-3 estende ao consentimento a regra que o `Approver::Never` já aplica |
| Comparação de segredo em tempo constante | N/A | Nenhum segredo é comparado no processo; a validação é do gateway |

## Segredo e criptografia

| Item | Estado | Nota |
|---|---|---|
| Segredo fora do código-fonte e do controle de versão | PASS | Cofre do sistema, ambiente ou flag |
| Segredo nunca em log | PASS | FR-15 trava a representação de depuração |
| Segredo não visível na lista de processos | PASS | FR-15 e o achado B2 |
| Segredo não repassado a processo de terceiro | PASS | FR-18; era o achado C3 |
| TLS para comunicação externa | PASS | FR-1 recusa texto claro fora de loopback |
| Rotação documentada | PASS | O cofre do sistema é a fonte; `nycode auth login` regrava |
| Zeroização de memória | FORA DE ESCOPO | Declarado na spec, com a razão |

## Privacidade

| Item | Estado | Nota |
|---|---|---|
| Minimização de dado coletado | PASS | Nada é coletado; não há telemetria |
| Resíduo de sessão fora da árvore versionada | PASS | FR-17; era o achado P4 |
| Sem PII em log, métrica ou mensagem de erro | PASS | FR-15 |
| Caminho de exclusão existe | PASS | O artefato de sessão é arquivo, removível pelo usuário |

## Postura de agente — OWASP ASI

| Item | Estado | Nota |
|---|---|---|
| Permissão de ferramenta com escopo | PASS | FR-11 |
| Servidor MCP com consentimento e revalidação por hash | PASS | FR-1 e FR-2 cobrem o rug pull |
| Sem repasse de token por MCP | PASS | FR-18 |
| Allowlist de saída de rede | PARCIAL | FR-1 valida destino de servidor HTTP declarado; não há allowlist de saída para o que o servidor MCP alcança depois de subir |
| Arquivo de regra tratado como configuração de segurança | PASS | FR-10 impede que ele aponte para fora da raiz |
| Superfície de injeção de prompt identificada | PASS | Instrução, skill e comando; a spec nomeia os três |
| Execução isolada para código não confiável | PASS | FR-5 e FR-6 |
| Ação irreversível com gate humano | PASS | FR-1 e FR-11 |

## Regra de Dois

A sessão combina os três vértices ao mesmo tempo: entrada não confiável
(conteúdo do repositório no prompt, saída de servidor MCP), acesso a dado
privado (a política de confinamento monta todo o sistema de arquivos legível), e
comunicação externa (a chamada ao gateway, feita pelo harness, que está fora do
sandbox).

**Estado: PARCIAL — aceito com registro.**

Esta spec fecha o vértice da execução não consentida e restringe o disco para
servidor MCP e hook, mas não fecha a leitura ampla do comando de shell: a
política `workspace-write` mantém `--ro-bind / /` porque um agente precisa do
toolchain e das bibliotecas para compilar. Negar rede ao processo filho não
impede exfiltração, porque o canal de saída é o harness.

A alternativa — restringir a leitura à raiz mais o toolchain — é uma decisão
separada, com custo de compatibilidade próprio, e não cabe nesta spec. Fica
registrada aqui para que a próxima revisão a encontre em vez de redescobri-la.

## Veredito

**PASS com uma parcial registrada.** Nenhum FAIL. A fase de desenho está
liberada.

A parcial da Regra de Dois e a da allowlist de saída são a mesma limitação vista
de dois ângulos, e ambas apontam para o mesmo trabalho futuro: uma política de
leitura restrita. Nenhuma das duas bloqueia esta entrega, porque o que esta
entrega remove — execução sem consentimento — é pré-requisito de qualquer
exploração das duas.
