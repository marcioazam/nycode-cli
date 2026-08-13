//! Captura da saída de um processo sob teto de memória.
//!
//! O teto de saída existia, mas valia sobre o que já estava na memória: a
//! captura lia os dois canos até o fim e só então cortava. Um `cargo build`
//! verboso, um `find /` ou um `yes` residenciavam tudo antes do corte, contra um
//! orçamento de RSS que não tem essa folga (NFR-2) — o mesmo defeito que
//! [`crate::capped`] já tinha corrigido na leitura de arquivo, e que ficou aqui.
//!
//! Duas decisões que o resto do módulo assume.
//!
//! Ler até o fim, descartando o excedente, em vez de parar de ler. Um cano cheio
//! bloqueia o processo na escrita, e um processo bloqueado só sai pelo prazo:
//! parar de ler transformaria "saída grande demais" em "comando que demora 90
//! segundos e não termina". É a mesma escolha que o hook já fazia.
//!
//! Guardar a **cauda** e não o começo. Num comando, o que decide o passo
//! seguinte está no fim: o erro do compilador, o resumo do teste, o código de
//! saída. Ler arquivo é o caso oposto, e por isso a ferramenta `read` corta do
//! outro lado.

use tokio::io::AsyncReadExt as _;

/// Sequência que torna o nome do arquivo único dentro do processo.
///
/// Relógio não basta: testes e comandos paralelos podem observar o mesmo tick,
/// e `File::create` faria duas capturas misturarem a saída no mesmo caminho.
static NEXT_SPILL: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// O que sobrou de um canal, e quanto passou por ele.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Captured {
    kept: Vec<u8>,
    total: u64,
    /// Onde o excedente foi gravado, quando passou do teto.
    ///
    /// A cauda que a janela guarda é o que decide o passo seguinte; o resto da
    /// saída vai para um arquivo temporário, para que um erro que ficou acima
    /// do teto continue alcançável pelo modelo em vez de desaparecer.
    spilled: Option<std::path::PathBuf>,
}

impl Captured {
    /// Uma captura pronta, para teste.
    #[cfg(test)]
    #[must_use]
    pub fn of(kept: &[u8], total: u64) -> Self {
        Self {
            kept: kept.to_vec(),
            total,
            spilled: None,
        }
    }

    /// Se o canal produziu mais do que cabia.
    #[must_use]
    pub const fn truncated(&self) -> bool {
        self.total > self.kept.len() as u64
    }

    /// Quantos bytes o canal produziu ao todo.
    #[must_use]
    pub const fn total(&self) -> u64 {
        self.total
    }

    /// Onde o excedente foi gravado, quando passou do teto.
    #[must_use]
    pub fn spilled(&self) -> Option<&std::path::Path> {
        self.spilled.as_deref()
    }

    #[must_use]
    pub const fn is_empty(&self) -> bool {
        self.total == 0
    }

    /// O texto guardado, sem controle de terminal.
    ///
    /// Cortar pela cauda pode começar no meio de um caractere multibyte. Avançar
    /// até a próxima fronteira custa no máximo três bytes e evita um losango de
    /// substituição na primeira coluna, que o modelo leria como conteúdo.
    ///
    /// A limpeza acontece aqui, e não em quem exibe, porque a saída de um
    /// comando é o caso em que o escape é presença acidental — um `ls --color`
    /// herda a cor do terminal — e não conteúdo que alguém pediu para ver. Ler
    /// arquivo é o caso oposto, e por isso `read` não passa por aqui: um script
    /// que contém escape precisa chegar ao modelo com ele.
    #[must_use]
    pub fn text(&self) -> std::borrow::Cow<'_, str> {
        let mut start = 0;
        if self.truncated() {
            while start < self.kept.len() && self.kept[start] & 0xC0 == 0x80 {
                start += 1;
            }
        }
        match String::from_utf8_lossy(&self.kept[start..]) {
            std::borrow::Cow::Borrowed(text) => crate::tool::sanitize::plain(text),
            std::borrow::Cow::Owned(text) => {
                std::borrow::Cow::Owned(crate::tool::sanitize::plain(&text).into_owned())
            }
        }
    }
}

