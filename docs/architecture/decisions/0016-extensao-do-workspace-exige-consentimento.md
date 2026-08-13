# ADR-0016: Uma extensão declarada pelo workspace exige consentimento registrado antes da primeira execução

- **Status:** aceito
- **Data:** 2026-08-13
- **Contexto relacionado:** [`spec.md`](../../../.specs/nycode-rs/spec.md) FR-7, FR-16, NFR-4; [spec da feature](../../specs/001-fronteira-de-confianca/spec.md) FR-1 a FR-4

## Contexto

O [ADR-0002](0002-extensions-are-out-of-process.md) nomeou três mecanismos de
extensão e todos leem da raiz do workspace. Dois deles executam processo: o
servidor MCP declarado em `.mcp.json`, `.claude/mcp.json` ou `.nycode/mcp.json`,
e o hook executável em `.claude/hooks/` ou `.nycode/hooks/`. A raiz do workspace
é o diretório que um `git clone` acabou de preencher com conteúdo de terceiro.

Nenhum dos dois passa por decisão de confiança. O gate de permissão decide sobre
chamada de ferramenta, não sobre proveniência de processo, e roda depois — o
servidor já subiu quando o modelo pede a primeira ferramenta. O hook recebe um
aviso em `stderr`; o servidor MCP não recebe nem isso. Na prática, clonar um
repositório e abrir o `nycode` nele executa o que aquele repositório escolheu.

O [ADR-0009](0009-hooks-sao-executaveis-com-contrato-json.md) já registrou o
problema na seção de consequências negativas: "Ler `.claude/hooks/` significa
executar código que outra ferramenta instalou, o que é superfície de confiança
nova e precisa de decisão de confiança do projeto antes da primeira execução."
A decisão foi nomeada e nunca foi construída. Este ADR a constrói, e a estende
ao servidor MCP, que tem a mesma forma de risco e nem o aviso tinha.

Há precedente convergente: os harnesses que leem `.mcp.json` de escopo de
projeto pedem aprovação antes de subir o servidor, e revalidam quando a
declaração muda. A convergência importa porque o formato de arquivo é
compartilhado — herdar o formato sem herdar a proteção é a pior combinação
possível.

A restrição que decide a forma vem do modo headless. O `nycode -p` roda em
pipeline, e o [`nycode-parity`](../../../crates/nycode-parity/src/runner.rs)
dirige o próprio binário num subprocesso. Um prompt bloqueante travaria os dois.

## Decisão

Uma extensão declarada pelo workspace não é executada antes de consentimento
registrado para aquela declaração.

Cinco restrições, que são a decisão tanto quanto a escolha principal:

- **O consentimento é por declaração, não por workspace.** A chave é a raiz
  canônica mais o hash do que será executado: o fragmento de configuração do
  servidor, o conteúdo do executável do hook. Confiar num workspace inteiro
  transformaria o primeiro "sim" em cheque em branco para tudo que aquele
  repositório venha a declarar depois.
- **Hash diferente revalida.** Trocar o `command` de um servidor já confiado, ou
  reescrever o executável de um hook já confiado, pede consentimento de novo. É
  o que fecha o rug pull, que é a forma esperada do ataque quando o
  consentimento existe.
- **O registro vive fora do workspace**, no diretório de configuração do
  usuário. Um registro sob `.nycode/` seria auto-certificante: a ferramenta
  `write`, sob permissão ampla, concederia a própria confiança.
- **Sem interlocutor, nega e degrada.** Em modo headless a extensão não sobe, a
  sessão segue sem ela, e o `stderr` diz o que foi recusado. É a mesma regra que
  o `Approver::Never` já aplica a chamada de ferramenta, e a mesma degradação
  por servidor que o `connect_all` já faz quando um servidor não sobe.
- **A pergunta mostra o que será executado.** "Confiar neste servidor?" não é
  decidível; o que importa é qual comando, com quais argumentos.

## Consequências

Positivas: a classe de ataque por repositório hostil fecha no ponto certo, que é
antes do `spawn` e não depois; o formato `.mcp.json` compartilhado passa a vir
com a proteção que o acompanha nos outros harnesses; a consequência negativa que
o ADR-0009 registrou deixa de ser dívida declarada e vira comportamento; e o
modo headless fica mais seguro que antes sem que nenhum pipeline existente
quebre, porque negar e degradar é compatível com o que já acontece quando um
servidor não sobe.

Negativas: a primeira sessão em cada repositório com extensão passa a ter uma
pergunta que antes não existia, e fadiga de aprovação é real — a mitigação é o
consentimento ser lembrado e a pergunta só voltar quando a declaração mudar. Um
pipeline que dependia de um servidor MCP declarado no repositório passa a rodar
sem ele, silenciosamente do ponto de vista do resultado e ruidosamente em
`stderr`; quem precisar do servidor em CI terá de consentir antes, e isso é
trabalho novo para quem já usava. O registro é estado persistido fora do
workspace, que é uma coisa a mais para existir, migrar e eventualmente corromper
— daí ele ser um arquivo simples e a ausência dele significar "nada confiado" em
vez de erro. Divergência observável do harness de referência, que o NFR-6 exige
registrar: uma extensão que a referência subiria, o `nycode` recusa até o
consentimento.

Descartadas: **confiar no workspace inteiro numa pergunta só**, rejeitado porque
o primeiro sim viraria cheque em branco para toda declaração futura daquele
repositório, e é justamente o commit posterior que carrega o ataque.
**Perguntar a cada execução sem lembrar**, rejeitado por fadiga de aprovação —
uma pergunta que aparece sempre é uma pergunta que ninguém lê. **Bloquear a
sessão em headless quando há extensão não confiada**, rejeitado porque
transformaria toda extensão opcional em dependência obrigatória, que é o oposto
do que o `connect_all` já decidiu, e quebraria pipeline existente. **Assinatura
criptográfica de publicador**, rejeitado porque exige cadeia de confiança e
registro que não existem no ecossistema MCP hoje; o hash da declaração observada
resolve o rug pull, que é o risco real. **Confiar em `.nycode/` e desconfiar de
`.claude/`**, rejeitado porque os dois estão igualmente sob controle de quem
escreveu o repositório — a distinção seria teatro.

## Revisão

Reabrir se aparecer registro de publicador MCP com assinatura verificável, caso
em que o hash da declaração deixa de ser a melhor chave disponível. Reabrir
também se a fadiga de aprovação aparecer em uso real — o sinal a observar é
usuário consentindo sem ler, que indicaria granularidade errada e não
consentimento errado; a saída nesse caso é agrupar por servidor em vez de por
declaração, não remover a pergunta. E reabrir se o modo headless precisar
executar extensão de repositório em CI de forma rotineira, caso em que a saída é
um comando explícito que grava o consentimento antes do pipeline, e não afrouxar
o padrão.
