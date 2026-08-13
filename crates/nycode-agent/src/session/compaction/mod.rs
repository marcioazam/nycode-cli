//! Compactação de histórico.
//!
//! Quando o gateway responde que o prompt excedeu a janela, a alternativa a
//! compactar é abortar a tarefa no meio. A regra que guia o corte: preservar o
//! pedido original e os turnos recentes, e nunca separar uma chamada de
//! ferramenta do resultado dela.

use nycode_ai::anthropic::{ContentBlock, Message, Role};

/// Quantos turnos recentes preservar intactos.
pub const DEFAULT_KEEP_RECENT: usize = 6;

/// Marcador inserido no lugar do que foi removido.
const ELISION: &str = "[historico anterior compactado para caber na janela de contexto; \
     as decisoes ja tomadas continuam valendo]";

/// Resultado de uma compactação.
#[derive(Debug, Clone, PartialEq)]
pub struct Compacted {
    pub messages: Vec<Message>,
    /// Quantas mensagens saíram.
    pub removed: usize,
}

/// Reduz o histórico preservando o pedido original e os turnos recentes.
///
/// Retorna `None` quando não há o que compactar — o chamador precisa distinguir
/// "compactei" de "já está no mínimo", porque no segundo caso repetir a
/// requisição vai falhar de novo e insistir seria um laço infinito.
#[must_use]
pub fn compact(messages: &[Message], keep_recent: usize) -> Option<Compacted> {
    // O primeiro turno do usuario e a tarefa. Perde-lo faz o agente esquecer o
    // que estava fazendo, que e pior que estourar a janela.
    let head = 1;
    if messages.len() <= head + keep_recent + 1 {
        return None;
    }

    let mut cut = messages.len() - keep_recent;
    // Nunca cortar entre um `tool_use` e o `tool_result` correspondente: o
    // backend recusa uma conversa que referencia um id sem origem.
    while cut < messages.len() && starts_with_tool_result(&messages[cut]) {
        cut += 1;
    }
    if cut <= head {
        return None;
    }

    let mut out = Vec::with_capacity(keep_recent + 2);
    out.push(messages[0].clone());
    out.push(Message::user(ELISION));
    out.extend_from_slice(&messages[cut..]);

    Some(Compacted {
        removed: cut - head,
        messages: out,
    })
}

/// Se a mensagem abre com um resultado de ferramenta.
fn starts_with_tool_result(message: &Message) -> bool {
    message.role == Role::User
        && matches!(
            message.content.first(),
            Some(ContentBlock::ToolResult { .. })
        )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn conversation(turns: usize) -> Vec<Message> {
        (0..turns)
            .map(|i| {
                if i % 2 == 0 {
                    Message::user(format!("pedido {i}"))
                } else {
                    Message::assistant(vec![ContentBlock::text(format!("resposta {i}"))])
                }
            })
            .collect()
    }

    #[test]
    fn a_short_conversation_is_left_alone() {
        // Compactar aqui destruiria contexto sem ganho.
        assert!(compact(&conversation(4), DEFAULT_KEEP_RECENT).is_none());
    }

    #[test]
    fn the_original_task_always_survives() {
        // Perder o primeiro turno faz o agente esquecer o que estava fazendo,
        // que e pior que estourar a janela.
        let messages = conversation(30);
        let result = compact(&messages, DEFAULT_KEEP_RECENT).unwrap();
        assert_eq!(result.messages[0], messages[0]);
    }

    #[test]
    fn the_recent_turns_survive_intact() {
        let messages = conversation(30);
        let result = compact(&messages, 6).unwrap();
        assert_eq!(
            &result.messages[result.messages.len() - 6..],
            &messages[24..]
        );
    }

    #[test]
    fn an_elision_marker_replaces_what_was_dropped() {
        // Sem o marcador o modelo ve um salto inexplicavel e pode repetir
        // trabalho ja feito.
        let result = compact(&conversation(30), 6).unwrap();
        let marker = serde_json::to_string(&result.messages[1]).unwrap();
        assert!(marker.contains("compactado"));
    }

    #[test]
    fn compaction_actually_shrinks_the_conversation() {
        let messages = conversation(40);
        let result = compact(&messages, 6).unwrap();
        assert!(result.messages.len() < messages.len());
        assert_eq!(result.removed, messages.len() - 6 - 1);
    }

    #[test]
    fn a_tool_result_is_never_separated_from_its_call() {
        // Cortar entre os dois faz o backend receber um `tool_use_id` sem origem
        // e recusar a conversa inteira.
        let mut messages = conversation(20);
        messages.push(Message::assistant(vec![ContentBlock::ToolUse {
            id: "t1".to_owned(),
            name: "read".to_owned(),
            input: json!({}),
        }]));
        messages.push(Message::tool_results(vec![ContentBlock::tool_result(
            "t1", "ok",
        )]));
        messages.extend(conversation(4));

        // `keep_recent` cairia exatamente sobre o tool_result.
        let result = compact(&messages, 5).unwrap();
        let first_kept = &result.messages[2];
        assert!(
            !starts_with_tool_result(first_kept),
            "o corte separou um resultado da chamada dele"
        );
    }

    #[test]
    fn returning_none_lets_the_caller_avoid_an_infinite_retry_loop() {
        // Se compactar sempre "funcionasse", um prompt que ja esta no minimo
        // entraria em laco: falha, compacta, falha igual, compacta de novo.
        let minimal = conversation(3);
        assert!(compact(&minimal, DEFAULT_KEEP_RECENT).is_none());
    }

    #[test]
    fn keeping_zero_recent_still_preserves_the_task_and_the_marker() {
        let result = compact(&conversation(30), 0).unwrap();
        assert_eq!(result.messages.len(), 2);
    }
}
