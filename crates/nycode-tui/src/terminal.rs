//! Escrita das operações no terminal.

use std::io::Write;

use crossterm::{QueueableCommand, cursor, terminal};

use crate::diff::{Command, Renderer};

/// Início de saída sincronizada.
///
/// O terminal segura o que receber até o par de encerramento e compõe tudo de
/// uma vez. Sem isto o redesenho diferencial troca o flicker de quadro inteiro
/// pelo flicker de linha, que é menor e igualmente visível. Terminais que não
/// conhecem a sequência a ignoram (ADR-0008).
const SYNC_BEGIN: &[u8] = b"\x1b[?2026h";
/// Fim de saída sincronizada.
const SYNC_END: &[u8] = b"\x1b[?2026l";

/// Aplica quadros a um destino de escrita.
///
/// O destino é genérico para que os testes verifiquem os bytes emitidos sem um
/// terminal real — o que também é o único jeito de afirmar que um quadro
/// inalterado não escreve nada.
#[derive(Debug)]
pub struct Terminal<W: Write> {
    out: W,
    renderer: Renderer,
    origin: usize,
}

impl<W: Write> Terminal<W> {
    pub fn new(out: W, width: usize) -> Self {
        Self {
            out,
            renderer: Renderer::new(width),
            origin: 0,
        }
    }

    /// Largura corrente do terminal, ou um padrão razoável quando não há um.
    #[must_use]
    pub fn detect_width() -> usize {
        terminal::size().map_or(80, |(cols, _)| cols as usize)
    }

    pub fn resize(&mut self, width: usize) {
        self.renderer.resize(width);
    }

    /// Desenha um quadro.
    ///
    /// Retorna quantas operações foram emitidas, que é zero quando nada mudou.
    pub fn draw(&mut self, frame: &[String]) -> std::io::Result<usize> {
        let commands = self.renderer.render(frame);
        if commands.is_empty() {
            return Ok(0);
        }

        let count = commands.len();
        let mut cursor_row = self.origin;
        self.out.write_all(SYNC_BEGIN)?;

        for command in commands {
            match command {
                Command::MoveTo(row) => {
                    // Movimento relativo: o painel vive no fluxo do terminal, nao
                    // em tela alternativa, entao nao ha coordenada absoluta.
                    // Saturar em vez de truncar: numa tela absurdamente alta um
                    // `as u16` daria a volta e moveria o cursor para o lugar errado.
                    let distance = |a: usize, b: usize| u16::try_from(a - b).unwrap_or(u16::MAX);
                    match row.cmp(&cursor_row) {
                        std::cmp::Ordering::Greater => {
                            self.out
                                .queue(cursor::MoveDown(distance(row, cursor_row)))?;
                        }
                        std::cmp::Ordering::Less => {
                            self.out.queue(cursor::MoveUp(distance(cursor_row, row)))?;
                        }
                        std::cmp::Ordering::Equal => {}
                    }
                    self.out.queue(cursor::MoveToColumn(0))?;
                    cursor_row = row;
                }
                Command::ClearLine => {
                    self.out
                        .queue(terminal::Clear(terminal::ClearType::UntilNewLine))?;
                }
                Command::Write(text) => {
                    self.out.write_all(text.as_bytes())?;
                }
            }
        }

        self.origin = cursor_row;
        self.out.write_all(SYNC_END)?;
        self.out.flush()?;
        Ok(count)
    }

    /// Escreve no scrollback, acima do painel.
    ///
    /// O painel vive no fluxo do terminal e não em tela alternativa, então
    /// acrescentar conteúdo é escrever e deixar o terminal rolar. O painel é
    /// invalidado porque as linhas que ele ocupava saíram do lugar.
    pub fn emit(&mut self, text: &str) -> std::io::Result<()> {
        self.out.write_all(text.as_bytes())?;
        self.out.flush()?;
        self.renderer.invalidate();
        self.origin = 0;
        Ok(())
    }

