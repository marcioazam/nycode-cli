# spec — paridade com a referência e elevação a SOTA 2026

WHAT e WHY apenas. O COMO está no [`plan.md`](plan.md) e nos ADRs que ele cita.
A spec do produto é [`.specs/nycode-rs/spec.md`](../../../.specs/nycode-rs/spec.md);
esta feature endurece FR-3, FR-7, FR-8, FR-12, FR-13, FR-19 e NFR-4, NFR-6 e
NFR-7 do produto, e acrescenta uma superfície nova.

## Problema

O NFR-6 obriga que qualquer comportamento observável divergente da referência
seja decisão registrada, e não acidente. O instrumento que deveria detectar isso
— o [`nycode-parity`](../../../crates/nycode-parity/) — **nunca rodou contra a
referência**: o [`README.md`](../../../README.md) diz "não medido sem gateway", e
o [`parity-gate.sh`](../../../scripts/parity-gate.sh) sai com zero quando o
gateway não está configurado. A consequência é que o NFR-6 vale para as
divergências que alguém percebeu, e não para as que existem.

Uma auditoria dos dois códigos lado a lado mostrou o custo disso. Encontrou
sessenta deltas, e o problema não é o tamanho da lista: é que **oito deles são
capacidades que este repositório declara ter e não tem**. O caso limite é o
controle de raciocínio. O tipo `Sampling` carrega `thinking_budget`,
`temperature`, `top_p` e `stop_sequences`; `Client::with_sampling` existe para
configurá-lo; e nenhum dos dois tem um único chamador fora de teste. Os dois
dialetos OpenAI leem `sampling` apenas dentro de helpers `#[cfg(test)]` — a
função que monta o corpo do pedido nunca o consulta. Nível de raciocínio,
temperatura e sequência de parada são, hoje, código inalcançável.

O mesmo padrão se repete em sete outros lugares. O NFR-7 exige prefixo estável
para o cache de prompt acertar, e o `cache_control` só é emitido num dialeto de
três. O FR-19 promete troca de modelo no meio da sessão e custo visível: a troca
reenvia ao novo modelo blocos de raciocínio assinados por outro e chamadas de
ferramenta sem resposta, e "custo" é uma contagem de tokens — não há preço em
lugar nenhum do repositório. A compactação só dispara depois de o pedido falhar
por contexto excedido, e o reconhecimento desse erro cobre dois padrões de texto
quando a referência cobre vinte e quatro mais dois casos em que o provider
reporta sucesso.

O critério de aceite do produto já antecipava exatamente esta falha — "nenhum
requisito é declarado entregue em documento sem que o caminho de produção o
execute; um módulo implementado, testado e nunca chamado é pendência, não
entrega". A tabela de [`REQUIREMENTS.md`](../../requirements/REQUIREMENTS.md)
marca os vinte FRs como entregues.

Há um segundo problema, de direção. "Portar mais referência" é o alvo errado: a
referência declina por decisão o confinamento de sistema operacional, não tem
cliente MCP, não tem subagentes, e três dos seus dez pacotes são código que nada
instancia. Enquanto isso, o que virou base comum em 2026 e nenhum dos dois tem
— integração de editor por protocolo padronizado — é justamente o eixo em que
alcançar a referência não basta.

## Objetivo

Que cada capacidade declarada tenha caminho de produção que a execute, que a
divergência da referência passe a ser medida em vez de suposta, e que o binário
fale o protocolo que os editores de 2026 já falam.

## Requisitos funcionais

### Fidelidade do fio

- **FR-1** O usuário escolhe o nível de raciocínio do modelo, e o nível escolhido
  chega ao provider em qualquer dialeto que o suporte. Num modelo que não suporta
  o nível pedido, o pedido é rebaixado ao nível suportado mais próximo e isso é
  dito, nunca silenciado.
- **FR-2** Temperatura, top_p e sequências de parada configuradas chegam ao
  provider em qualquer dialeto que as aceite. Um dialeto que não aceita um
  parâmetro recusa a configuração em voz alta em vez de descartá-la.
- **FR-3** O cache de prompt é solicitado em todo dialeto que o suporte, cada um
  no mecanismo que o seu provider documenta.
