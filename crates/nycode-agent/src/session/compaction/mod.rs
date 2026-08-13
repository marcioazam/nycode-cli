//! Compactação de histórico.
//!
//! Quando o gateway responde que o prompt excedeu a janela, a alternativa a
//! compactar é abortar a tarefa no meio. A regra que guia o corte: preservar o
//! pedido original e os turnos recentes, e nunca separar uma chamada de
//! ferramenta do resultado dela.

mod marker;

pub use marker::SUMMARY_PROMPT;

use nycode_ai::anthropic::{ContentBlock, Message, Role};

/// Quantos turnos recentes preservar intactos.
pub const DEFAULT_KEEP_RECENT: usize = 6;

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
    compact_with(messages, keep_recent, None)
}

/// O mesmo, com um resumo em prosa do que saiu.
///
/// O resumo é parâmetro e não gerado aqui porque produzi-lo exige uma chamada
/// ao modelo, e esta função é pura: o corte, o que sobrevive e o marcador são
/// decididos sem rede, e continuam decididos do mesmo jeito quando a chamada
/// falha. Compactar acontece justamente quando as coisas já vão mal, e uma
/// compactação que depende de uma chamada dar certo é uma compactação que não
/// acontece na hora em que ela mais importa.
#[must_use]
pub fn compact_with(
    messages: &[Message],
    keep_recent: usize,
    summary: Option<&str>,
) -> Option<Compacted> {
    let cut = cut_point(messages, keep_recent)?;
    let head = HEAD;

    let mut out = Vec::with_capacity(keep_recent + 2);
    out.push(messages[0].clone());
    out.push(Message::user(marker::build(
        &marker::touched(&messages[head..cut]),
        summary,
    )));
    out.extend_from_slice(&messages[cut..]);

    Some(Compacted {
        removed: cut - head,
        messages: out,
    })
}

/// O trecho que a compactação vai descartar, para quem quiser resumi-lo antes.
///
/// `None` quando não há o que compactar — a mesma resposta que [`compact`] dá,
/// e pela mesma razão: pedir um resumo do que não vai sair gastaria um turno
/// para não mudar nada.
#[must_use]
pub fn dropped(messages: &[Message], keep_recent: usize) -> Option<&[Message]> {
    let cut = cut_point(messages, keep_recent)?;
    Some(&messages[HEAD..cut])
}

/// Quantas mensagens do começo sobrevivem sempre.
///
/// O primeiro turno do usuário é a tarefa. Perdê-lo faz o agente esquecer o que
/// estava fazendo, que é pior que estourar a janela.
const HEAD: usize = 1;

