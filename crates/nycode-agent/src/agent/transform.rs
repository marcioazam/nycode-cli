//! O histórico, ajustado ao que o provedor aceita receber de volta.
//!
//! Um `tool_use` sem o `tool_result` correspondente faz o provedor recusar o
//! pedido inteiro. O laço fecha os pendentes quando ele mesmo cancela um turno,
//! mas há dois caminhos que produzem o par quebrado sem passar por ali: retomar
//! um ponto anterior da árvore (FR-14), que pode cortar entre a chamada e o
//! resultado, e trocar de modelo no meio da sessão (FR-19), que reenvia o
//! histórico inteiro a outro backend.
//!
//! Os dois requisitos estão declarados entregues e produzem esse estado. Este
//! módulo é a costura que o conserta, e ele é puro de propósito: a correção é
//! decidível olhando só a sequência de mensagens.

use nycode_ai::StopReason;
use nycode_ai::anthropic::{ContentBlock, Message, Role};

use crate::tool::ToolCall;

/// O que um resultado sintético diz ao modelo.
///
/// Precisa explicar, e não só preencher: o modelo vai ler isto e decidir o que
/// fazer em seguida. "Sem resultado" o levaria a supor que a ferramenta rodou e
/// não devolveu nada, que é outra coisa.
const INTERRUPTED: &str = "A chamada foi interrompida antes de produzir resultado. \
     Nao presuma que ela teve efeito; verifique antes de seguir.";

/// Ajusta o histórico ao que o provedor aceita.
///
/// Três correções, todas necessárias para que um histórico retomado ou
/// trocado de modelo continue válido:
///
/// - turno que parou em erro ou cancelamento não é reenviado;
/// - toda chamada de ferramenta ganha um resultado, sintético quando falta;
/// - todo resultado sem chamada correspondente é descartado.
///
/// A terceira existe porque o corte pode cair do outro lado: um ramo retomado a
/// partir do resultado, sem a mensagem do assistente que o pediu, carrega um
/// `tool_result` que não referencia nada.
#[must_use]
pub fn for_provider(messages: &[Message]) -> Vec<Message> {
    let mut out: Vec<Message> = Vec::with_capacity(messages.len());
    let mut pending: Vec<String> = Vec::new();

    for message in messages {
        match message.role {
            Role::Assistant => {
                // Dois turnos de assistente seguidos com chamada aberta no
                // primeiro nao acontecem pelo laco, mas acontecem por corte de
                // arvore. Fechar antes mantem o par intacto.
                close(&mut out, &mut pending);
                if message.discarded {
                    // Parada de erro ou cancelamento: incompleto, o provedor
                    // recusa. O histórico guarda; o envio não.
                    continue;
                }
                pending = declared(message);
                out.push(message.clone());
            }
            Role::User => {
                let mut content = kept(message, &pending);
                for id in answered(&content) {
                    pending.retain(|open| *open != id);
                }

                if !pending.is_empty() {
                    if content.iter().any(is_result) {
                        // A mensagem ja e o turno de resultados; completa-la
                        // preserva o pareamento sem inserir mensagem nova.
                        content.extend(pending.drain(..).map(synthetic));
                    } else {
                        close(&mut out, &mut pending);
                    }
                }

                // Uma mensagem que ficou sem conteudo depois do descarte nao
                // pode ir: o provedor recusa conteudo vazio.
                if !content.is_empty() {
                    out.push(Message::user_blocks(content));
                }
            }
        }
    }

    close(&mut out, &mut pending);
    out
}

/// Monta o turno do assistente que entra no histórico.
///
/// `discarded` marca parada de erro ou cancelamento: o journal guarda o que o
/// usuário viu; [`for_provider`] não reenvia.
#[must_use]
pub(crate) fn assistant_turn(text: &str, calls: &[ToolCall], discarded: bool) -> Option<Message> {
    let mut content = Vec::new();
    if !text.is_empty() {
        content.push(ContentBlock::text(text));
    }
    for call in calls {
        content.push(ContentBlock::ToolUse {
            id: call.id.clone(),
            name: call.name.clone(),
            input: call.input.clone(),
        });
    }
    if content.is_empty() {
        return None;
    }
    Some(Message {
        role: Role::Assistant,
        content,
        discarded,
    })
}

/// Se este `stop_reason` é o que a referência não reenvia.
#[must_use]
pub(crate) fn discard_on_send(reason: &StopReason, cancelled: bool) -> bool {
    cancelled
        || matches!(reason, StopReason::Unrecognized(raw) if raw == "error" || raw == "aborted")
}

/// Fecha as chamadas abertas com resultados sintéticos.
fn close(out: &mut Vec<Message>, pending: &mut Vec<String>) {
    if pending.is_empty() {
        return;
    }
    out.push(Message::tool_results(
        pending.drain(..).map(synthetic).collect(),
    ));
}

fn synthetic(tool_use_id: String) -> ContentBlock {
    ContentBlock::ToolResult {
        tool_use_id,
        content: INTERRUPTED.to_owned(),
        is_error: true,
    }
}

