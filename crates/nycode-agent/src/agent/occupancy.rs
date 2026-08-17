//! Ocupação do contexto em tokens, para o gatilho por limiar (ADR-0027).
//!
//! A âncora é o último usage real; só a cauda depois dele é estimada. Sem
//! janela no catálogo o limiar não dispara — o erro continua sendo a rede.

use nycode_ai::anthropic::{ContentBlock, Message};

/// Tokens reservados para a resposta. Igual à referência: o limiar é a janela
/// menos isto, para o turno ainda caber depois de compactar.
pub(crate) const RESERVE_TOKENS: u64 = 16_384;

/// Caracteres atribuídos a uma imagem na heurística, como na referência.
const IMAGE_CHARS: u64 = 4_800;

/// Tokens que o próximo pedido ocuparia.
///
/// `last` é `(tokens do usage, índice da mensagem que ele cobre)`. Sem âncora
/// válida estima o histórico inteiro — melhor cedo demais que estourar.
#[must_use]
pub(crate) fn occupancy(messages: &[Message], last: Option<(u64, usize)>) -> u64 {
    match last {
        Some((tokens, at)) if at < messages.len() => {
            tokens.saturating_add(tail(&messages[at + 1..]))
        }
        _ => tail(messages),
    }
}

/// Se o próximo pedido passa do limiar.
///
/// Sem janela declarada, nunca: o comportamento antigo, só o erro dispara.
#[must_use]
pub(crate) fn over_threshold(occupied: u64, window: Option<u64>) -> bool {
    window.is_some_and(|window| occupied > window.saturating_sub(RESERVE_TOKENS))
}

fn tail(messages: &[Message]) -> u64 {
    messages.iter().map(estimate).sum()
}

fn estimate(message: &Message) -> u64 {
    message
        .content
        .iter()
        .map(block_chars)
        .sum::<u64>()
        .div_ceil(4)
}

fn block_chars(block: &ContentBlock) -> u64 {
    match block {
        ContentBlock::Text { text } => text.len() as u64,
        ContentBlock::ToolUse { name, input, .. } => {
            name.len() as u64 + input.to_string().len() as u64
        }
        ContentBlock::ToolResult { content, .. } => content.len() as u64,
        ContentBlock::Image { .. } => IMAGE_CHARS,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nycode_ai::anthropic::{ContentBlock, Message};

    #[test]
    fn occupancy_uses_the_last_usage_and_only_estimates_the_tail() {
        let history = vec![
            Message::user("aaaa"),
            Message::assistant(vec![ContentBlock::text("bbbb")]),
            Message::user("cccc"),
        ];
        // Âncora cobre as duas primeiras; a cauda é "cccc" = 4 chars = 1 token.
        assert_eq!(occupancy(&history, Some((90, 1))), 91);
    }

    #[test]
    fn occupancy_without_an_anchor_estimates_the_whole_history() {
        let history = vec![
            Message::user("aaaa"),
            Message::assistant(vec![ContentBlock::text("bbbb")]),
        ];
        assert_eq!(occupancy(&history, None), 2);
    }

    #[test]
    fn a_stale_index_falls_back_to_estimating_everything() {
        let history = vec![Message::user("aa")];
        assert_eq!(occupancy(&history, Some((9_000, 3))), 1);
        // Índice igual ao comprimento: não é a última mensagem, é depois dela.
        assert_eq!(occupancy(&history, Some((9_000, 1))), 1);
    }

    #[test]
    fn a_tool_call_counts_name_and_arguments_together() {
        let history = vec![Message::assistant(vec![ContentBlock::ToolUse {
            id: "t1".into(),
            name: "read".into(),
            input: serde_json::json!({"path": "a.rs"}),
        }])];
        let chars = 4 + serde_json::json!({"path": "a.rs"}).to_string().len() as u64;
        assert_eq!(occupancy(&history, None), chars.div_ceil(4));
        assert_ne!(
            chars.div_ceil(4),
            (4 * serde_json::json!({"path": "a.rs"}).to_string().len() as u64).div_ceil(4)
        );
    }

    #[test]
    fn the_threshold_needs_a_declared_window() {
        assert!(!over_threshold(200_000, None));
        assert!(!over_threshold(100, Some(200_000)));
        assert!(over_threshold(190_000, Some(200_000)));
        // Janela menor que a reserva: qualquer ocupação dispara.
        assert!(over_threshold(1, Some(1_000)));
        assert!(!over_threshold(0, Some(1_000)));
    }

    #[test]
    fn an_image_is_counted_by_the_same_heuristic_as_the_reference() {
        let history = vec![Message::user_blocks(vec![ContentBlock::image(
            "image/png",
            "QUJD",
        )])];
        assert_eq!(occupancy(&history, None), IMAGE_CHARS.div_ceil(4));
    }

    fn long_history(agent: crate::agent::Agent, turns: usize) -> crate::agent::Agent {
        (0..turns).fold(agent, |agent, i| {
            if i % 2 == 0 {
                agent.with_message(Message::user(format!("pedido {i}")))
            } else {
                agent.with_message(Message::assistant(vec![ContentBlock::text(format!(
                    "resposta {i}"
                ))]))
            }
        })
    }

    #[tokio::test]
    async fn a_session_over_the_threshold_compacts_before_the_request() {
        use std::sync::Arc;

        use crate::agent::{Agent, Observer};
        use crate::backend::fake::FakeBackend;

        #[derive(Default)]
        struct Noticed {
            notices: Vec<String>,
        }
        impl Observer for Noticed {
            fn on_notice(&mut self, text: &str) {
                self.notices.push(text.to_owned());
            }
        }

        let (_dir, ctx) = crate::agent_test::workspace();
        let backend = Arc::new(FakeBackend::new(vec![crate::agent_test::text_turn("ok")]));
        let seeded = long_history(Agent::new(backend.clone(), ctx), 20);
        let at = seeded.history().len().saturating_sub(1);
        let mut agent = seeded
            .with_context_window(200_000)
            .with_usage_anchor(190_000, at);

        let mut noticed = Noticed::default();
        agent.run("e agora", &mut noticed).await.unwrap();
        assert!(
            noticed.notices.iter().any(|n| n.contains("limiar")),
            "avisos: {:?}",
            noticed.notices
        );

        let sent = backend.last_messages();
        assert!(
            sent.len() < 21,
            "historico inteiro no fio: {} mensagens",
            sent.len()
        );
        let dumped = serde_json::to_string(&sent).unwrap();
        assert!(dumped.contains("compactado"), "marcador ausente: {dumped}");
    }

    #[tokio::test]
    async fn a_model_without_a_window_does_not_compact_on_occupancy() {
        use std::sync::Arc;

        use crate::agent::{Agent, Silent};
        use crate::backend::fake::FakeBackend;

        let (_dir, ctx) = crate::agent_test::workspace();
        let backend = Arc::new(FakeBackend::new(vec![crate::agent_test::text_turn("ok")]));
        let seeded = long_history(Agent::new(backend.clone(), ctx), 20);
        let at = seeded.history().len().saturating_sub(1);
        let mut agent = seeded.with_usage_anchor(190_000, at);

        agent.run("e agora", &mut Silent).await.unwrap();

        assert_eq!(
            backend.last_messages().len(),
            21,
            "compactou sem janela: {:?}",
            backend.last_messages().len()
        );
    }
}
