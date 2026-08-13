//! Anexar imagens ao pedido (FR-20).
//!
//! O arquivo é lido e embutido em base64. Uma URL faria o gateway buscar o
//! arquivo, o que muda quem alcança a rede e o que o operador consegue
//! auditar — e uma imagem local não teria URL nenhuma.
//!
//! O tipo vem dos bytes e não da extensão: um `.png` que na verdade é JPEG faz
//! o backend recusar, e a mensagem de erro dele não diz por quê.

use std::path::Path;

use nycode_ai::anthropic::ContentBlock;

/// Teto de bytes de uma imagem.
///
/// Acima disto o pedido é recusado pelo backend, e descobrir isso depois de
/// esperar o upload é pior que saber antes.
const MAX_BYTES: usize = 5 * 1024 * 1024;

/// Formatos que os dialetos aceitam, pelo número mágico.
const RECOGNIZED: &[(&[u8], &str)] = &[
    (&[0x89, b'P', b'N', b'G'], "image/png"),
    (&[0xff, 0xd8, 0xff], "image/jpeg"),
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
    // WebP é `RIFF....WEBP`; o sufixo é conferido em seguida.
    (b"RIFF", "image/webp"),
];

/// Lê uma imagem do disco e a transforma num bloco de conteúdo.
pub fn attach(path: &Path) -> anyhow::Result<ContentBlock> {
    // O teto vale na leitura: conferi-lo depois de carregar já custou a memória
    // que ele existe para poupar.
    let read = nycode_agent::capped::read_blocking(path, MAX_BYTES)
        .map_err(|err| anyhow::anyhow!("nao foi possivel ler {}: {err}", path.display()))?;

    if read.truncated() {
        anyhow::bail!(
            "{} tem {} bytes; o teto e {MAX_BYTES}",
            path.display(),
            read.total
        );
    }
    let bytes = read.bytes;

    let media_type = recognize(&bytes).ok_or_else(|| {
        anyhow::anyhow!(
            "{} nao e PNG, JPEG, GIF ou WebP; o backend recusaria sem dizer por que",
            path.display()
        )
    })?;

    Ok(ContentBlock::image(media_type, encode(&bytes)))
}

/// Identifica o formato pelos bytes iniciais.
fn recognize(bytes: &[u8]) -> Option<&'static str> {
    let (_, media_type) = RECOGNIZED
        .iter()
        .find(|(magic, _)| bytes.starts_with(magic))?;

    // `RIFF` sozinho também é WAV e AVI; sem esta conferência um áudio passaria
    // por imagem e o backend recusaria três camadas adiante.
    if *media_type == "image/webp" && bytes.get(8..12) != Some(b"WEBP") {
        return None;
    }
    Some(media_type)
}

/// Codifica em base64 padrão, sem quebras de linha.
///
/// Escrito à mão em vez de trazer uma crate: são vinte linhas, e a alternativa
/// era mais uma dependência na árvore que o `cargo deny` audita.
fn encode(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let packed = chunk.iter().enumerate().fold(0_u32, |acc, (i, byte)| {
            acc | (u32::from(*byte) << (16 - 8 * i))
        });

        for slot in 0..4 {
            // Um grupo incompleto vira `=`: sem o preenchimento o decodificador
            // não sabe quantos bytes o último grupo carrega.
            if slot > chunk.len() {
                out.push('=');
                continue;
            }
            let index = (packed >> (18 - 6 * slot)) & 0b0011_1111;
            out.push(char::from(ALPHABET[index as usize]));
        }
    }
    out
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
mod tests {
    use super::*;
    use nycode_ai::anthropic::ImageSource;

    fn png() -> Vec<u8> {
        let mut bytes = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
        bytes.extend_from_slice(b"conteudo falso de imagem");
        bytes
    }

