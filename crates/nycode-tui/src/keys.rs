//! Tradução de tecla para intenção.
//!
//! Fica isolada por dois motivos. O primeiro é que atalho é a parte da
//! interface que mais muda, e mudá-la não deve tocar o buffer. O segundo é que
//! `KeyEvent` é fácil de construir num teste, então o mapa inteiro fica
//! verificável sem terminal — inclusive as combinações que só aparecem em um
//! emulador ou outro.

use crossterm::event::{KeyCode, KeyEvent, KeyEventKind, KeyModifiers};

use crate::editor::Action;

/// O que uma tecla significa para a sessão.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Key {
    /// Uma edição do buffer.
    Edit(Action),
    /// Interromper o que estiver acontecendo.
    Interrupt,
    /// Encerrar a sessão.
    Quit,
    /// Redesenhar tudo, para quando outro programa sujou a tela.
    Redraw,
}

/// Traduz um evento de teclado.
///
/// Devolve `Key::Edit(Action::Nothing)` para o que não tem significado, em vez
/// de `Option`: a ausência de significado é uma resposta, e o chamador trata
/// todos os casos pelo mesmo caminho.
#[must_use]
pub fn translate(event: KeyEvent) -> Key {
    // Sem este filtro, um terminal que reporta `Release` além de `Press` — o
    // padrão no Windows e com o protocolo estendido do Kitty — duplicaria cada
    // caractere digitado.
    if event.kind == KeyEventKind::Release {
        return Key::Edit(Action::Nothing);
    }

    let ctrl = event.modifiers.contains(KeyModifiers::CONTROL);
    let alt = event.modifiers.contains(KeyModifiers::ALT);
    let shift = event.modifiers.contains(KeyModifiers::SHIFT);

    match event.code {
        KeyCode::Char('c') if ctrl => Key::Interrupt,
        KeyCode::Char('d') if ctrl => Key::Quit,
        KeyCode::Char('l') if ctrl => Key::Redraw,
        KeyCode::Char('u') if ctrl => Key::Edit(Action::Discard),
        KeyCode::Char('a') if ctrl => Key::Edit(Action::Home),
        KeyCode::Char('e') if ctrl => Key::Edit(Action::End),
        // Ctrl+J é um dos três acordos de quebra de linha; precisa vir antes do
        // braço genérico de Ctrl, que engoliria a tecla.
        KeyCode::Char('j') if ctrl => Key::Edit(Action::Newline),

        // Um caractere com Ctrl que não caiu acima é um atalho que não existe.
        // Inseri-lo colocaria um caractere de controle no prompt.
        KeyCode::Char(_) if ctrl => Key::Edit(Action::Nothing),
        KeyCode::Char(ch) => Key::Edit(Action::Insert(ch)),

        // Quebra de linha em vez de envio. Os três acordos existem porque
        // nenhum funciona em todo emulador: Alt+Enter é o mais portátil,
        // Shift+Enter depende de protocolo estendido, e Ctrl+J é o fallback
        // que sempre chega.
        KeyCode::Enter if alt || shift || ctrl => Key::Edit(Action::Newline),
        KeyCode::Enter => Key::Edit(Action::Submit),

        KeyCode::Backspace => Key::Edit(Action::Backspace),
        KeyCode::Delete => Key::Edit(Action::Delete),
        KeyCode::Left => Key::Edit(Action::Left),
        KeyCode::Right => Key::Edit(Action::Right),
        KeyCode::Home => Key::Edit(Action::Home),
        KeyCode::End => Key::Edit(Action::End),
        KeyCode::Up => Key::Edit(Action::Previous),
        KeyCode::Down => Key::Edit(Action::Next),
        KeyCode::Esc => Key::Edit(Action::Discard),

        _ => Key::Edit(Action::Nothing),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plain(code: KeyCode) -> Key {
        translate(KeyEvent::new(code, KeyModifiers::NONE))
    }

    fn with(code: KeyCode, modifiers: KeyModifiers) -> Key {
        translate(KeyEvent::new(code, modifiers))
    }

    #[test]
    fn a_letter_is_inserted() {
        assert_eq!(plain(KeyCode::Char('a')), Key::Edit(Action::Insert('a')));
    }

    #[test]
    fn a_capital_letter_arrives_as_itself_and_not_as_a_shortcut() {
        // O terminal ja entrega a maiuscula com SHIFT setado; tratar SHIFT como
        // modificador de atalho engoliria o caractere.
        assert_eq!(
            with(KeyCode::Char('A'), KeyModifiers::SHIFT),
            Key::Edit(Action::Insert('A'))
        );
    }

    #[test]
    fn enter_submits_but_the_three_newline_agreements_do_not() {
        // Nenhum dos tres funciona em todo emulador, e por isso os tres valem.
        assert_eq!(plain(KeyCode::Enter), Key::Edit(Action::Submit));
        for modifier in [
            KeyModifiers::ALT,
            KeyModifiers::SHIFT,
            KeyModifiers::CONTROL,
        ] {
            assert_eq!(
                with(KeyCode::Enter, modifier),
                Key::Edit(Action::Newline),
                "modificador {modifier:?} deveria quebrar linha"
            );
        }
        assert_eq!(
            with(KeyCode::Char('j'), KeyModifiers::CONTROL),
            Key::Edit(Action::Newline)
        );
    }

    #[test]
    fn control_c_interrupts_and_control_d_quits() {
        assert_eq!(
            with(KeyCode::Char('c'), KeyModifiers::CONTROL),
            Key::Interrupt
        );
        assert_eq!(with(KeyCode::Char('d'), KeyModifiers::CONTROL), Key::Quit);
    }

    #[test]
    fn the_readline_shortcuts_that_people_have_in_their_fingers_work() {
        assert_eq!(
            with(KeyCode::Char('a'), KeyModifiers::CONTROL),
            Key::Edit(Action::Home)
        );
        assert_eq!(
            with(KeyCode::Char('e'), KeyModifiers::CONTROL),
            Key::Edit(Action::End)
        );
        assert_eq!(
            with(KeyCode::Char('u'), KeyModifiers::CONTROL),
            Key::Edit(Action::Discard)
        );
        assert_eq!(with(KeyCode::Char('l'), KeyModifiers::CONTROL), Key::Redraw);
    }

    #[test]
    fn an_unbound_control_combination_inserts_nothing() {
        // Sem esta guarda, Ctrl+W colocaria um caractere de controle no prompt.
        assert_eq!(
            with(KeyCode::Char('w'), KeyModifiers::CONTROL),
            Key::Edit(Action::Nothing)
        );
    }

    #[test]
    fn arrows_move_and_the_vertical_ones_walk_the_history() {
        assert_eq!(plain(KeyCode::Left), Key::Edit(Action::Left));
        assert_eq!(plain(KeyCode::Right), Key::Edit(Action::Right));
        assert_eq!(plain(KeyCode::Up), Key::Edit(Action::Previous));
        assert_eq!(plain(KeyCode::Down), Key::Edit(Action::Next));
    }

    #[test]
    fn editing_keys_map_to_their_obvious_actions() {
        assert_eq!(plain(KeyCode::Backspace), Key::Edit(Action::Backspace));
        assert_eq!(plain(KeyCode::Delete), Key::Edit(Action::Delete));
        assert_eq!(plain(KeyCode::Home), Key::Edit(Action::Home));
        assert_eq!(plain(KeyCode::End), Key::Edit(Action::End));
        assert_eq!(plain(KeyCode::Esc), Key::Edit(Action::Discard));
    }

    #[test]
    fn a_key_release_is_ignored() {
        // Num terminal que reporta soltura, tratar o evento duplicaria cada
        // caractere digitado.
        let event = KeyEvent::new_with_kind(
            KeyCode::Char('a'),
            KeyModifiers::NONE,
            KeyEventKind::Release,
        );
        assert_eq!(translate(event), Key::Edit(Action::Nothing));
    }

    #[test]
    fn a_key_repeat_types_like_a_press() {
        // Segurar a tecla precisa repetir o caractere.
        let event =
            KeyEvent::new_with_kind(KeyCode::Char('x'), KeyModifiers::NONE, KeyEventKind::Repeat);
        assert_eq!(translate(event), Key::Edit(Action::Insert('x')));
    }

    #[test]
    fn a_key_without_meaning_is_not_an_error() {
        assert_eq!(plain(KeyCode::F(5)), Key::Edit(Action::Nothing));
        assert_eq!(plain(KeyCode::Insert), Key::Edit(Action::Nothing));
    }
}
