//! Renderização diferencial.
//!
//! A ideia inteira: comparar o quadro novo com o anterior e emitir escrita
//! apenas para as linhas que mudaram. Redesenhar a tela inteira a cada delta de
//! token é o que produz flicker — e um agente emite dezenas de deltas por
//! segundo.

use crate::width::truncate_to_width;

/// Uma operação de terminal a ser executada.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Command {
    /// Reposiciona o cursor na linha indicada, contada a partir do topo.
    MoveTo(usize),
    /// Limpa da posição do cursor até o fim da linha.
    ClearLine,
    /// Escreve texto na posição atual.
    Write(String),
}

/// Guarda o quadro anterior para calcular o mínimo a redesenhar.
#[derive(Debug, Default)]
pub struct Renderer {
    previous: Vec<String>,
    width: usize,
}

impl Renderer {
    #[must_use]
    pub fn new(width: usize) -> Self {
        Self {
            previous: Vec::new(),
            width,
        }
    }

    /// Ajusta a largura.
    ///
    /// Uma mudança de largura invalida o quadro anterior por completo: as
    /// mesmas linhas passam a quebrar em pontos diferentes, e comparar contra o
    /// estado antigo deixaria resto na tela.
    pub fn resize(&mut self, width: usize) {
        if width != self.width {
            self.width = width;
            self.previous.clear();
        }
    }

    #[must_use]
    pub const fn width(&self) -> usize {
        self.width
    }

    /// Calcula as operações que levam a tela do quadro anterior para o novo.
    pub fn render(&mut self, next: &[String]) -> Vec<Command> {
        let next: Vec<String> = next
            .iter()
            .map(|line| truncate_to_width(line, self.width))
            .collect();

        let mut commands = Vec::new();
        let rows = next.len().max(self.previous.len());

        for row in 0..rows {
            let new_line = next.get(row);
            let old_line = self.previous.get(row);

            match (new_line, old_line) {
                // Linha inalterada: nao emite nada. E o ponto do exercicio.
                (Some(new), Some(old)) if new == old => {}
                (Some(new), _) => {
                    commands.push(Command::MoveTo(row));
                    commands.push(Command::ClearLine);
                    commands.push(Command::Write(new.clone()));
                }
                // O quadro encolheu: as linhas sobrando precisam sumir, senao
                // resto do quadro anterior fica na tela.
                (None, Some(_)) => {
                    commands.push(Command::MoveTo(row));
                    commands.push(Command::ClearLine);
                }
                (None, None) => {}
            }
        }

        self.previous = next;
        commands
    }

    /// Descarta o estado, forçando o próximo quadro a redesenhar tudo.
    pub fn invalidate(&mut self) {
        self.previous.clear();
    }