    fn written(name: &str, bytes: &[u8]) -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(name);
        std::fs::write(&path, bytes).unwrap();
        (dir, path)
    }

    #[test]
    fn a_png_becomes_a_base64_block_with_its_media_type() {
        let (_dir, path) = written("captura.png", &png());

        match attach(&path).unwrap() {
            ContentBlock::Image {
                source: ImageSource::Base64 { media_type, data },
            } => {
                assert_eq!(media_type, "image/png");
                assert!(!data.is_empty());
                assert!(!data.contains('\n'), "sem quebra de linha no wire");
            }
            other => panic!("esperava imagem, veio {other:?}"),
        }
    }

    #[test]
    fn the_type_comes_from_the_bytes_and_not_from_the_extension() {
        // Um `.png` que e JPEG faz o backend recusar, e a mensagem dele nao diz
        // por que.
        let (_dir, path) = written("mentira.png", &[0xff, 0xd8, 0xff, 0xe0, 0x00]);

        match attach(&path).unwrap() {
            ContentBlock::Image {
                source: ImageSource::Base64 { media_type, .. },
            } => assert_eq!(media_type, "image/jpeg"),
            other => panic!("esperava imagem, veio {other:?}"),
        }
    }

    #[test]
    fn every_supported_format_is_recognized() {
        assert_eq!(recognize(&png()), Some("image/png"));
        assert_eq!(recognize(&[0xff, 0xd8, 0xff]), Some("image/jpeg"));
        assert_eq!(recognize(b"GIF87a...."), Some("image/gif"));
        assert_eq!(recognize(b"GIF89a...."), Some("image/gif"));
        assert_eq!(recognize(b"RIFF\0\0\0\0WEBP"), Some("image/webp"));
    }

    #[test]
    fn a_riff_file_that_is_not_webp_is_refused() {
        // `RIFF` tambem e WAV e AVI; sem a conferencia um audio passaria por
        // imagem e o backend recusaria tres camadas adiante.
        assert_eq!(recognize(b"RIFF\0\0\0\0WAVE"), None);
        assert_eq!(recognize(b"RIFF"), None);
    }

    #[test]
    fn a_file_that_is_not_an_image_says_so_before_the_request() {
        let (_dir, path) = written("notas.txt", b"isto e texto");
        let err = attach(&path).unwrap_err();
        assert!(err.to_string().contains("nao e PNG"), "{err}");
    }

    #[test]
    fn a_file_that_does_not_exist_names_itself() {
        let err = attach(Path::new("/nao/existe/foto.png")).unwrap_err();
        assert!(err.to_string().contains("foto.png"), "{err}");
    }

    #[test]
    fn an_image_over_the_ceiling_is_refused_before_the_upload() {
        // Descobrir o limite depois de esperar o upload e pior que saber antes.
        let mut huge = png();
        huge.resize(MAX_BYTES + 1, 0);
        let (_dir, path) = written("enorme.png", &huge);

        let err = attach(&path).unwrap_err();
        assert!(err.to_string().contains("teto"), "{err}");
    }

    #[test]
    fn the_encoding_matches_the_base64_standard() {
        // Vetores do RFC 4648. Errar o preenchimento produz dados que o
        // decodificador do backend rejeita sem dizer o motivo.
        assert_eq!(encode(b""), "");
        assert_eq!(encode(b"f"), "Zg==");
        assert_eq!(encode(b"fo"), "Zm8=");
        assert_eq!(encode(b"foo"), "Zm9v");
        assert_eq!(encode(b"foob"), "Zm9vYg==");
        assert_eq!(encode(b"fooba"), "Zm9vYmE=");
        assert_eq!(encode(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn the_encoding_covers_the_whole_byte_range() {
        // Um byte alto mal deslocado sairia como caractere errado, e so um
        // vetor com todos os valores pega isso.
        let all: Vec<u8> = (0..=255).collect();
        let encoded = encode(&all);

        assert_eq!(encoded.len(), 344);
        assert!(
            encoded
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '/' || c == '=')
        );
    }
}
