# SLO — NyCode CLI

Um CLI local não tem um serviço no ar para um usuário terceiro depender, e
portanto não tem burn-rate de erro para nenhum on-call pagear
— o padrão externo já prevê essa adaptação: "a service with no user-facing
surface drops the browser-facing targets". O que existe em lugar de um SLO de
serviço são os **indicadores de nível travados no CI a cada release**, que
cumprem o mesmo papel — um número medido, um piso, e uma consequência
automática quando o piso é violado.

## Indicadores e objetivos

Os números vivem só em [`docs/INDEX.md`](INDEX.md) ("Invariantes travados no
CI") e em [`docs/requirements/REQUIREMENTS.md`](requirements/REQUIREMENTS.md)
— não repetidos aqui, para não criar uma terceira cópia que pode ficar
desatualizada. Em espírito, os quatro objetivos são:

| Indicador | Papel de SLI | Gate |
|---|---|---|
| Startup (chegada do processo e sessão montada) | Latência de "resposta" — o equivalente do CLI a tempo de resposta de servidor | `scripts/perf-gate.sh`, job `perf` |
| Memória residente | Consumo de recurso por invocação | `scripts/perf-gate.sh`, job `perf` |
| Tamanho do binário | Custo de distribuição, não runtime — mas travado do mesmo jeito | `scripts/perf-gate.sh`, job `perf` |
| Cobertura de linhas | Não é SLI de usuário, mas é o objetivo de qualidade que substitui um objetivo de disponibilidade — não há "uptime" para um binário que só roda quando invocado | `scripts/coverage-gate.sh`, job `coverage` |

## Por que não há política de error budget

Error budget existe para decidir **quando parar de fazer deploy** e começar a
consertar confiabilidade. Este repositório não faz deploy contínuo de um
serviço — cada release é um binário versionado que o usuário baixa e roda
localmente, com controle total sobre quando atualizar. A pergunta que error
budget responde ("estamos gastando confiabilidade rápido demais?") não se
aplica da mesma forma: o "orçamento" relevante aqui é o piso duro em CI —
viola, o merge não acontece. Não há gradação intermediária porque não há
tráfego de produção para amortecer uma regressão pequena.

## Se um componente server-side entrar no escopo

O único candidato hoje é o próprio `nylla-gateway`, que é outro repositório
com sua própria política. Se este repositório algum dia ganhar um componente
que roda continuamente (o modo servidor sobre socket é non-goal declarado na
spec, ver [`.specs/nycode-rs/spec.md`](../.specs/nycode-rs/spec.md#fora-de-escopo)),
este documento precisa de SLO de disponibilidade e latência de verdade, com
burn-rate alerting per `standard/GATES.md` seção F do padrão externo — não
antes, porque escrever um SLO para um serviço que não existe é ficção
operacional.
