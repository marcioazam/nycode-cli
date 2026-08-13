//! Leitura de arquivo com teto de memória.
//!
//! Todo teto de tamanho deste repositório limitava o que chega ao modelo, e
//! nenhum limitava o que entra na memória: o arquivo era lido inteiro e só
//! depois cortado. Num processo cujo orçamento de RSS é 30 `MiB` (NFR-2), um
//! arquivo de 2 `GiB` no workspace derruba o agente antes de o corte acontecer.
//!
//! O teto vale na leitura. O tamanho verdadeiro continua disponível porque as
//! mensagens de truncamento o mostram, e ele vem do metadado, não da contagem
//! do que foi lido.

use std::path::Path;

/// O que foi lido de um arquivo, e o tamanho que ele tem no disco.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Capped {
    /// No máximo o teto pedido.
    pub bytes: Vec<u8>,
    /// Tamanho real do arquivo, mesmo quando `bytes` ficou menor.
    pub total: u64,
}

impl Capped {
    /// Se o arquivo é maior do que o que foi guardado.
    #[must_use]
    pub fn truncated(&self) -> bool {
        self.total > self.bytes.len() as u64
    }

    /// O prefixo válido em UTF-8 do que foi lido.
    ///
    /// Cortar no teto pode partir um codepoint ao meio. Devolver o prefixo
    /// válido perde no máximo um caractere e nunca produz texto inválido, que é
    /// o que um `from_utf8` cru faria falhar por inteiro.
    #[must_use]
    pub fn text(&self) -> &str {
        match std::str::from_utf8(&self.bytes) {
            Ok(text) => text,
            Err(err) => std::str::from_utf8(&self.bytes[..err.valid_up_to()]).unwrap_or(""),
        }
    }
}

/// Lê um arquivo guardando no máximo `cap` bytes.
pub async fn read(path: &Path, cap: usize) -> std::io::Result<Capped> {
    use tokio::io::AsyncReadExt as _;

    let file = tokio::fs::File::open(path).await?;
    let total = file.metadata().await?.len();

    let mut bytes = Vec::with_capacity(reserve(total, cap));
    file.take(ceiling(cap)).read_to_end(&mut bytes).await?;

    Ok(Capped { bytes, total })
}

/// O mesmo que [`read`], fora de contexto assíncrono.
pub fn read_blocking(path: &Path, cap: usize) -> std::io::Result<Capped> {
    use std::io::Read as _;

    let file = std::fs::File::open(path)?;
    let total = file.metadata()?.len();

    let mut bytes = Vec::with_capacity(reserve(total, cap));
    file.take(ceiling(cap)).read_to_end(&mut bytes)?;

    Ok(Capped { bytes, total })
}

/// Quanto reservar de antemão: o tamanho do arquivo, preso ao teto.
///
/// Reservar pelo tamanho anunciado é o que torna a leitura de um arquivo comum
/// uma alocação só; prendê-lo ao teto é o que impede que um arquivo enorme
/// aloque tudo antes do primeiro byte.
fn reserve(total: u64, cap: usize) -> usize {
    usize::try_from(total).unwrap_or(cap).min(cap)
}

fn ceiling(cap: usize) -> u64 {
    u64::try_from(cap).unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file_of(bytes: usize) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("grande.txt"), "x".repeat(bytes)).unwrap();
        dir
    }

    #[tokio::test]
    async fn reading_never_holds_more_than_the_ceiling() {
        // O ponto do modulo: o teto vale na leitura, nao na saida.
        let dir = file_of(10_000);
        let read = read(&dir.path().join("grande.txt"), 1_000).await.unwrap();

        assert_eq!(read.bytes.len(), 1_000, "guardou mais que o teto");
        assert_eq!(read.total, 10_000, "o tamanho real vem do metadado");
        assert!(read.truncated());
    }

    #[test]
    fn the_blocking_read_holds_the_same_ceiling() {
        let dir = file_of(10_000);
        let read = read_blocking(&dir.path().join("grande.txt"), 1_000).unwrap();

        assert_eq!(read.bytes.len(), 1_000);
        assert_eq!(read.total, 10_000);
        assert!(read.truncated());
    }

    #[tokio::test]
    async fn a_file_under_the_ceiling_arrives_whole_and_unmarked() {
        let dir = file_of(500);
        let read = read(&dir.path().join("grande.txt"), 1_000).await.unwrap();

        assert_eq!(read.bytes.len(), 500);
        assert!(!read.truncated(), "nada foi cortado");
    }

    #[tokio::test]
    async fn a_file_exactly_at_the_ceiling_is_not_marked_as_truncated() {
        let dir = file_of(1_000);
        let read = read(&dir.path().join("grande.txt"), 1_000).await.unwrap();

        assert!(!read.truncated());
    }

    #[tokio::test]
    async fn a_missing_file_is_an_error_and_not_an_empty_read() {
        // Devolver vazio faria um arquivo ausente parecer um arquivo em branco.
        assert!(read(Path::new("/nao/existe/mesmo"), 10).await.is_err());
    }

    #[test]
    fn a_missing_file_is_also_an_error_without_the_runtime() {
        assert!(read_blocking(Path::new("/nao/existe/mesmo"), 10).is_err());
    }

    #[test]
    fn a_codepoint_split_by_the_ceiling_does_not_poison_the_whole_text() {
        // Cortar no byte pode partir um acento ao meio; perder o caractere e
        // aceitavel, devolver texto invalido ou vazio nao e.
        let capped = Capped {
            bytes: "coracao ç".as_bytes()[..9].to_vec(),
            total: 10,
        };

        assert_eq!(capped.text(), "coracao ");
    }

    #[test]
    fn valid_text_passes_through_untouched() {
        let capped = Capped {
            bytes: b"instrucao".to_vec(),
            total: 9,
        };

        assert_eq!(capped.text(), "instrucao");
    }
}