    /// Número de linhas do último quadro.
    #[must_use]
    pub fn rows(&self) -> usize {
        self.previous.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(lines: &[&str]) -> Vec<String> {
        lines.iter().map(|s| (*s).to_owned()).collect()
    }

    fn written(commands: &[Command]) -> Vec<&str> {
        commands
            .iter()
            .filter_map(|c| match c {
                Command::Write(text) => Some(text.as_str()),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn the_first_frame_draws_every_line() {
        let mut renderer = Renderer::new(80);
        let commands = renderer.render(&frame(&["a", "b"]));
        assert_eq!(written(&commands), vec!["a", "b"]);
    }

    #[test]
    fn an_identical_frame_emits_nothing() {
        // E a razao de existir do modulo. Se este teste falhar, o terminal
        // pisca a cada delta de token.
        let mut renderer = Renderer::new(80);
        renderer.render(&frame(&["a", "b", "c"]));
        assert!(renderer.render(&frame(&["a", "b", "c"])).is_empty());
    }

    #[test]
    fn only_the_changed_line_is_redrawn() {
        let mut renderer = Renderer::new(80);
        renderer.render(&frame(&["a", "b", "c"]));

        let commands = renderer.render(&frame(&["a", "MUDOU", "c"]));
        assert_eq!(written(&commands), vec!["MUDOU"]);
        assert_eq!(
            commands[0],
            Command::MoveTo(1),
            "posicionou na linha errada"
        );
    }

    #[test]
    fn a_growing_frame_draws_only_the_new_lines() {
        let mut renderer = Renderer::new(80);
        renderer.render(&frame(&["a"]));

        let commands = renderer.render(&frame(&["a", "b", "c"]));
        assert_eq!(written(&commands), vec!["b", "c"]);
    }

    #[test]
    fn a_shrinking_frame_clears_the_leftover_lines() {
        // Sem isto, o resto do quadro anterior fica na tela e o usuario ve
        // conteudo fantasma.
        let mut renderer = Renderer::new(80);
        renderer.render(&frame(&["a", "b", "c"]));

        let commands = renderer.render(&frame(&["a"]));
        assert!(written(&commands).is_empty(), "nada novo a escrever");
        assert_eq!(
            commands,
            vec![
                Command::MoveTo(1),
                Command::ClearLine,
                Command::MoveTo(2),
                Command::ClearLine,
            ]
        );
    }

    #[test]
    fn lines_are_truncated_to_the_width() {
        let mut renderer = Renderer::new(5);
        let commands = renderer.render(&frame(&["abcdefghij"]));
        assert_eq!(written(&commands), vec!["abcde"]);
    }

    #[test]
    fn a_line_that_only_differs_past_the_width_is_not_redrawn() {
        // Comparar antes de truncar redesenharia linhas visualmente identicas.
        let mut renderer = Renderer::new(5);
        renderer.render(&frame(&["abcdeXXX"]));
        assert!(renderer.render(&frame(&["abcdeYYY"])).is_empty());
    }

    #[test]
    fn resizing_invalidates_the_previous_frame() {
        // Na largura nova as linhas quebram em outros pontos; comparar contra o
        // estado antigo deixaria resto na tela.
        let mut renderer = Renderer::new(80);
        renderer.render(&frame(&["a", "b"]));

        renderer.resize(40);
        assert_eq!(
            written(&renderer.render(&frame(&["a", "b"]))),
            vec!["a", "b"]
        );
    }

    #[test]
    fn resizing_to_the_same_width_is_a_no_op() {
        let mut renderer = Renderer::new(80);
        renderer.render(&frame(&["a"]));
        renderer.resize(80);
        assert!(renderer.render(&frame(&["a"])).is_empty());
    }

    #[test]
    fn invalidate_forces_a_full_redraw() {
        let mut renderer = Renderer::new(80);
        renderer.render(&frame(&["a", "b"]));
        renderer.invalidate();
        assert_eq!(
            written(&renderer.render(&frame(&["a", "b"]))),
            vec!["a", "b"]
        );
    }

    #[test]
    fn streaming_one_line_costs_one_write_per_frame() {
        // O caso real: uma linha crescendo token a token. Cada quadro pode custar
        // uma escrita, nunca o painel inteiro.
        let mut renderer = Renderer::new(80);
        let mut growing = String::new();
        renderer.render(&frame(&["cabecalho", "", "rodape"]));

        for token in ["Ola", " mundo", ", tudo", " bem"] {
            growing.push_str(token);
            let commands =
                renderer.render(&["cabecalho".to_owned(), growing.clone(), "rodape".to_owned()]);
            assert_eq!(written(&commands), vec![growing.as_str()]);
        }
    }

    #[test]
    fn rows_reports_the_last_frame_height() {
        let mut renderer = Renderer::new(80);
        assert_eq!(renderer.rows(), 0);
        renderer.render(&frame(&["a", "b", "c"]));
        assert_eq!(renderer.rows(), 3);
        assert_eq!(renderer.width(), 80);
    }
}
