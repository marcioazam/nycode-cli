//! O que um ramo abandonado deixa para trás.
//!
//! `/fork` troca o caminho ativo. Sem um registro do que ficou no ramo, o
//! modelo continua como se aquele trabalho nunca tivesse existido.

use nycode_ai::anthropic::Message;

use super::marker;

/// Marcador de ramo abandonado, distinto da compactação por janela.
const BRANCH_ELISION: &str =
    "[ramo abandonado; o que aconteceu nele continua valendo como contexto]";

/// Mensagens do caminho atual que o novo caminho não contém.
#[must_use]
pub fn abandoned<'a>(current: &'a [Message], next: &[Message]) -> &'a [Message] {
    let common = current.iter().zip(next).take_while(|(a, b)| a == b).count();
    current.get(common..).unwrap_or(&[])
}

/// Texto a gravar no ponto do fork, ou `None` se não houve ramo a deixar.
#[must_use]
pub fn notice(dropped: &[Message]) -> Option<String> {
    if dropped.is_empty() {
        return None;
    }
    Some(marker::with_header(
        BRANCH_ELISION,
        &marker::touched(dropped),
        None,
        dropped,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_prefix_fork_drops_only_the_suffix() {
        let current = vec![Message::user("comum"), Message::user("depois")];
        let next = vec![Message::user("comum")];
        let dropped = abandoned(&current, &next);
        assert_eq!(dropped, &current[1..]);
    }

    #[test]
    fn staying_on_the_same_path_has_nothing_to_summarize() {
        let path = vec![Message::user("um")];
        assert!(abandoned(&path, &path).is_empty());
        assert!(notice(&[]).is_none());
    }

    #[test]
    fn a_divergent_root_drops_the_whole_current_path() {
        let current = vec![Message::user("a"), Message::user("b")];
        let next = vec![Message::user("outro")];
        assert_eq!(abandoned(&current, &next), current.as_slice());
    }

    #[test]
    fn the_notice_names_the_abandoned_branch() {
        let dropped = [Message::user("exploracao")];
        let text = notice(&dropped).unwrap();
        assert!(text.contains("ramo abandonado"), "{text}");
        assert!(text.contains("exploracao"), "{text}");
        assert!(!text.contains("historico anterior compactado"), "{text}");
        assert!(!marker::is_marker(&Message::user(text)));
    }
}
