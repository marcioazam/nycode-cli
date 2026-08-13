# ADR-0027: A compactação dispara por limiar, e o erro passa a ser a rede de segurança

- **Status:** aceito
- **Data:** 2026-08-13
- **Contexto relacionado:** [`spec.md`](../../../.specs/nycode-rs/spec.md) FR-14;
  [spec 002](../../specs/002-paridade-e-sota-2026/spec.md) FR-8, FR-9, FR-10

## Contexto

A compactação atual dispara num lugar só: quando o pedido falha por contexto
excedido. O gatilho está em [`shrink.rs`](../../../crates/nycode-agent/src/agent/shrink.rs)
e depende de `is_context_overflow`. Duas consequências decorrem disso.

A primeira é que **todo turno que precisa compactar custa um pedido perdido**. O
usuário espera a latência inteira de um turno que já estava condenado, e o
provider cobra a entrada dele. Numa sessão longa isso acontece repetidamente, e o
NFR-7 piora junto: o pedido que falha é o mesmo que teria acertado o cache.

A segunda é mais grave e menos visível. O reconhecimento do erro cobre dois
padrões de texto, e há providers que não falham em contexto excedido — aceitam e
devolvem sucesso com a entrada somada acima da janela, ou truncam a entrada e
param por limite com saída vazia. Nesses casos o gatilho nunca dispara, e a
sessão degrada em silêncio até parar de funcionar sem explicação.

A retenção também é por contagem: seis mensagens. Uma contagem fixa não tem
relação com ocupação — seis mensagens curtas retêm pouco de um contexto cheio,
e seis mensagens com resultado de ferramenta grande podem sozinhas estourar a
janela que a compactação deveria aliviar.

A referência dispara por limiar de ocupação com reserva e cauda medidas em
tokens, e produz um resumo de seções nomeadas com um marcador que carrega a
cauda retida — de modo que reconstruir o contexto nunca precisa ler o que veio
antes do marcador.

## Decisão

A compactação dispara por limiar de ocupação do contexto, antes de o pedido ser
enviado. O gatilho por erro permanece, rebaixado a rede de segurança.

Restrições:

- **A ocupação é medida em tokens**, ancorada no último usage real reportado pelo
  provider e estimando apenas a cauda posterior a ele. Estimar o histórico
  inteiro quando há medição disponível troca um número certo por um aproximado.
- **O marcador de compactação é autocontido.** Ele carrega a cauda retida, e a
  reconstrução do contexto para no marcador. Um marcador que dependesse de ler o
  histórico anterior faria a compactação economizar armazenamento e não contexto,
  que é o oposto do objetivo.
- **A transformação de mensagem precede a compactação.** Compactar um histórico
  que ainda contém chamada de ferramenta órfã produz um resumo que descreve um
  estado que nunca existiu.
- **O resumo tem seções nomeadas e fixas.** Um resumo em prosa livre varia de
  turno para turno e torna o próprio prefixo instável, contra o NFR-7.
- **O corte nunca cai entre uma chamada de ferramenta e o resultado dela.**
  Restrição que o desenho atual já respeita e que continua valendo.

## Consequências

Positivas: o turno perdido some do caminho comum. Os providers que reportam
contexto excedido sem erro deixam de degradar em silêncio, porque o limiar não
depende de erro nenhum. E a retenção passa a ter relação com o que ela deveria
controlar.

Negativas: o limiar depende de a janela do modelo estar declarada no catálogo, e
um modelo que não a declara volta ao comportamento antigo — o erro como único
gatilho. A estimativa da cauda é aproximada por construção, então o limiar dispara
um pouco cedo ou um pouco tarde; a reserva existe para absorver isso, e reserva é
contexto que o usuário não usa. E compactar antes de precisar significa que
algumas sessões compactam sem que fosse necessário.

Descartadas: **manter só o gatilho por erro e ampliar o reconhecimento**,
rejeitado porque resolve a degradação silenciosa e não o turno perdido, e porque
depende de casar texto de mensagem de erro — um contrato que nenhum provider
promete. **Compactar a cada N turnos**, rejeitado porque N não tem relação com
ocupação. **Resetar o contexto com artefato de handoff em vez de compactar**,
não rejeitado e sim adiado: é a questão em aberto que o
[`research-sota-2026.md`](../../../.specs/nycode-rs/research-sota-2026.md) já
registrava, e resolvê-la exige medir a compactação correta primeiro.

## Revisão

Reabrir quando a gestão de contexto no servidor do provider estiver disponível em
mais de um provider — a ação padrão então é delegar a compactação ao servidor
onde ele a oferecer, mantendo a local como caminho para os demais. Reabrir também
se a ansiedade de contexto se mostrar presente mesmo com a compactação por
limiar, momento em que o reset com artefato de handoff volta à mesa.