- **FR-4** O custo acumulado da sessão é visível em moeda, não apenas em tokens,
  e o preço vem do catálogo descoberto — não é hardcoded.
- **FR-5** Um contexto excedido é reconhecido em qualquer dialeto, inclusive
  quando o provider o reporta sem erro: entrada acima da janela declarada, ou
  parada por limite com saída vazia.
- **FR-6** Uma falha transitória do provider é retentada com recuo; um limite de
  conta ou de cobrança não é retentado nenhuma vez.
- **FR-7** Texto que o provider não consegue serializar — par substituto UTF-16
  incompleto — não chega ao fio, e um fragmento de argumento de ferramenta
  malformado é reparado antes de virar erro de turno.

### Contexto e sessão

- **FR-8** A compactação dispara por limiar de ocupação do contexto antes de o
  pedido falhar, além de continuar disparando no erro.
- **FR-9** O resumo de compactação tem estrutura fixa e nomeada, e o marcador que
  ele deixa é autocontido: reconstruir o contexto a partir dele nunca precisa ler
  o que veio antes.
- **FR-10** Trocar de modelo no meio da sessão, ou retomar um ramo, não envia ao
  modelo material que ele não pode aceitar: turno interrompido por erro ou
  cancelamento, bloco de raciocínio assinado por outro modelo, chamada de
  ferramenta sem resposta, ou imagem para um modelo sem visão.
- **FR-11** Abandonar um ramo da árvore de sessão registra o que aconteceu nele.
- **FR-12** As instruções de projeto são lidas também dos diretórios ancestrais e
  do diretório de configuração do usuário, e um arquivo de override substitui as
  demais camadas naquele diretório sem afetar as outras.

### Ferramentas

- **FR-13** Várias substituições disjuntas no mesmo arquivo são uma chamada só.
- **FR-14** O comando de shell aceita prazo próprio, e quando a saída é cortada o
  restante continua alcançável.
- **FR-15** A leitura de um arquivo de imagem devolve a imagem, não um erro de
  binário.
- **FR-16** As buscas aceitam teto de resultados.
- **FR-17** Uma ferramenta pode encerrar o turno ao devolver seu resultado.
- **FR-18** O conjunto de ferramentas ativas é restringível por nome na invocação.
- **FR-19** A skill declara os campos que a especificação Agent Skills define, e
  uma skill pode se declarar não invocável pelo modelo.
- **FR-20** A definição que um servidor MCP declara é fixada no consentimento;
  mudança dela revalida o consentimento antes da próxima chamada.

### Superfície de comando

- **FR-21** O system prompt é substituível e acrescentável, por arquivo do
  projeto, por arquivo do usuário e por flag.
- **FR-22** A sessão pode ser nomeada, criada com identificador escolhido,
  bifurcada na invocação, importada de arquivo e inspecionada em estatísticas.
- **FR-23** O usuário executa um comando de shell a partir do editor, escolhendo
  se a saída vai ao modelo.
- **FR-24** A sessão se identifica ao comando de shell por variáveis de ambiente,
  e essa exposição é desligável.
- **FR-25** Um prompt reutilizável aceita a sintaxe completa de argumento: todos
  os argumentos, valor padrão e fatia.

### Integração e apresentação

- **FR-26** Um editor conversa com o `nycode` pelo Agent Client Protocol, sem
  adaptador de terceiro.
- **FR-27** O editor da sessão interativa completa comando, caminho e referência
  a arquivo, e localiza por correspondência aproximada.
- **FR-28** Uma colagem grande vira um marcador editável em vez de inundar o
  editor, e o histórico de edição pode ser desfeito.
- **FR-29** Os atalhos de teclado são remapeáveis por arquivo, e o tema é
  escolhível.
- **FR-30** O terminal recebe o que ele sabe mostrar: hiperlink, progresso na aba,
  cópia para a área de transferência e imagem, quando o terminal os suporta.

## Requisitos não-funcionais

- **NFR-1** A comparação de paridade contra a referência roda de fato num
  ambiente reproduzível, e o resultado dela é um artefato. Uma dimensão vazia dos
  dois lados é aprovação falsa e reprova o gate.
- **NFR-2** Nenhum requisito desta spec é marcado entregue enquanto o caminho de
  produção não o executar. Um símbolo público sem chamador fora de teste conta
  como pendência.

