//! Ajustes de conteúdo ao que o modelo atual aceita.

use nycode_ai::anthropic::{ContentBlock, Message};

/// O que substitui uma imagem quando o modelo não declara visão.
const OMITTED: &str = "(imagem omitida: o modelo nao aceita imagens)";

/// Tira do fio as imagens que o modelo não aceita.
///
/// Mandá-las a um modelo só-texto faz o provedor recusar o pedido inteiro.
/// O histórico guarda o anexo; o envio vira texto, e anexos seguidos viram
/// um marcador só — o modelo não precisa de um por frame.
#[must_use]
pub(crate) fn images(messages: &[Message], vision: bool) -> Vec<Message> {
    if vision {
        return messages.to_vec();
    }
    messages.iter().map(without_images).collect()
}

fn without_images(message: &Message) -> Message {
    let mut content = Vec::with_capacity(message.content.len());
    let mut omitted = false;
    for block in &message.content {
        match block {
            ContentBlock::Image { .. } => {
                if !omitted {
                    content.push(ContentBlock::text(OMITTED));
                    omitted = true;
                }
            }
            other => {
                omitted = false;
                content.push(other.clone());
            }
        }
    }
    Message {
        role: message.role,
        content,
        discarded: message.discarded,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nycode_ai::anthropic::Role;

    fn picture() -> ContentBlock {
        ContentBlock::image("image/png", "QUJD")
    }

    #[test]
    fn a_vision_model_keeps_the_image_on_the_wire() {
        let history = vec![Message::user_blocks(vec![
            picture(),
            ContentBlock::text("o que e isto?"),
        ])];
        assert_eq!(images(&history, true), history);
    }

    #[test]
    fn a_text_only_model_does_not_receive_the_image() {
        let history = vec![Message::user_blocks(vec![
            picture(),
            ContentBlock::text("o que e isto?"),
        ])];
        let sent = images(&history, false);
        assert_eq!(sent.len(), 1);
        assert_eq!(sent[0].role, Role::User);
        assert!(
            sent[0]
                .content
                .iter()
                .all(|b| !matches!(b, ContentBlock::Image { .. })),
            "imagem no fio: {:?}",
            sent[0].content
        );
        assert!(
            sent[0]
                .content
                .iter()
                .any(|b| matches!(b, ContentBlock::Text { text } if text.contains("omitida"))),
            "{:?}",
            sent[0].content
        );
    }

    #[test]
    fn consecutive_images_become_a_single_placeholder() {
        let history = vec![Message::user_blocks(vec![
            picture(),
            picture(),
            ContentBlock::text("compare"),
        ])];
        let sent = images(&history, false);
        let texts: Vec<_> = sent[0]
            .content
            .iter()
            .filter_map(|b| match b {
                ContentBlock::Text { text } => Some(text.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(texts, [OMITTED, "compare"]);
    }

    #[tokio::test]
    async fn a_text_only_model_does_not_put_the_image_on_the_wire() {
        use std::sync::Arc;

        use crate::agent::{Agent, Silent};
        use crate::backend::fake::FakeBackend;

        let (_dir, ctx) = crate::agent_test::workspace();
        let backend = Arc::new(FakeBackend::new(vec![crate::agent_test::text_turn("ok")]));
        let mut agent = Agent::new(backend.clone(), ctx).with_vision(false);
        agent.set_history(vec![Message::user_blocks(vec![
            picture(),
            ContentBlock::text("o que e isto?"),
        ])]);
        agent.run("continua", &mut Silent).await.unwrap();

        let sent = backend.last_messages();
        assert!(
            sent.iter()
                .flat_map(|m| m.content.iter())
                .all(|b| !matches!(b, ContentBlock::Image { .. })),
            "imagem no fio: {sent:?}"
        );
        assert!(
            sent.iter()
                .flat_map(|m| m.content.iter())
                .any(|b| matches!(b, ContentBlock::Text { text } if text.contains("omitida"))),
            "{sent:?}"
        );
    }
}
