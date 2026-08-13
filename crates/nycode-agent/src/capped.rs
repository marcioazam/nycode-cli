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
    /// O começo de um texto que já está na memória, com o tamanho de origem.
    ///
    /// Nem todo teto começa num arquivo: a saída de uma ferramenta já é
    /// `String` quando alguém precisa cortá-la, e o que precisa ser preservado
    /// é a mesma dupla — o pedaço que passa adiante e o tamanho de que ele
    /// veio. Reimplementar isso no ponto de uso perderia o segundo, que é
    /// justamente o que impede o corte de ser silencioso.
    #[must_use]
    pub fn head_of(text: &str, cap: usize) -> Self {
        let end = cap.min(text.len());
        Self {
            bytes: text.as_bytes()[..end].to_vec(),
            total: text.len() as u64,
        }
    }

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
    read_open(tokio::fs::File::open(path).await?, cap).await
}

/// O mesmo, sobre um arquivo que já está aberto.
///
/// É por aqui que a leitura contida entra: [`crate::tool::contain`] devolve um
/// descritor, e reabrir por caminho para ler desfaria a garantia que ele acabou
/// de dar.
pub async fn read_open(file: tokio::fs::File, cap: usize) -> std::io::Result<Capped> {
    use tokio::io::AsyncReadExt as _;

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

/// Uma faixa de linhas de um arquivo, e o que sobrou fora dela.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Window {
    /// As linhas pedidas, já concatenadas.
    pub text: String,
    /// Número da primeira linha incluída, contando de 1.
    pub first: u64,
    /// Quantas linhas entraram.
    pub lines: u64,
    /// Se há conteúdo depois da última linha incluída.
    pub more: bool,
    /// Se o arquivo não é texto.
    pub binary: bool,
}

impl Window {
    /// A linha por onde a próxima chamada deve começar.
    #[must_use]
    pub const fn next_offset(&self) -> u64 {
        self.first + self.lines
    }
}

/// Teto de bytes percorridos para alcançar a faixa pedida.
///
/// Alcançar a linha um milhão exige ler tudo que vem antes dela, e "tudo" não
/// tem tamanho conhecido. O teto é de percurso, não de memória: o que se guarda
/// continua sendo `cap`.
const SCAN_CEILING: u64 = 8 * 1024 * 1024;

/// Tamanho de cada leitura do disco.
const CHUNK: usize = 64 * 1024;

/// Lê `limit` linhas a partir de `offset`, guardando no máximo `cap` bytes.
///
/// Percorre em blocos e monta linha a linha em vez de ler o arquivo e depois
/// recortar: um minificado de um megabyte é uma linha só, e `read_until` sobre
/// ele traria o megabyte inteiro para a memória antes de qualquer corte.
pub async fn read_window(
    file: tokio::fs::File,
    offset: u64,
    limit: Option<u64>,
    cap: usize,
) -> std::io::Result<Window> {
    use tokio::io::AsyncReadExt as _;

    let offset = offset.max(1);
    let mut reader = file;
    let mut chunk = vec![0u8; CHUNK];
    let mut pending: Vec<u8> = Vec::new();

    let mut window = Window {
        text: String::new(),
        first: offset,
        lines: 0,
        more: false,
        binary: false,
    };
    let mut number: u64 = 0;
    let mut scanned: u64 = 0;

    loop {
        let read = reader.read(&mut chunk).await?;
        if read == 0 {
            break;
        }
        scanned += read as u64;
        if chunk[..read].contains(&0) {
            // Byte nulo é a marca de binário, e `\0` é UTF-8 válido: sem esta
            // checagem um arquivo de nulos passa como texto e vira lixo no
            // contexto do modelo.
            window.binary = true;
            return Ok(window);
        }
        pending.extend_from_slice(&chunk[..read]);

        while let Some(end) = pending.iter().position(|byte| *byte == b'\n') {
            let line: Vec<u8> = pending.drain(..=end).collect();
            if !absorb(&mut window, &mut number, &line, offset, limit, cap) {
                return Ok(window);
            }
        }

        if scanned >= SCAN_CEILING {
            window.more = true;
            return Ok(window);
        }
    }

    // A última linha do arquivo pode não terminar em newline.
    if !pending.is_empty() {
        absorb(&mut window, &mut number, &pending, offset, limit, cap);
    }
    Ok(window)
}

/// Considera uma linha, devolvendo se vale continuar lendo.
fn absorb(
    window: &mut Window,
    number: &mut u64,
    line: &[u8],
    offset: u64,
    limit: Option<u64>,
    cap: usize,
) -> bool {
    *number += 1;
    if *number < offset {
        return true;
    }
    if limit.is_some_and(|limit| window.lines >= limit) || window.text.len() + line.len() > cap {
        window.more = true;
        return false;
    }
    window.text.push_str(&String::from_utf8_lossy(line));
    window.lines += 1;
    true
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

    #[test]
    fn capping_text_in_memory_keeps_the_size_it_came_from() {
        // Sem o tamanho de origem o corte e silencioso, e quem recebe o pedaco
        // decide como se tivesse lido tudo.
        let capped = Capped::head_of("comeco-MEIO-fim", 6);

        assert_eq!(capped.text(), "comeco");
        assert_eq!(capped.total, 15);
        assert!(capped.truncated());
    }

    #[test]
    fn text_that_fits_the_ceiling_is_not_marked_as_cut() {
        let capped = Capped::head_of("curto", 4096);

        assert_eq!(capped.text(), "curto");
        assert!(!capped.truncated());
    }

    #[test]
    fn capping_in_the_middle_of_a_character_drops_it_instead_of_corrupting() {
        // O teto e em bytes e o texto e UTF-8: cortar em 8 parte o `ç` ao meio.
        let capped = Capped::head_of("coracao ç", 8);

        assert_eq!(capped.text(), "coracao ");
        assert!(capped.truncated());
    }
}
