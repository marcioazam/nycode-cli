//! Texto de origem não confiável, tornado seguro de escrever num terminal.
//!
//! Saída de ferramenta é conteúdo que o harness não escreveu: vem de um comando
//! que o modelo compôs, de um arquivo do repositório ou de um servidor MCP. Ela
//! chega ao terminal do usuário, e ali o texto pode significar outra coisa além
//! do que aparenta.
//!
//! Uma sequência de escape reposiciona o cursor, apaga linhas e escreve por
//! cima. É o que transforma saída de ferramenta em interface: um comando que
//! emite `\r` mais espaços reescreve a linha anterior, e o que estava ali pode
//! ter sido a pergunta de aprovação — o usuário responde a um prompt que o
//! conteúdo desenhou. Controle de terminal não é conteúdo, e por isso não
//! sobrevive à passagem.
//!
//! Para o modelo o problema é outro e menor: desperdício de janela, porque um
//! `ls --color` gasta metade dos bytes em escapes que não dizem nada. Mas há um
//! caso que também é de correção — os controles de direção de escrita fazem uma
//! linha ser exibida numa ordem diferente da que está gravada, que é a forma do
//! ataque conhecido como Trojan Source, e um agente que revisa código precisa
//! ler o que está gravado.
//!
//! O que sobrevive é `\t` e `\n`. Não `\r`: sozinho ele volta o cursor para a
//! coluna zero, que é justamente a primitiva de sobrescrita, e em `\r\n` ele é
//! redundante com a newline que fica.

use std::borrow::Cow;

/// Remove controle de terminal, deixando só o texto.
///
/// Devolve emprestado quando não há nada a remover, que é o caso comum: a saída
/// de um comando normal atravessa sem alocação.
#[must_use]
pub fn plain(text: &str) -> Cow<'_, str> {
    if !text.chars().any(is_control) {
        return Cow::Borrowed(text);
    }

    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '\u{1b}' => skip_escape(&mut chars),
            _ if is_control(ch) => {}
            _ => out.push(ch),
        }
    }
    Cow::Owned(out)
}

/// Consome o resto de uma sequência de escape já iniciada.
///
/// As famílias terminam de formas diferentes, e tratar todas como uma só é o
/// erro que deixa o resto da sequência vazar como texto: `CSI` acaba no primeiro
/// byte de `@` a `~`, enquanto `OSC` e as sequências de string acabam em `BEL`
/// ou em `ESC \` e podem conter letras no meio — um título de janela, por
/// exemplo.
fn skip_escape<I>(chars: &mut std::iter::Peekable<I>)
where
    I: Iterator<Item = char>,
{
    match chars.next() {
        // CSI: parâmetros e intermediários, até um byte final de `@` a `~`.
        Some('[') => {
            for next in chars.by_ref() {
                if ('\u{40}'..='\u{7e}').contains(&next) {
                    break;
                }
            }
        }
        // OSC, DCS, SOS, PM, APC: terminam em `BEL` ou em `ESC \`.
        Some(']' | 'P' | 'X' | '^' | '_') => {
            while let Some(next) = chars.next() {
                match next {
                    '\u{7}' => break,
                    '\u{1b}' => {
                        // O `\` faz parte do terminador; qualquer outra coisa
                        // inicia uma sequência nova, que a volta trata.
                        if chars.peek() == Some(&'\\') {
                            chars.next();
                        }
                        break;
                    }
                    _ => {}
                }
            }
        }
        // Sequências de dois caracteres — `ESC c` reseta o terminal inteiro — e
        // o `ESC` solto no fim do texto, que não tem o que consumir.
        _ => {}
    }
}

