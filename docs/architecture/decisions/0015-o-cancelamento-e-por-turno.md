# ADR-0015: O cancelamento é por turno, e cancelar termina o processo

- **Status:** aceito
- **Data:** 2026-08-13
- **Contexto relacionado:** [`spec.md`](../../../.specs/nycode-rs/spec.md) FR-4, NFR-4

## Contexto

FR-4 exige cancelar um turno sem corromper a sessão, e a parte difícil disso foi
resolvida: [`cancel.rs`](../../../crates/nycode-agent/src/cancel.rs) é
cooperativo justamente porque largar o future no meio de uma rodada deixaria um
`tool_use` sem `tool_result`, e uma sessão gravada assim é recusada na retomada.
Todo caminho de aborto fecha as chamadas pendentes.

O que nunca foi decidido é o **tempo de vida** do sinal. `Cancel` tem `cancel()`,
`is_cancelled()` e `cancelled()`, e nada que o devolva ao estado intacto — é um
latch de mão única. A sessão interativa cria um único sinal e o compartilha com
o agente por todos os turnos. A consequência é que o primeiro Ctrl+C inutiliza a
sessão em silêncio: o prompt seguinte é empilhado no histórico, o laço
curto-circuita antes de chamar o gateway, o cancelamento é mapeado para sucesso
e nada é impresso. O usuário digita, dá enter, não recebe resposta nem erro, e o
arquivo de sessão acumula mensagens nunca respondidas que voltam no `--continue`.
É NFR-4 violado da forma mais direta que existe, e nenhum teste pegou porque
todos os testes de cancelamento rodam um turno só.

O segundo problema tem a mesma raiz — o que "cancelar" significa nunca foi
fixado — e aparece no timeout do `bash`. A ferramenta responde `"comando excedeu
90s e foi interrompido"`, mas `tokio::time::timeout` apenas larga o future de
`.output()`, o que larga o `Child`, e o `Child` do tokio não mata no drop. O
processo continua rodando e escrevendo no workspace. O confinamento não salva:
`--die-with-parent` mata a subárvore quando o `nycode` morre, e o `nycode`
continua vivo. A ferramenta afirma uma ação que não aconteceu, que é a mesma
classe de degradação silenciosa vista pelo avesso.

## Decisão

**Um sinal por turno.** `Cancel` ganha `rearm()`, que devolve o sinal ao estado
intacto enviando pelo mesmo emissor. Como todas as pontas são clones do mesmo
`watch::Sender`, um rearme restaura sessão e agente de uma vez. A sessão
interativa rearma no topo de cada turno, antes de qualquer coisa entrar no
histórico. O modo headless não rearma porque tem um turno por processo.

**Largar o future termina o processo, e a mensagem diz o que foi terminado.** O
`bash` passa a marcar o comando com `kill_on_drop`, de modo que o término
aconteça em todo caminho que larga o future — e são dois, não um: o estouro de
prazo na própria ferramenta e o cancelamento no despacho, onde o `select!`
descarta a execução em curso. O que isso alcança depende do confinamento, e a
mensagem passa a refletir exatamente isso:

- Sob `bubblewrap`, o argv ganha `--unshare-pid`. O comando vira PID 1 de um
  namespace próprio, e matá-lo leva a subárvore junto. A mensagem afirma
  interrupção completa porque ela é completa.
- Sem confinamento, ou sob Seatbelt, o `kill` alcança o processo direto e netos
  podem sobreviver. A mensagem diz isso, com todas as letras.

Afirmar interrupção completa onde ela não é garantida seria repetir o defeito
que esta decisão corrige, com texto novo.

## Consequências

Positivas: Ctrl+C volta a ser o que FR-4 promete, uma interrupção de turno e não
o fim útil da sessão; o disco para de acumular prompt não respondido; e o
timeout do `bash` passa a produzir o efeito que anuncia, o que importa porque um
comando abandonado continuava escrevendo no workspace que o modelo estava
inspecionando. Atar o término ao drop cobre de graça o cancelamento de uma
ferramenta em curso, que antes deixava o mesmo órfão sem nem anunciar nada.

Negativas: `--unshare-pid` acrescenta um namespace por chamada de `bash` no
Linux, custo que entra no caminho quente de toda ferramenta de shell e que o
`perf-gate` não mede porque NFR-1 mede arranque, não execução de ferramenta. A
garantia de subárvore fica assimétrica entre plataformas — Linux confinado tem,
macOS e Linux sem `bwrap` não têm —, e a mensagem carrega essa assimetria até o
modelo, o que é honesto e é feio. E um rearme por turno significa que um Ctrl+C
que chegue na janela entre o rearme e o início do turno é perdido; o laço de
eventos é sequencial, então a janela não existe na prática, mas ela existe no
tipo.

Descartadas: **um `Cancel` novo a cada turno**, rejeitado porque exigiria
repropagar o sinal para dentro de um `Agent` já construído e para o caminho de
direcionamento, com as duas pontas obrigadas a concordar sobre qual é o sinal
corrente — o rearme sobre o emissor compartilhado obtém o mesmo efeito sem essa
sincronização. **Segurar o handle do filho e matá-lo explicitamente no braço de
estouro de prazo**, que foi a primeira forma desta decisão, rejeitado ao
implementar: exigiria reimplementar `Command::output` — que consome o handle —
com leitura concorrente das duas saídas, e ainda assim cobriria só o prazo. O
cancelamento no despacho não passa por braço nenhum; ele larga o future, e só um
término atado ao drop o alcança. **`libc::killpg` sobre um grupo de processos**,
que é o caminho usual para matar a subárvore, rejeitado porque `unsafe` é
`forbid` no workspace; a alternativa segura seria a crate `nix`, e acrescentar
dependência para cobrir só o caminho não confinado não se paga enquanto
`--unshare-pid` cobre o caso que o projeto recomenda.

## Revisão

Reabrir a rejeição do `nix` se o `bash` sem confinamento deixar de ser exceção —
hoje o [ADR-0005](0005-sandbox-de-so-por-processo-auxiliar.md) trata ausência de
confinamento como situação avisada e indesejada, e é isso que sustenta cobrir
menos ali. Reabrir o rearme por turno se o `nycode` algum dia rodar turnos
concorrentes na mesma sessão, caso em que um sinal compartilhado deixa de
distinguir qual turno cancelar e a saída passa a ser um sinal por turno de fato.
