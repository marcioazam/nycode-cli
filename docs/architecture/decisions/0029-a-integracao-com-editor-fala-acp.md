# ADR-0029: A integração com editor fala ACP, e não um protocolo próprio

- **Status:** aceito
- **Data:** 2026-08-13
- **Contexto relacionado:** [`spec.md`](../../../.specs/nycode-rs/spec.md) FR-12, FR-21;
  [spec 002](../../specs/002-paridade-e-sota-2026/spec.md) FR-26

## Contexto

O FR-12 entrega três modos de saída, e o terceiro — stream de eventos
estruturados em NDJSON — atende quem integra o binário. Ele é unidirecional: o
integrador lê eventos e não tem canal de volta. Um editor precisa do canal de
volta para cancelar, para responder a um pedido de permissão, para trocar de
modelo no meio da sessão.

A referência resolveu isso duas vezes. Primeiro com um modo RPC sobre entrada e
saída padrão, com trinta e um comandos e um protocolo bidirecional de interface —
que funciona e é inteiramente próprio. Depois com uma pilha de sessão remota em
CBOR sobre socket de domínio Unix, com pacotes de protocolo, servidor e cliente —
que **nada instancia dentro do próprio projeto dela**, cujo pacote de servidor
declara no manifesto que pode ser removido sem aviso, e que não implementa padrão
externo nenhum.

O não-escopo desta spec já recusava a segunda, pelo motivo certo. O que mudou
desde então foi a primeira: escrever protocolo próprio para falar com editor
deixou de ser a única rota. O Agent Client Protocol tem adoção em mais de vinte
agentes, registry desde janeiro de 2026, implementação nativa numa família de
IDEs, e SDK em Rust com release recente. A superfície obrigatória de um agente
são quatro métodos mais uma notificação, e o protocolo reutiliza as
representações JSON do MCP onde pode — o que este repositório já fala.

O ponto que decide o custo: o `Observer` de
[`agent.rs`](../../../crates/nycode-agent/src/agent.rs) já é a costura por onde o
sink NDJSON observa o turno. Um servidor ACP é outro sink na mesma costura, e não
uma superfície nova de agente.

## Decisão

A integração com editor é o Agent Client Protocol sobre entrada e saída padrão.
Não há protocolo próprio de editor neste repositório.

Restrições:

- **Subprocesso local, sempre.** O editor lança o binário e conversa por entrada
  e saída padrão. Não há socket escutando, e portanto não há decisão de
  autenticação de rede — que é exatamente o que o não-escopo de sessão remota
  exige que venha junto se um dia houver.
- **O servidor ACP é um sink sobre o `Observer` existente**, não uma segunda
  implementação do loop. Duas implementações divergem, e a divergência aparece
  como bug de um cliente só.
- **O NDJSON do FR-12 permanece.** Ele atende integração por pipe, que é caso de
  uso diferente e mais simples; ACP não o substitui.

## Consequências

Positivas: o binário entra em vários editores sem escrever uma integração por
editor, que é o custo que tornava a integração de editor um não-escopo. E adotar
padrão governado por consórcio, em vez de protocolo próprio, é escolher a rota de
saída — o mesmo raciocínio que levou este repositório a MCP e a AGENTS.md.

Negativas: adotar padrão externo é aceitar o cronograma de outro. O protocolo
evolui, e acompanhar é trabalho recorrente que um protocolo próprio não teria. O
editor de maior circulação do mercado não adotou o ACP e padronizou em outro
protocolo, então a cobertura não é universal — este ADR compra várias famílias de
editor, não todas.

Um custo menos óbvio: o `Observer` hoje serve dois consumidores que renderizam,
e um terceiro que negocia. Se a negociação exigir do `Observer` mais do que ele
expõe, a pressão será alargar o trait — e um trait que cresce para atender um
cliente específico deixa de ser costura e vira acoplamento.

Descartadas: **portar o modo RPC da referência**, rejeitado porque seria escrever
protocolo próprio quando existe padrão com adoção, e porque nos amarraria a
acompanhar as mudanças de contrato de um projeto que declara não preservar
compatibilidade. **Portar a pilha CBOR da referência**, rejeitada por dois
motivos independentes: o não-escopo de sessão remota, e o fato de ser código que
o próprio autor não instancia. **Esperar o transporte remoto do ACP amadurecer**,
rejeitado porque o modo subprocesso local já é o que os editores usam hoje, e
esperar entregaria zero para ganhar uma capacidade que o não-escopo recusa de
qualquer forma.

## Revisão

Reabrir se o ACP fragmentar — se um segundo protocolo de cliente de agente ganhar
adoção comparável, a decisão vira qual dos dois falar, ou os dois. Reabrir também
se o transporte remoto do ACP amadurecer, momento em que a decisão de sessão
remota volta à mesa junto com a de autenticação, como o não-escopo exige. E
reabrir se o trait `Observer` precisar crescer para servir o ACP: nesse caso a
resposta correta é provavelmente uma costura própria para negociação, não um
`Observer` maior.