    /// Força o próximo quadro a redesenhar tudo.
    pub fn invalidate(&mut self) {
        self.renderer.invalidate();
    }

    pub fn into_inner(self) -> W {
        self.out
    }

    /// Empresta o destino, para inspecionar o que foi escrito.
    pub const fn inner(&self) -> &W {
        &self.out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(lines: &[&str]) -> Vec<String> {
        lines.iter().map(|s| (*s).to_owned()).collect()
    }

    #[test]
    fn an_unchanged_frame_writes_no_bytes() {
        // A afirmacao central: sem mudanca, nada vai para o terminal. Um teste
        // que so contasse comandos nao provaria isso.
        let mut term = Terminal::new(Vec::new(), 80);
        term.draw(&frame(&["a", "b"])).unwrap();

        let before = term.out.len();
        assert_eq!(term.draw(&frame(&["a", "b"])).unwrap(), 0);
        assert_eq!(term.out.len(), before, "quadro identico escreveu bytes");
    }

    #[test]
    fn the_first_frame_writes_its_content() {
        let mut term = Terminal::new(Vec::new(), 80);
        assert!(term.draw(&frame(&["ola"])).unwrap() > 0);

        let output = String::from_utf8_lossy(&term.out).to_string();
        assert!(output.contains("ola"));
    }

    #[test]
    fn only_the_changed_line_reaches_the_terminal() {
        let mut term = Terminal::new(Vec::new(), 80);
        term.draw(&frame(&["primeira", "segunda", "terceira"]))
            .unwrap();
        let baseline = term.out.len();

        term.draw(&frame(&["primeira", "MUDOU", "terceira"]))
            .unwrap();
        let delta = String::from_utf8_lossy(&term.out[baseline..]).to_string();

        assert!(delta.contains("MUDOU"));
        assert!(
            !delta.contains("primeira"),
            "linha inalterada foi reescrita"
        );
        assert!(
            !delta.contains("terceira"),
            "linha inalterada foi reescrita"
        );
    }

    #[test]
    fn streaming_tokens_costs_a_bounded_amount_per_frame() {
        // O caso real de uso. Se cada token custasse o painel inteiro, o custo
        // cresceria com o tamanho da tela e o terminal piscaria.
        let mut term = Terminal::new(Vec::new(), 80);
        let panel: Vec<String> = (0..30).map(|i| format!("linha {i}")).collect();
        term.draw(&panel).unwrap();

        let mut growing = String::new();
        let mut worst = 0;
        for token in ["a", "b", "c", "d", "e"] {
            growing.push_str(token);
            let mut next = panel.clone();
            next[15] = growing.clone();

            let before = term.out.len();
            term.draw(&next).unwrap();
            worst = worst.max(term.out.len() - before);
        }
        assert!(
            worst < 200,
            "um token custou {worst} bytes; o painel inteiro vazou"
        );
    }

    #[test]
    fn invalidate_forces_a_full_repaint() {
        let mut term = Terminal::new(Vec::new(), 80);
        term.draw(&frame(&["a"])).unwrap();
        term.invalidate();
        assert!(term.draw(&frame(&["a"])).unwrap() > 0);
    }

    #[test]
    fn resizing_repaints_everything() {
        let mut term = Terminal::new(Vec::new(), 80);
        term.draw(&frame(&["a", "b"])).unwrap();
        term.resize(40);
        assert!(term.draw(&frame(&["a", "b"])).unwrap() > 0);
    }

    #[test]
    fn detected_width_is_usable_even_without_a_terminal() {
        // Em CI nao ha tty; cair para zero produziria truncamento total.
        assert!(Terminal::<Vec<u8>>::detect_width() > 0);
    }

    #[test]
    fn the_writer_can_be_recovered() {
        let mut term = Terminal::new(Vec::new(), 80);
        term.draw(&frame(&["x"])).unwrap();
        assert!(!term.into_inner().is_empty());
    }
}