/// Lê o canal até o fim, guardando no máximo `cap` bytes da cauda.
pub async fn drain<R>(reader: &mut R, cap: usize) -> Captured
where
    R: tokio::io::AsyncRead + Unpin,
{
    /// Quanto se deixa acumular antes de aparar.
    ///
    /// Aparar a cada leitura moveria `cap` bytes por bloco lido — para uma saída
    /// de um gibibyte com teto de 64 kibibytes, oito gigabytes de memmove.
    /// Deixar dobrar amortiza o corte em um por `cap` bytes lidos, ao preço de
    /// segurar o dobro do teto, que continua sendo memória constante.
    const SLACK: usize = 2;

    /// Tamanho de cada leitura.
    const CHUNK: usize = 8 * 1024;

    let ceiling = cap.saturating_mul(SLACK).max(1);
    let mut captured = Captured::default();
    // No heap, e não na pilha: um arranjo local vive dentro do future, e são
    // dois `drain` num `join` — dezesseis kibibytes que o future do laço de
    // agente passaria a carregar em cada chamada de ferramenta.
    let mut chunk = vec![0u8; CHUNK];
    let mut spill: Option<tokio::fs::File> = None;
    let mut spilled_path: Option<std::path::PathBuf> = None;

    while let Ok(read) = reader.read(&mut chunk).await {
        if read == 0 {
            break;
        }
        captured.total = captured.total.saturating_add(read as u64);
        captured.kept.extend_from_slice(&chunk[..read]);
        if captured.kept.len() > ceiling {
            let excess = captured.kept.len() - cap;

            // O excedente vai para um arquivo, e não para o nada. O que a
            // janela guarda é a cauda, que é o que decide o passo seguinte; o
            // resto fica alcançável pelo caminho que o aviso nomeia.
            if spill.is_none() {
                match open_spill().await {
                    Ok((file, path)) => {
                        spill = Some(file);
                        spilled_path = Some(path);
                    }
                    Err(err) => {
                        // Não abrir o temporário não é motivo para perder a
                        // saída: o teto segue valendo, só o excedente se perde.
                        tracing::warn!(%err, "nao foi possivel abrir o arquivo de excesso");
                    }
                }
            }
            if let Some(file) = spill.as_mut() {
                use tokio::io::AsyncWriteExt as _;
                let _ = file.write_all(&captured.kept[..excess]).await;
            }
            captured.kept.drain(..excess);
        }
    }

    // O último bloco de leitura pode não ter passado do teto de aparagem e
    // ainda assim ter estourado o de guarda: o excedente final entra no
    // arquivo como qualquer outro.
    if captured.kept.len() > cap {
        let excess = captured.kept.len() - cap;
        if spill.is_none() && excess > 0 {
            match open_spill().await {
                Ok((file, path)) => {
                    spill = Some(file);
                    spilled_path = Some(path);
                }
                Err(err) => {
                    tracing::warn!(%err, "nao foi possivel abrir o arquivo de excesso");
                }
            }
        }
        if let Some(file) = spill.as_mut() {
            use tokio::io::AsyncWriteExt as _;
            let _ = file.write_all(&captured.kept[..excess]).await;
        }
        captured.kept.drain(..excess);
    }

    // O arquivo recebe também a cauda, e não só o excedente: é para ele que o
    // aviso manda o modelo, e mandá-lo para um pedaço da saída seria mandá-lo
    // para o lugar errado. O `flush` é a fronteira que torna o caminho
    // anunciado completo no instante em que `drain` retorna.
    if let Some(file) = spill.as_mut() {
        use tokio::io::AsyncWriteExt as _;
        let _ = file.write_all(&captured.kept).await;
        let _ = file.flush().await;
    }
    captured.spilled = spilled_path;
    captured
}

/// Abre o arquivo que recebe o que passou do teto.
///
/// Dentro de `nycode/` no diretório de temporários do sistema, e não ao lado
/// do workspace: a saída é um subproduto da captura, e não conteúdo do projeto.
async fn open_spill() -> std::io::Result<(tokio::fs::File, std::path::PathBuf)> {
    let dir = std::env::temp_dir().join("nycode");
    tokio::fs::create_dir_all(&dir).await?;
    let sequence = NEXT_SPILL.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let path = dir.join(format!(
        "saida-{}-{}-{sequence}.log",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |since| since.as_nanos())
    ));
    let file = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .await?;
    Ok((file, path))
}

/// Um processo que terminou, com o que sobrou dos dois canais.
#[derive(Debug)]
pub struct Finished {
    pub status: std::process::ExitStatus,
    pub stdout: Captured,
    pub stderr: Captured,
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
mod tests {
    use super::*;

    async fn drained(bytes: &[u8], cap: usize) -> Captured {
        let mut reader = std::io::Cursor::new(bytes.to_vec());
        drain(&mut reader, cap).await
    }

    #[tokio::test]
    async fn output_that_fits_is_kept_whole() {
        let captured = drained(b"ola", 64).await;

        assert_eq!(captured.text(), "ola");
        assert_eq!(captured.total(), 3);
        assert!(!captured.truncated());
    }