/// Onde o corte cai, ou `None` quando não há o que cortar.
fn cut_point(messages: &[Message], keep_recent: usize) -> Option<usize> {
    if messages.len() <= HEAD + keep_recent + 1 {
        return None;
    }

    let mut cut = messages.len() - keep_recent;
    // Nunca cortar entre um `tool_use` e o `tool_result` correspondente: o
    // backend recusa uma conversa que referencia um id sem origem.
    while cut < messages.len() && starts_with_tool_result(&messages[cut]) {
        cut += 1;
    }
    (cut > HEAD).then_some(cut)
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

    /// Uma conversa em que o agente leu e editou arquivos antes do corte.
    fn conversation_touching_files(turns: usize) -> Vec<Message> {
        let mut messages = conversation(turns);
        messages.insert(
            2,
            Message::assistant(vec![
                ContentBlock::ToolUse {
                    id: "t1".to_owned(),
                    name: "read".to_owned(),
                    input: json!({ "path": "src/lib.rs" }),
                },
                ContentBlock::ToolUse {
                    id: "t2".to_owned(),
                    name: "edit".to_owned(),
                    input: json!({ "path": "src/main.rs" }),
                },
            ]),
        );
        messages.insert(
            3,
            Message::tool_results(vec![
                ContentBlock::tool_result("t1", "ok"),
                ContentBlock::tool_result("t2", "ok"),
            ]),
        );
        messages
    }

    fn marker_of(result: &Compacted) -> String {
        serde_json::to_string(&result.messages[1]).unwrap()
    }

    #[test]
    fn the_marker_carries_forward_which_files_were_touched() {
        // Sem isto o modelo rele os mesmos arquivos para descobrir onde estava
        // — o trabalho que a compactacao acabou de economizar, gasto de novo no
        // turno seguinte.
        let result = compact(&conversation_touching_files(30), 6).unwrap();
        let marker = marker_of(&result);

        assert!(marker.contains("src/lib.rs"), "{marker}");
        assert!(marker.contains("src/main.rs"), "{marker}");
        assert!(marker.contains("arquivos-modificados"), "{marker}");
    }

    #[test]
    fn a_file_that_changed_is_not_also_listed_as_merely_read() {
        // O modelo o reabriria antes de mexer nele de novo; lista-lo duas vezes
        // so gastaria janela.
        let mut messages = conversation(30);
        messages.insert(
            2,
            Message::assistant(vec![
                ContentBlock::ToolUse {
                    id: "t1".to_owned(),
                    name: "read".to_owned(),
                    input: json!({ "path": "src/main.rs" }),
                },
                ContentBlock::ToolUse {
                    id: "t2".to_owned(),
                    name: "write".to_owned(),
                    input: json!({ "path": "src/main.rs" }),
                },
            ]),
        );

        let marker = marker_of(&compact(&messages, 6).unwrap());
        assert_eq!(
            marker.matches("src/main.rs").count(),
            1,
            "aparece so na lista de modificados: {marker}"
        );
    }

    #[test]
    fn a_second_compaction_does_not_erase_what_the_first_preserved() {
        // O marcador da primeira esta dentro do trecho que a segunda descarta;
        // sem le-lo de volta, a lista sumiria na segunda compactacao.
        let primeira = compact(&conversation_touching_files(30), 6).unwrap();

        let mut crescida = primeira.messages;
        crescida.extend(conversation(20));
        let segunda = compact(&crescida, 6).unwrap();

        let marker = marker_of(&segunda);
        assert!(marker.contains("src/lib.rs"), "{marker}");
        assert!(marker.contains("src/main.rs"), "{marker}");
    }

    #[test]
    fn a_conversation_that_touched_nothing_gets_the_bare_marker() {
        // Cabecalho de lista vazia so gastaria janela.
        let marker = marker_of(&compact(&conversation(30), 6).unwrap());
        assert!(!marker.contains("arquivos-lidos"), "{marker}");
    }

    #[test]
    fn a_very_long_list_is_capped_and_says_how_many_were_left_out() {
        // Uma lista de mil caminhos custa mais janela do que a releitura que
        // ela evitaria.
        let mut messages = conversation(30);
        let leituras: Vec<_> = (0..marker::MAX_LISTED + 15)
            .map(|i| ContentBlock::ToolUse {
                id: format!("t{i}"),
                name: "read".to_owned(),
                input: json!({ "path": format!("src/f{i:03}.rs") }),
            })
            .collect();
        messages.insert(2, Message::assistant(leituras));

        let marker = marker_of(&compact(&messages, 6).unwrap());
        assert!(marker.contains("e mais 15"), "{marker}");
    }

    #[test]
    fn the_summary_comes_before_the_file_lists() {
        // O resumo responde "onde eu estava" e as listas respondem "no que eu
        // mexi". Ler o segundo sem o primeiro faz o modelo reabrir arquivo para
        // descobrir por que.
        let result = compact_with(
            &conversation_touching_files(30),
            6,
            Some("estava trocando o motor de busca"),
        )
        .unwrap();
        let marker = marker_of(&result);

        let resumo = marker.find("estava trocando").unwrap();
        let listas = marker.find("arquivos-").unwrap();
        assert!(resumo < listas, "{marker}");
    }

    #[test]
    fn a_compaction_without_a_summary_still_carries_the_file_lists() {
        // Compactar acontece quando a janela estourou, que e quando uma chamada
        // a mais tem a maior chance de falhar. O marcador vale por si.
        let result = compact_with(&conversation_touching_files(30), 6, None).unwrap();
        let marker = marker_of(&result);

        assert!(!marker.contains("resumo-do-que-saiu"), "{marker}");
        assert!(marker.contains("src/lib.rs"), "{marker}");
    }

    #[test]
    fn an_empty_summary_is_the_same_as_no_summary() {
        // Um modelo que responde em branco nao pode produzir um cabecalho de
        // resumo vazio, que so gastaria janela.
        let result = compact_with(&conversation_touching_files(30), 6, Some("   \n ")).unwrap();
        assert!(!marker_of(&result).contains("resumo-do-que-saiu"));
    }

    #[test]
    fn what_is_dropped_is_exactly_what_the_marker_replaces() {
        // O resumo e pedido sobre o trecho que sai; pedir sobre outra coisa
        // produziria um resumo que descreve o que ficou.
        let messages = conversation(30);
        let saiu = dropped(&messages, 6).unwrap();
        let result = compact(&messages, 6).unwrap();

        assert_eq!(saiu.len(), result.removed);
        assert_eq!(saiu[0], messages[1], "comeca depois da tarefa");
    }

    #[test]
    fn nothing_to_compact_means_nothing_to_summarize() {
        // Pedir um resumo do que nao vai sair gastaria um turno para nao mudar
        // nada.
        assert!(dropped(&conversation(4), DEFAULT_KEEP_RECENT).is_none());
    }
}
