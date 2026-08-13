//! Quando e como o histórico encolhe.
//!
//! Separado do laço porque muda por outro motivo: [`super`] muda quando muda a
//! forma de um turno, isto muda quando muda o que se faz com um contexto que
//! não cabe mais. As duas decisões vivem juntas aqui — se vale encolher, e o
//! que o modelo leva do que foi embora.

use futures_util::StreamExt as _;
use nycode_ai::anthropic::Message;

use super::Agent;
use crate::error::Error;
use crate::turn::Turn;

/// Quantas vezes um mesmo pedido pode ser compactado antes de desistir.
///
/// A compactação converge sozinha — depois da primeira o histórico já está no
/// mínimo e `compact` devolve `None` —, mas um teto explícito é o que garante
/// que um gateway respondendo estouro a qualquer pedido não faça o agente
/// compactar até esquecer a tarefa.
const MAX_COMPACTIONS: usize = 2;

/// Se vale compactar o histórico em resposta a este erro.
///
/// Só estouro de janela, e só até o teto: um gateway que responde estouro a
/// qualquer pedido faria o agente compactar até esquecer a tarefa.
pub(super) fn should_compact(err: &Error, already: usize) -> bool {
    already < MAX_COMPACTIONS && matches!(err, Error::Wire(wire) if wire.is_context_overflow())
}

/// Se ainda cabe uma compactação neste pedido.
pub(super) const fn may_compact(already: usize) -> bool {
    already < MAX_COMPACTIONS
}

/// Estouro de janela que o provider reportou sem erro nenhum (FR-5).
///
/// Os dois casos chegam como sucesso — status 200, stream bem formado, nada
/// para [`should_compact`] olhar — e é isso que os torna caros: o harness os
/// entrega ao usuário como resposta. Ficam separados porque o que se faz com
/// eles é oposto.
#[derive(Debug, PartialEq, Eq)]
pub(super) enum SilentOverflow {
    /// Parou no limite sem emitir nada.
    ///
    /// Só acontece quando o prompt ocupou a janela inteira e não sobrou espaço
    /// para gerar. Não há resposta a preservar, então o turno se refaz.
    ProducedNothing,
    /// O usage declara entrada acima da janela do modelo.
    ///
    /// O provider truncou o começo da conversa e respondeu assim mesmo. A
    /// resposta existe e vale, mas o próximo turno seria truncado igual.
    InputAboveWindow { input: u64, window: u64 },
}

/// Lê um turno concluído em busca de estouro que não veio como erro.
///
/// `window` é `None` enquanto o catálogo não declara a janela do modelo, e aí
/// só o primeiro caso é detectável: comparar usage com um número chutado
/// acusaria truncamento onde não houve.
pub(super) fn silent_overflow(
    stop_reason: &nycode_ai::StopReason,
    produced_nothing: bool,
    input_tokens: u64,
    window: Option<u64>,
) -> Option<SilentOverflow> {
    // Parar no limite **com** texto é outro defeito: a resposta veio truncada,
    // e compactar o histórico não a completa. Só a saída vazia diz que foi a
    // entrada que não coube.
    if produced_nothing && matches!(stop_reason, nycode_ai::StopReason::MaxTokens) {
        return Some(SilentOverflow::ProducedNothing);
    }
    match window {
        Some(window) if input_tokens > window => Some(SilentOverflow::InputAboveWindow {
            input: input_tokens,
            window,
        }),
        _ => None,
    }
}

impl Agent {
    /// Quantos turnos recentes a compactação preserva intactos.
    ///
    /// Um repositório de arquivos grandes precisa preservar menos para caber, e
    /// um de conversa longa precisa preservar mais para não esquecer. Só quem o
    /// usa sabe qual é o caso, e por isso o número sai do binário.
    #[must_use]
    pub const fn with_keep_recent(mut self, keep_recent: usize) -> Self {
        self.keep_recent = keep_recent;
        self
    }

    /// Declara a janela de contexto do modelo atual.
    ///
    /// Sem ela o agente não tem como perceber que o provider truncou a entrada
    /// e respondeu assim mesmo — o caso do FR-5 em que não há erro nenhum para
    /// olhar.
    #[must_use]
    pub const fn with_context_window(mut self, window: u64) -> Self {
        self.context_window = Some(window);
        self
    }

    /// Troca a janela declarada, ao trocar de modelo no meio da sessão.
    ///
    /// Manter a janela do modelo anterior compararia o usage do novo contra o
    /// limite do antigo, que é como o número certo produz a conclusão errada.
    pub const fn set_context_window(&mut self, window: Option<u64>) {
        self.context_window = window;
    }

    /// A janela declarada para o modelo atual, quando há uma.
    ///
    /// Existe para que quem montou a sessão possa conferir que a janela do
    /// catálogo chegou até aqui. É a verificação que a spec 002 acrescenta —
    /// sobre chamador de produção, e não sobre linha executada.
    #[must_use]
    pub const fn context_window(&self) -> Option<u64> {
        self.context_window
    }

    /// Compacta agora, a pedido do usuário.
    ///
    /// Devolve zero quando não há o que cortar, em vez de fingir que cortou.
    pub async fn compact_now(&mut self) -> usize {
        self.compact_history().await.unwrap_or(0)
    }

    /// Compacta o histórico, devolvendo quantas mensagens saíram.
    pub(super) async fn compact_history(&mut self) -> Option<usize> {
        let summary = self.summarize_dropped().await;
        let compacted = crate::session::compaction::compact_with(
            &self.messages,
            self.keep_recent,
            summary.as_deref(),
        )?;
        self.messages = compacted.messages;
        Some(compacted.removed)
    }

    /// Pede ao modelo um resumo do trecho que a compactação vai descartar.
    ///
    /// `None` sempre que não der certo, e isso é o desenho e não a exceção:
    /// compactar acontece quando a janela estourou, que é exatamente quando uma
    /// chamada a mais tem a maior chance de falhar. O marcador com as listas de
    /// arquivos vale por si; o resumo é o que se acrescenta quando dá.
    async fn summarize_dropped(&self) -> Option<String> {
        use crate::session::compaction::SUMMARY_PROMPT;

        let dropped = crate::session::compaction::dropped(&self.messages, self.keep_recent)?;
        let mut messages = dropped.to_vec();
        messages.push(Message::user(SUMMARY_PROMPT));

        // Sem ferramenta e fora da conversa: quem pede um resumo não quer que o
        // modelo vá ler arquivo, e o pedido não é prefixo do turno seguinte.
        let mut stream = self.backend.oneshot(messages, None).await.ok()?;

        let mut turn = Turn::new();
        while let Some(event) = stream.next().await {
            // Um resumo pela metade ainda diz onde a conversa estava; abortar
            // por um erro no meio do stream jogaria fora o que já chegou.
            let Ok(event) = event else { break };
            turn.absorb(event);
        }

        let text = turn.text().trim().to_owned();
        (!text.is_empty()).then_some(text)
    }
}