/// Os identificadores de chamada que esta mensagem declara.
fn declared(message: &Message) -> Vec<String> {
    message
        .content
        .iter()
        .filter_map(|block| match block {
            ContentBlock::ToolUse { id, .. } => Some(id.clone()),
            _ => None,
        })
        .collect()
}

/// Os identificadores que estes blocos respondem.
fn answered(content: &[ContentBlock]) -> Vec<String> {
    content
        .iter()
        .filter_map(|block| match block {
            ContentBlock::ToolResult { tool_use_id, .. } => Some(tool_use_id.clone()),
            _ => None,
        })
        .collect()
}

/// Os blocos que sobrevivem: tudo, menos resultado sem chamada.
fn kept(message: &Message, pending: &[String]) -> Vec<ContentBlock> {
    message
        .content
        .iter()
        .filter(|block| match block {
            ContentBlock::ToolResult { tool_use_id, .. } => pending.contains(tool_use_id),
            _ => true,
        })
        .cloned()
        .collect()
}

const fn is_result(block: &ContentBlock) -> bool {
    matches!(block, ContentBlock::ToolResult { .. })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn call(id: &str) -> ContentBlock {
        ContentBlock::ToolUse {
            id: id.to_owned(),
            name: "read".to_owned(),
            input: json!({ "path": "a.rs" }),
        }
    }

    fn result(id: &str) -> ContentBlock {
        ContentBlock::ToolResult {
            tool_use_id: id.to_owned(),
            content: "conteudo".to_owned(),
            is_error: false,
        }
    }

    fn ids_of(message: &Message) -> Vec<String> {
        answered(&message.content)
    }

    #[test]
    fn a_paired_history_is_left_exactly_as_it_was() {
        // A correcao nao pode custar nada ao caminho comum, nem reordenar.
        let history = vec![
            Message::user("oi"),
            Message::assistant(vec![call("t1")]),
            Message::tool_results(vec![result("t1")]),
            Message::assistant(vec![ContentBlock::text("pronto")]),
        ];
        assert_eq!(for_provider(&history), history);
    }

    #[test]
    fn a_call_left_open_at_the_end_gets_a_result() {
        // E o que um corte de arvore produz: a mensagem do assistente pediu a
        // ferramenta e o ramo termina ali. Sem o resultado o provedor recusa o
        // pedido inteiro, e a sessao morre ao retomar.
        let history = vec![Message::user("oi"), Message::assistant(vec![call("t1")])];

        let fixed = for_provider(&history);
        assert_eq!(fixed.len(), 3);
        assert_eq!(ids_of(&fixed[2]), ["t1"]);
    }

    #[test]
    fn a_synthetic_result_is_marked_as_an_error_and_explains_itself() {
        // O modelo le isto e decide o que fazer. "Sem resultado" o levaria a
        // supor que a ferramenta rodou e nao devolveu nada.
        let fixed = for_provider(&[Message::assistant(vec![call("t1")])]);
        let ContentBlock::ToolResult {
            content, is_error, ..
        } = &fixed[1].content[0]
        else {
            panic!("esperava um resultado de ferramenta");
        };
        assert!(is_error);
        assert!(content.contains("interrompida"), "{content}");
    }

    #[test]
    fn only_the_unanswered_calls_of_a_batch_are_completed() {
        // Um lote parcialmente respondido acontece quando o cancelamento chega
        // no meio; completar tudo duplicaria o resultado que ja existe.
        let history = vec![
            Message::assistant(vec![call("t1"), call("t2")]),
            Message::tool_results(vec![result("t1")]),
        ];

        let fixed = for_provider(&history);
        assert_eq!(fixed.len(), 2);
        assert_eq!(ids_of(&fixed[1]), ["t1", "t2"]);
    }

    #[test]
    fn an_open_call_followed_by_a_plain_prompt_is_closed_before_it() {
        // A ordem importa: o resultado precisa vir logo depois da chamada, e o
        // prompt do usuario depois dele.
        let history = vec![
            Message::assistant(vec![call("t1")]),
            Message::user("na verdade, faca outra coisa"),
        ];

        let fixed = for_provider(&history);
        assert_eq!(fixed.len(), 3);
        assert_eq!(ids_of(&fixed[1]), ["t1"]);
        assert_eq!(
            fixed[2].content,
            vec![ContentBlock::text("na verdade, faca outra coisa")]
        );
    }

    #[test]
    fn a_result_without_a_call_is_dropped_rather_than_sent() {
        // O corte pode cair do outro lado: um ramo retomado a partir do
        // resultado carrega um `tool_result` que nao referencia nada.
        let history = vec![
            Message::tool_results(vec![result("orfao")]),
            Message::user("oi"),
        ];

        let fixed = for_provider(&history);
        assert_eq!(fixed.len(), 1);
        assert_eq!(fixed[0].content, vec![ContentBlock::text("oi")]);
    }

    #[test]
    fn a_message_left_empty_by_the_drop_is_removed_instead_of_sent_blank() {
        // O provedor recusa conteudo vazio, entao mandar a casca trocaria um
        // erro por outro.
        let fixed = for_provider(&[Message::tool_results(vec![result("orfao")])]);
        assert!(fixed.is_empty(), "{fixed:?}");
    }

    #[test]
    fn two_assistant_turns_in_a_row_do_not_swallow_the_open_call() {
        // Nao acontece pelo laco, acontece por corte de arvore.
        let history = vec![
            Message::assistant(vec![call("t1")]),
            Message::assistant(vec![ContentBlock::text("segui sem esperar")]),
        ];

        let fixed = for_provider(&history);
        assert_eq!(fixed.len(), 3);
        assert_eq!(ids_of(&fixed[1]), ["t1"]);
        assert_eq!(fixed[2].role, Role::Assistant);
    }

    #[test]
    fn an_empty_history_stays_empty() {
        assert!(for_provider(&[]).is_empty());
    }

    #[test]
    fn a_result_that_answers_an_older_call_is_kept() {
        // O identificador e o que pareia, nao a posicao.
        let history = vec![
            Message::assistant(vec![call("t1"), call("t2")]),
            Message::tool_results(vec![result("t2"), result("t1")]),
        ];
        assert_eq!(for_provider(&history), history);
    }

    fn discarded_assistant(text: &str) -> Message {
        let mut message = Message::assistant(vec![ContentBlock::text(text)]);
        message.discarded = true;
        message
    }

    #[test]
    fn an_interrupted_assistant_turn_is_not_sent() {
        // O provedor recusa turno incompleto (raciocínio sem item, JSON pela
        // metade). O histórico guarda o que o usuário viu; o envio não.
        let history = vec![
            Message::user("oi"),
            discarded_assistant("parcial"),
            Message::user("continua"),
        ];
        let sent = for_provider(&history);
        let texts: Vec<&str> = sent
            .iter()
            .flat_map(|m| m.content.iter())
            .filter_map(|b| match b {
                ContentBlock::Text { text } => Some(text.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(texts, ["oi", "continua"]);
    }

    #[test]
    fn an_orphaned_call_and_a_discarded_turn_send_results_without_the_interrupted_one() {
        // Retomar ramo + cancelar: o pedido precisa fechar a órfã e não
        // reenviar o turno interrompido.
        let mut interrupted = Message::assistant(vec![call("t-cancel")]);
        interrupted.discarded = true;
        let history = vec![
            Message::user("oi"),
            Message::assistant(vec![call("t1")]),
            interrupted,
            Message::user("continua"),
        ];
        let sent = for_provider(&history);
        assert!(
            sent.iter().all(|m| !m.discarded),
            "turno interrompido nao vai ao provedor: {sent:?}"
        );
        let ids: Vec<String> = sent.iter().flat_map(ids_of).collect();
        assert_eq!(ids, ["t1"], "so a orfa sobrevivente: {sent:?}");
        assert!(
            sent.iter()
                .flat_map(|m| m.content.iter())
                .all(|b| !matches!(b, ContentBlock::ToolUse { id, .. } if id == "t-cancel")),
            "chamada do turno cancelado nao vai: {sent:?}"
        );
    }

    #[test]
    fn a_cancelled_or_errored_stop_is_dropped_on_the_next_send() {
        use nycode_ai::StopReason;
        assert!(discard_on_send(&StopReason::EndTurn, true));
        assert!(discard_on_send(
            &StopReason::Unrecognized("error".into()),
            false
        ));
        assert!(discard_on_send(
            &StopReason::Unrecognized("aborted".into()),
            false
        ));
        assert!(!discard_on_send(&StopReason::EndTurn, false));
        assert!(!discard_on_send(&StopReason::ToolUse, false));
    }

    #[test]
    fn an_assistant_turn_carries_the_discard_flag_into_history() {
        let dropped = assistant_turn("parcial", &[], true).unwrap();
        assert!(dropped.discarded);
        assert!(!assistant_turn("ok", &[], false).unwrap().discarded);
    }

    #[tokio::test]
    async fn the_send_path_drops_a_discarded_turn_and_closes_an_orphan() {
        use std::sync::Arc;

        use crate::agent::{Agent, Silent};
        use crate::backend::fake::FakeBackend;

        let (_dir, ctx) = crate::agent_test::workspace();
        let backend = Arc::new(FakeBackend::new(vec![crate::agent_test::text_turn("ok")]));
        let mut agent = Agent::new(backend.clone(), ctx);
        agent.set_history(vec![
            Message::user("oi"),
            Message::assistant(vec![call("t1")]),
            discarded_assistant("parcial"),
        ]);
        agent.run("continua", &mut Silent).await.unwrap();

        let sent = backend.last_messages();
        let texts: Vec<&str> = sent
            .iter()
            .flat_map(|m| m.content.iter())
            .filter_map(|b| match b {
                ContentBlock::Text { text } => Some(text.as_str()),
                _ => None,
            })
            .collect();
        assert!(
            !texts.iter().any(|t| t.contains("parcial")),
            "turno interrompido no corpo: {sent:?}"
        );
        assert!(
            sent.iter().flat_map(|m| m.content.iter()).any(
                |b| matches!(b, ContentBlock::ToolResult { tool_use_id, .. } if tool_use_id == "t1")
            ),
            "orfa sem resultado: {sent:?}"
        );
    }
}