Herdados e sempre aplicáveis: startup, memória e tamanho de binário
(NFR-1 a NFR-3 do produto), fidelidade de wire (NFR-4), pisos de cobertura
(NFR-5), divergência registrada (NFR-6), prefixo estável (NFR-7) e segurança
antes de performance (NFR-8).

## Cenários

**Caminho feliz.** O usuário abre a sessão, pede raciocínio alto, trabalha contra
um dialeto OpenAI. O pedido carrega o esforço de raciocínio e a chave de cache;
o rodapé mostra tokens, acerto de cache e custo em moeda. Ao se aproximar do
limite da janela, a sessão compacta antes de falhar e diz o que reteve.

**Caminho de erro.** O usuário pede raciocínio máximo num modelo que só vai até
médio. O pedido sai com médio, e a sessão diz que rebaixou e por quê — em vez de
enviar um campo que o provider ignora ou rejeita.

**Caso de borda.** O usuário troca de modelo no meio de um turno que terminou com
uma chamada de ferramenta cancelada. O histórico enviado ao novo modelo tem um
resultado sintético no lugar da chamada órfã e os blocos de raciocínio do modelo
anterior convertidos em texto — o novo modelo recebe uma conversa que ele
consegue aceitar.

**Caso de borda.** Um servidor MCP consentido troca a descrição de uma ferramenta
entre duas sessões. A mudança revalida o consentimento antes da próxima chamada,
em vez de a nova descrição entrar no contexto por já ter havido um "sim".

## Fora de escopo

- **Exportação OTLP e observabilidade por spans.** É base comum em 2026 e a
  ausência é conhecida; fica registrada em [`plan.md`](plan.md) com o gatilho de
  reabertura.
- **Despacho paralelo de ferramentas.** O [ADR-0020](../../architecture/decisions/0020-o-despacho-de-ferramentas-e-sequencial.md)
  permanece em vigor, inclusive a admissão de que o desenho atual é pior que o da
  referência.
- **Gestão de contexto no servidor do provider** e carga diferida de definição de
  ferramenta.
- **Suíte de avaliação como gate de CI.**
- **Gerenciador de pacotes, auto-atualização, runtime de extensão TypeScript,
  exportação HTML, publicação de sessão, renderização LaTeX e Mermaid.**
- **A pilha de sessão remota da referência.** Nada a instancia lá dentro, e o
  não-escopo do produto já a recusa. FR-26 não a reabre: ACP é subprocesso local
  falando com um editor, não um servidor que escuta em socket.

## Critérios de aceite

- [ ] Dado um dialeto OpenAI e um nível de raciocínio escolhido, quando o turno é
      enviado, então o corpo do pedido carrega o esforço de raciocínio.
- [ ] Dado qualquer dialeto que suporte cache, quando dois turnos seguidos correm
      na mesma sessão, então o segundo reporta acerto de cache.
- [ ] Dado um catálogo com preço, quando o turno termina, então o custo em moeda
      aparece e bate com a contagem de tokens vezes a tarifa do modelo.
- [ ] Dada uma sessão perto do limite da janela, quando o próximo turno é
      enviado, então a compactação já ocorreu e o pedido não falhou por contexto.
- [ ] Dado um histórico com chamada de ferramenta órfã, quando o modelo é
      trocado, então o pedido enviado ao novo modelo tem resultado para toda
      chamada.
- [ ] Dado um editor que fala ACP, quando ele lança o `nycode`, então a sessão
      inicia e as atualizações de turno chegam ao editor.
- [ ] Dado um servidor MCP consentido cuja definição mudou, quando a sessão
      reabre, então o consentimento é pedido de novo antes de qualquer chamada.
- [ ] O harness de paridade roda contra a referência e produz artefato, com as
      cinco dimensões preenchidas dos dois lados.
- [ ] Nenhum símbolo público introduzido por esta spec fica sem chamador de
      produção.
- [ ] Nenhum marcador `[NEEDS CLARIFICATION]` permanece.

## Questões em aberto

Nenhuma. As duas que travavam o escopo foram resolvidas na elicitação e estão
registradas em [`plan.md`](plan.md).

---
Autor: · Status: aceito · Data: 2026-08-13
