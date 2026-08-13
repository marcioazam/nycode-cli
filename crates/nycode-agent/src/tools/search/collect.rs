//! O que a busca devolve, e onde ela para de devolver.
//!
//! Separado de [`super::grep`] porque muda por outro motivo: aquele muda quando
//! muda o contrato que o modelo vê — nome, descrição, argumentos —, e isto muda
//! quando muda a forma da linha devolvida ou a política de corte.

use std::fmt::Write as _;

use grep_searcher::{Searcher, Sink, SinkContext, SinkMatch};

/// Teto de linhas devolvidas.
///
/// Um padrão que casa com tudo produziria uma resposta maior que a janela.
///
/// Conta **linhas emitidas**, e não casamentos: com contexto cada casamento traz
/// vizinhas junto, e um teto sobre casamentos deixaria a resposta crescer pelo
/// fator do contexto sem que nada percebesse.
pub const MAX_MATCHES: usize = 200;

/// Teto de bytes por linha exibida.
///
/// Um arquivo minificado tem linhas de megabytes; uma delas basta para estourar
/// a janela.
const MAX_LINE: usize = 300;

/// Acumula as linhas que casam e as vizinhas pedidas, parando no teto.
///
/// Devolver `false` de [`Sink::matched`] encerra a busca naquele arquivo, e o
/// laço de fora encerra a varredura: sem os dois, um padrão que casa com tudo
/// leria o repositório inteiro para descartar o que passou do teto.
pub struct Collect<'a> {
    pub out: &'a mut String,
    pub relative: &'a str,
    /// Quantos casamentos de verdade, que é o que decide "nenhuma linha casa".
    pub hits: &'a mut usize,
    /// Quantas linhas foram emitidas, contando as de contexto. É o que o teto
    /// governa.
    pub lines: &'a mut usize,
    pub cap: usize,
}

impl Collect<'_> {
    /// Emite uma linha, dizendo se ainda cabe outra.
    ///
    /// O separador distingue o que casou do que veio junto: `:` no casamento e
    /// `-` no contexto, que é a convenção do `grep`. Sem isso o modelo não tem
    /// como saber qual das onze linhas é a que ele procurou.
    fn emit(&mut self, number: u64, bytes: &[u8], separator: char) -> bool {
        if *self.lines >= self.cap {
            return false;
        }
        *self.lines += 1;
        let line = String::from_utf8_lossy(bytes);
        let _ = writeln!(
            self.out,
            "{}{separator}{number}{separator} {}",
            self.relative,
            clip(line.trim_end())
        );
        *self.lines < self.cap
    }
}

impl Sink for Collect<'_> {
    type Error = std::io::Error;

    fn matched(&mut self, _searcher: &Searcher, mat: &SinkMatch<'_>) -> Result<bool, Self::Error> {
        if *self.lines >= self.cap {
            return Ok(false);
        }
        *self.hits += 1;
        Ok(self.emit(mat.line_number().unwrap_or(0), mat.bytes(), ':'))
    }

    fn context(
        &mut self,
        _searcher: &Searcher,
        ctx: &SinkContext<'_>,
    ) -> Result<bool, Self::Error> {
        Ok(self.emit(ctx.line_number().unwrap_or(0), ctx.bytes(), '-'))
    }
}

/// Encurta uma linha longa demais para o contexto.
fn clip(line: &str) -> String {
    if line.chars().count() <= MAX_LINE {
        return line.to_owned();
    }
    let kept: String = line.chars().take(MAX_LINE).collect();
    format!("{kept}...")
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
mod tests {
    use super::*;

    #[test]
    fn a_line_longer_than_the_window_is_clipped() {
        // Um arquivo minificado tem linha de megabytes; uma basta para estourar.
        let longa = "x".repeat(MAX_LINE + 50);

        let cortada = clip(&longa);

        assert!(cortada.ends_with("..."));
        assert_eq!(cortada.chars().count(), MAX_LINE + 3);
    }

    #[test]
    fn a_line_that_fits_is_not_touched() {
        assert_eq!(clip("curta"), "curta");
    }

    #[test]
    fn clipping_never_splits_a_character_in_half() {
        // Cortar por byte partiria um caractere multibyte e produziria texto
        // invalido no meio do contexto do modelo.
        let acentuada = "á".repeat(MAX_LINE + 10);

        let cortada = clip(&acentuada);

        assert!(cortada.ends_with("..."));
        assert_eq!(cortada.chars().count(), MAX_LINE + 3);
    }
}
