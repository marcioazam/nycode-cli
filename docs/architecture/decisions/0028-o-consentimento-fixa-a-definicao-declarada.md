# ADR-0028: O consentimento fixa a definição declarada, e não só o que é executado

- **Status:** aceito
- **Data:** 2026-08-13
- **Contexto relacionado:** [ADR-0016](0016-extensao-do-workspace-exige-consentimento.md);
  [`spec.md`](../../../.specs/nycode-rs/spec.md) FR-7;
  [spec 002](../../specs/002-paridade-e-sota-2026/spec.md) FR-20

## Contexto

O [ADR-0016](0016-extensao-do-workspace-exige-consentimento.md) exige
consentimento registrado antes de o workspace executar um servidor MCP ou um
hook, e fixa a impressão digital do que será executado: a linha de comando para o
servidor, o conteúdo do executável para o hook. A intenção declarada era fechar o
rug pull — o workspace que troca o executável depois de o usuário ter dito sim.

Isso fecha metade do problema, e a metade que fica aberta é a que o ataque usa.

Um servidor MCP não é perigoso apenas pelo que executa. Ele declara, no handshake,
o nome, a descrição e o schema de cada ferramenta que oferece, e **essa declaração
entra no contexto do modelo**. A descrição é revisada uma vez, no momento da
conexão; nada volta a revisá-la. Um servidor que passou pelo consentimento com uma
descrição honesta pode declarar outra na sessão seguinte, sem que a linha de
comando mude em um byte — a impressão digital do ADR-0016 continua batendo.

A taxonomia da OWASP nomeia exatamente essa lacuna entre o momento da conexão e o
momento da chamada como a causa-raiz do envenenamento de ferramenta, e o próprio
protocolo aconselha tratar saída de servidor como não confiável sem obrigar
validação. O controle correspondente é fixar a definição na aprovação e alertar em
qualquer desvio.

A referência não oferece precedente aqui: ela não tem cliente MCP.

## Decisão

O consentimento fixa também a definição que o servidor declara — nome, descrição
e schema de cada ferramenta —, e não apenas a linha de comando que o inicia.
Definição diferente da consentida revalida o consentimento antes da próxima
chamada.

Restrições:

- **A impressão digital cobre o conjunto declarado, não cada ferramenta
  isoladamente.** Acrescentar uma ferramenta é uma mudança tanto quanto alterar a
  descrição de uma existente: uma ferramenta nova entra no contexto do modelo com
  a mesma autoridade das outras.
- **A revalidação acontece antes da primeira chamada, não depois.** Uma descrição
  não consentida que já entrou no contexto do modelo já surtiu o efeito que o
  controle existe para impedir.
- **Sem interlocutor, nega e degrada**, como o ADR-0016 já estabelece para o
  consentimento inicial e como o `connect_all` já faz por servidor. Um servidor
  cuja definição mudou fica de fora da sessão com aviso, e a sessão continua.
- **O registro continua fora do workspace.** Um workspace que pudesse editar o
  registro de consentimento se autoconsentiria.

## Consequências

Positivas: fecha a metade do rug pull que o ADR-0016 deixou aberta, e fecha-a no
único ponto em que dá para fechar sem inspecionar semântica — a comparação é de
igualdade, não de julgamento sobre se a descrição nova é maliciosa.

Negativas: um servidor que evolui legitimamente pede consentimento de novo a cada
release, e a fadiga de aprovação é real. Não há como distinguir evolução de
ataque por comparação estrutural, e tentar distinguir seria substituir um controle
verificável por uma heurística. O custo recai sobre o caso comum para cobrir o
caso raro, que é a troca que a segurança faz.

Um segundo custo: a definição só é conhecida depois do handshake, então a
revalidação acontece com o processo do servidor já rodando. O confinamento do
[ADR-0017](0017-duas-politicas-de-confinamento.md) é o que torna isso aceitável —
o servidor sobe confinado antes de qualquer decisão sobre a definição dele.

Descartadas: **comparar só nome e schema, ignorando a descrição**, rejeitado
porque a descrição é justamente o campo que o ataque usa: ela é texto livre que
entra no contexto do modelo e não tem forma verificável. **Alertar sem
revalidar**, rejeitado porque um aviso que não bloqueia é lido como ruído na
terceira vez. **Recusar servidor cuja definição mude**, rejeitado porque
transformaria toda atualização legítima numa reconfiguração manual.

## Revisão

Reabrir se o protocolo passar a oferecer assinatura de definição por publicador,
momento em que a comparação estrutural vira redundante e a verificação passa a ser
criptográfica. Reabrir também se a fadiga de revalidação se mostrar alta na
prática — o sinal a observar é usuários mantendo servidores desligados para não
lidar com o prompt, e a ação padrão seria fixar por versão declarada em vez de por
conteúdo, com a versão sendo parte do que o consentimento cobre.