/// Se este caractere controla o terminal em vez de dizer algo.
fn is_control(ch: char) -> bool {
    // Tabulação e newline são conteúdo: removê-las quebraria a indentação de
    // todo diff e de todo log.
    if matches!(ch, '\t' | '\n') {
        return false;
    }

    // C0 e DEL, mais C1: `\u{9b}` é o `CSI` de um byte, e um terminal que o
    // interprete aceita a sequência inteira sem ela passar por `ESC`.
    let comando = matches!(ch, '\u{0}'..='\u{1f}' | '\u{7f}'..='\u{9f}');

    // Espaço de largura zero, marcas de direção e os isolamentos: fazem uma
    // linha ser exibida em ordem diferente da que está gravada.
    let reordena =
        matches!(ch, '\u{200b}'..='\u{200f}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}');

    // Separadores de linha e parágrafo, que alguns terminais quebram; mais a
    // anotação interlinear e o BOM no meio do texto, que são invisíveis e
    // quebram a medição de largura de quem os conta como caractere.
    let invisivel = matches!(
        ch,
        '\u{2028}' | '\u{2029}' | '\u{feff}' | '\u{fff9}'..='\u{fffb}'
    );

    comando || reordena || invisivel
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ordinary_text_passes_through_without_allocating() {
        // O caso comum e a saida de um comando normal; alocar nele seria pagar
        // por todo mundo o custo da excecao.
        let out = plain("compilando 3 alvos\n\tpronto\n");
        assert!(matches!(out, Cow::Borrowed(_)));
        assert_eq!(out, "compilando 3 alvos\n\tpronto\n");
    }

    #[test]
    fn colour_sequences_do_not_reach_the_terminal() {
        assert_eq!(plain("\u{1b}[31mvermelho\u{1b}[0m"), "vermelho");
        assert_eq!(plain("\u{1b}[1;38;5;196mforte\u{1b}[m"), "forte");
    }

    #[test]
    fn a_carriage_return_cannot_overwrite_the_line_above() {
        // E a primitiva da falsificacao: voltar a coluna zero e escrever por
        // cima do que ja estava na tela, que pode ter sido a pergunta de
        // aprovacao.
        assert_eq!(plain("real\rfalso"), "realfalso");
    }

    #[test]
    fn cursor_movement_cannot_repaint_what_is_already_on_screen() {
        // `\u{1b}[2A` sobe duas linhas e `\u{1b}[2K` apaga a linha inteira.
        assert_eq!(plain("saida\n\u{1b}[2A\u{1b}[2Kforjado"), "saida\nforjado");
    }

    #[test]
    fn an_operating_system_command_does_not_leak_its_payload_as_text() {
        // `OSC` termina em `BEL` ou `ESC \`, e nao no primeiro caractere
        // alfabetico: tratar todas as familias como `CSI` deixaria o titulo
        // vazar para a tela.
        assert_eq!(
            plain("antes\u{1b}]0;titulo da janela\u{7}depois"),
            "antesdepois"
        );
        assert_eq!(
            plain("antes\u{1b}]8;;http://exemplo\u{1b}\\depois"),
            "antesdepois"
        );
    }

    #[test]
    fn a_one_byte_control_introducer_is_removed_too() {
        // Um terminal que interpreta `\u{9b}` como `CSI` aceitaria a sequencia
        // sem ela nunca passar por `ESC`.
        assert!(!plain("a\u{9b}31mb").contains('\u{9b}'));
    }

    #[test]
    fn a_two_character_escape_takes_only_its_own_two_characters() {
        // `ESC c` reseta o terminal. Consumir demais comeria conteudo.
        assert_eq!(plain("antes\u{1b}cdepois"), "antesdepois");
    }

    #[test]
    fn a_dangling_escape_at_the_end_does_not_panic() {
        assert_eq!(plain("texto\u{1b}"), "texto");
        assert_eq!(plain("texto\u{1b}["), "texto");
        assert_eq!(plain("texto\u{1b}]"), "texto");
    }

    #[test]
    fn text_cannot_be_displayed_in_an_order_other_than_the_one_recorded() {
        // Trojan Source: com o override de direcao, o que se le na tela nao e o
        // que esta gravado, e uma revisao aprova uma coisa achando que e outra.
        let disfarcado = "if (admin) {\u{202e} // }\u{202c}";
        let limpo = plain(disfarcado);

        assert!(!limpo.contains('\u{202e}'), "{limpo}");
        assert!(!limpo.contains('\u{202c}'), "{limpo}");
    }

    #[test]
    fn invisible_characters_do_not_survive() {
        assert_eq!(plain("a\u{200b}b\u{feff}c"), "abc");
    }

    #[test]
    fn tabs_and_newlines_are_content_and_stay() {
        // Removê-los quebraria a indentacao de todo diff e de todo log.
        assert_eq!(plain("a\tb\nc"), "a\tb\nc");
    }

    #[test]
    fn a_null_byte_does_not_reach_the_terminal() {
        assert_eq!(plain("a\u{0}b"), "ab");
    }

    #[test]
    fn empty_text_stays_empty() {
        assert_eq!(plain(""), "");
    }
}