    #[tokio::test]
    async fn what_is_kept_is_the_tail_because_that_is_where_the_error_is() {
        // Num comando o que decide o passo seguinte esta no fim: o erro do
        // compilador, o resumo do teste. Guardar o comeco entregaria ao modelo
        // a parte que ele nao precisa.
        let captured = drained(b"comeco-MEIO-fim", 3).await;

        assert_eq!(captured.text(), "fim");
        assert_eq!(captured.total(), 15);
        assert!(captured.truncated());
    }

    #[tokio::test]
    async fn a_flood_never_holds_more_than_a_bounded_amount() {
        // O invariante que motiva o modulo. Sem ele um `yes` residencia tudo
        // que produzir antes de o corte acontecer, contra um orcamento de RSS
        // que nao tem essa folga.
        const CAP: usize = 1024;
        let dilúvio = vec![b'x'; 8 * 1024 * 1024];

        let captured = drained(&dilúvio, CAP).await;

        assert_eq!(captured.total(), 8 * 1024 * 1024);
        assert_eq!(
            captured.kept.len(),
            CAP,
            "o guardado precisa caber no teto, e nao no tamanho da saida"
        );
    }

    #[tokio::test]
    async fn reading_continues_past_the_ceiling_instead_of_stopping() {
        // Parar de ler encheria o cano e bloquearia o processo na escrita, e um
        // processo bloqueado so sai pelo prazo: "saida grande demais" viraria
        // "comando que demora 90 segundos".
        let captured = drained(&vec![b'a'; 5000], 100).await;
        assert_eq!(
            captured.total(),
            5000,
            "o total so esta certo se tudo foi lido"
        );
    }

    #[tokio::test]
    async fn a_cut_in_the_middle_of_a_character_does_not_produce_a_replacement() {
        // Cortar pela cauda cai no meio de um multibyte quando o teto nao
        // coincide com a fronteira. Um losango na primeira coluna seria lido
        // pelo modelo como conteudo.
        let texto = "áááá"; // 8 bytes, dois por caractere
        let captured = drained(texto.as_bytes(), 3).await;

        assert!(
            !captured.text().contains('\u{fffd}'),
            "{:?}",
            captured.text()
        );
        assert_eq!(captured.text(), "á");
    }

    #[tokio::test]
    async fn terminal_control_does_not_survive_the_capture() {
        // Um comando colorido gasta metade dos bytes da janela em escape, e o
        // `\r` reescreve a linha anterior da tela do usuario — que pode ter
        // sido a pergunta de aprovacao.
        let captured = drained(b"\x1b[32mok\x1b[0m\nreal\rfalso", 4096).await;

        assert_eq!(captured.text(), "ok\nrealfalso");
    }

    #[tokio::test]
    async fn an_empty_channel_is_empty_and_not_truncated() {
        let captured = drained(b"", 64).await;

        assert!(captured.is_empty());
        assert!(!captured.truncated());
        assert_eq!(captured.text(), "");
    }

    #[tokio::test]
    async fn what_passed_the_ceiling_is_written_to_a_file_and_not_lost() {
        // Sem o arquivo, um erro que fica acima do teto e inalcancavel: a cauda
        // que a janela guarda pode nao ter a causa, e nao haveria onde olhar.
        // O arquivo tem a saida inteira, e nao so o excedente: e para la que o
        // modelo e mandado, e mandar para um pedaco seria mandar para o lugar
        // errado.
        let captured = drained(&vec![b'x'; 50_000], 100).await;

        let Some(path) = captured.spilled().map(std::path::Path::to_path_buf) else {
            panic!("o excedente precisa ter ido para um arquivo");
        };
        let lido = std::fs::read_to_string(&path).unwrap();
        let _ = std::fs::remove_file(&path);

        assert_eq!(lido.len(), 50_000, "{} bytes no arquivo", lido.len());
        assert_eq!(captured.total(), 50_000, "o total e o que o canal produziu");
        assert_eq!(captured.text().len(), 100, "a janela guarda so o teto");
    }

    #[tokio::test]
    async fn output_that_fits_leaves_no_file_behind() {
        // Um arquivo por comando encheria o diretorio de temporarios com
        // saida que ninguem vai ler.
        let captured = drained(b"curta", 4096).await;
        assert!(captured.spilled().is_none());
    }

    #[tokio::test]
    async fn a_zero_ceiling_keeps_nothing_but_still_counts_everything() {
        // Teto zero e configuracao degenerada, nao motivo para dividir por zero
        // nem para segurar a saida inteira.
        let captured = drained(b"alguma coisa", 0).await;

        assert_eq!(captured.total(), 12);
        assert!(captured.truncated());
        assert_eq!(captured.text(), "");
    }
}
