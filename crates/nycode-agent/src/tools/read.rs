//! Ferramenta `read`: lê um arquivo do workspace.

use std::fmt::Write as _;

use async_trait::async_trait;
use serde_json::{Value, json};

use crate::tool::{Tool, ToolContext, ToolOutput};

/// Teto de bytes lidos numa chamada.
///
/// Um arquivo grande despejado no contexto consome a janela inteira e empurra
/// para fora exatamente o histórico que o agente precisa. Truncar e avisar é
/// melhor que estourar o turno.
const MAX_BYTES: usize = 256 * 1024;

#[derive(Debug, Default, Clone, Copy)]
pub struct Read;

#[async_trait]
// `unnecessary_literal_bound` sugere `&'static str`, mas a assinatura vem do
// trait, que precisa do emprestimo: uma ferramenta MCP carrega o nome vindo do
// servidor em runtime, nao um literal.
#[allow(clippy::unnecessary_literal_bound)]
impl Tool for Read {
    fn name(&self) -> &str {
        "read"
    }

    fn description(&self) -> &str {
        "Le o conteudo de um arquivo do workspace. O caminho e relativo a raiz do \
         projeto. Retorna o conteudo com numeracao de linha."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Caminho do arquivo, relativo a raiz do workspace"
                },
                "offset": {
                    "type": "integer",
                    "description": "Linha por onde comecar, contando de 1. Padrao: 1"
                },
                "limit": {
                    "type": "integer",
                    "description": "Quantas linhas devolver. Padrao: o que couber no teto"
                }
            },
            "required": ["path"]
        })
    }

    async fn execute(&self, input: Value, ctx: &ToolContext) -> ToolOutput {
        let Some(requested) = input.get("path").and_then(Value::as_str) else {
            return ToolOutput::error("argumento obrigatorio ausente: `path`");
        };

        let path = match ctx.resolve(requested) {
            Ok(path) => path,
            Err(err) => return ToolOutput::error(err.to_string()),
        };

        // Pelo descritor, e não pelo caminho: `resolve` decidiu que este
        // caminho está dentro da raiz, e reabrir por caminho deixaria a decisão
        // valer só até alguém trocar um componente por link.
        let opened = match crate::tool::contain::open_read_async(ctx.root(), &path) {
            Ok(file) => file,
            Err(err) => {
                return ToolOutput::error(format!("nao foi possivel ler {requested}: {err}"));
            }
        };

        let offset = input.get("offset").and_then(Value::as_u64).unwrap_or(1);
        let limit = input.get("limit").and_then(Value::as_u64);

        let window = match crate::capped::read_window(opened, offset, limit, MAX_BYTES).await {
            Ok(window) => window,
            Err(err) => {
                return ToolOutput::error(format!("nao foi possivel ler {requested}: {err}"));
            }
        };
        if window.binary {
            // Um binário lido como texto vira lixo no contexto e desperdiça
            // tokens.
            return ToolOutput::error(format!("{requested} nao e texto"));
        }
        if window.lines == 0 {
            // Vazio faria o modelo concluir que o arquivo acabou; dizer que a
            // linha não existe é o que o faz corrigir o `offset`.
            return ToolOutput::ok(if window.first > 1 {
                format!("{requested} nao tem a linha {}", window.first)
            } else {
                format!("{requested} esta vazio")
            });
        }

        let mut out = String::with_capacity(window.text.len() + 96);
        for (n, line) in window.text.lines().enumerate() {
            let _ = writeln!(out, "{:>6}\t{line}", window.first + n as u64);
        }
        if window.more {
            // O aviso diz o próximo passo em vez de só constatar o corte: sem o
            // `offset`, o modelo gasta um turno descobrindo como continuar.
            let _ = write!(
                out,
                "\n[mostrando as linhas {}-{}; use offset={} para continuar]\n",
                window.first,
                window.next_offset() - 1,
                window.next_offset()
            );
        }
        ToolOutput::ok(out)
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
mod tests {
    use super::*;

    fn workspace() -> (tempfile::TempDir, ToolContext) {
        let dir = tempfile::tempdir().unwrap();
        let ctx = ToolContext::new(dir.path()).unwrap();
        (dir, ctx)
    }

    #[tokio::test]
    async fn reads_a_file_with_line_numbers() {
        let (dir, ctx) = workspace();
        std::fs::write(dir.path().join("a.txt"), "primeira\nsegunda\n").unwrap();

        let out = Read.execute(json!({ "path": "a.txt" }), &ctx).await;
        assert!(!out.is_error);
        assert!(out.content.contains("     1\tprimeira"));
        assert!(out.content.contains("     2\tsegunda"));
    }

    #[tokio::test]
    async fn a_missing_file_is_an_error_result_not_a_silent_empty_read() {
        // Devolver string vazia faria o modelo concluir que o arquivo existe e
        // esta vazio, que e uma afirmacao diferente e falsa.
        let (_dir, ctx) = workspace();
        let out = Read.execute(json!({ "path": "ausente.txt" }), &ctx).await;
        assert!(out.is_error);
        assert!(out.content.contains("ausente.txt"));
    }

    #[tokio::test]
    async fn path_traversal_is_refused() {
        let (_dir, ctx) = workspace();
        let out = Read
            .execute(json!({ "path": "../../../etc/passwd" }), &ctx)
            .await;
        assert!(out.is_error);
        assert!(out.content.contains("fora da raiz"));
    }

    #[tokio::test]
    async fn a_missing_path_argument_is_reported_as_such() {
        let (_dir, ctx) = workspace();
        let out = Read.execute(json!({}), &ctx).await;
        assert!(out.is_error);
        assert!(out.content.contains("path"));
    }

    #[tokio::test]
    async fn binary_files_are_refused_instead_of_dumped_as_garbage() {
        let (dir, ctx) = workspace();
        std::fs::write(dir.path().join("bin"), [0xff_u8, 0xfe, 0x00, 0x01]).unwrap();

        let out = Read.execute(json!({ "path": "bin" }), &ctx).await;
        assert!(out.is_error);
        assert!(out.content.contains("nao e texto"), "{}", out.content);
    }

    #[tokio::test]
    async fn a_file_of_null_bytes_is_binary_even_though_it_is_valid_utf8() {
        // `\0` e UTF-8 valido, entao a recusa por falha de decodificacao
        // deixava passar exatamente o arquivo que menos serve ao modelo.
        let (dir, ctx) = workspace();
        std::fs::write(dir.path().join("nulos.bin"), [0u8; 64]).unwrap();

        let out = Read.execute(json!({ "path": "nulos.bin" }), &ctx).await;
        assert!(out.is_error, "{}", out.content);
    }

    #[tokio::test]
    async fn a_truncated_read_says_how_to_continue_instead_of_only_that_it_cut() {
        // Sem o proximo `offset` o modelo gasta um turno descobrindo como
        // seguir, ou conclui que o resto do arquivo e inalcancavel — que era o
        // caso, porque o schema so aceitava `path`.
        let (dir, ctx) = workspace();
        let big = format!("{}\n", vec!["linha"; 200_000].join("\n"));
        std::fs::write(dir.path().join("big.txt"), &big).unwrap();

        let out = Read.execute(json!({ "path": "big.txt" }), &ctx).await;

        assert!(!out.is_error, "{}", out.content);
        assert!(out.content.contains("use offset="), "{}", out.content);
    }

    #[tokio::test]
    async fn the_offset_continues_from_where_the_previous_call_stopped() {
        let (dir, ctx) = workspace();
        std::fs::write(dir.path().join("linhas.txt"), "um\ndois\ntres\nquatro\n").unwrap();

        let out = Read
            .execute(json!({ "path": "linhas.txt", "offset": 3 }), &ctx)
            .await;

        assert!(out.content.contains("tres"), "{}", out.content);
        assert!(!out.content.contains("dois"), "{}", out.content);
        assert!(
            out.content.contains("     3\t"),
            "a numeracao e absoluta: {}",
            out.content
        );
    }

    #[tokio::test]
    async fn a_limit_bounds_how_much_comes_back() {
        let (dir, ctx) = workspace();
        std::fs::write(dir.path().join("linhas.txt"), "um\ndois\ntres\nquatro\n").unwrap();

        let out = Read
            .execute(json!({ "path": "linhas.txt", "limit": 2 }), &ctx)
            .await;

        assert!(out.content.contains("um"), "{}", out.content);
        assert!(!out.content.contains("tres"), "{}", out.content);
        assert!(out.content.contains("use offset=3"), "{}", out.content);
    }

    #[tokio::test]
    async fn an_offset_past_the_end_says_so_instead_of_answering_empty() {
        // Vazio faria o modelo concluir que leu tudo.
        let (dir, ctx) = workspace();
        std::fs::write(dir.path().join("curto.txt"), "so uma linha\n").unwrap();

        let out = Read
            .execute(json!({ "path": "curto.txt", "offset": 99 }), &ctx)
            .await;

        assert!(!out.is_error);
        assert!(
            out.content.contains("nao tem a linha 99"),
            "{}",
            out.content
        );
    }

    #[tokio::test]
    async fn a_codepoint_split_by_the_ceiling_is_not_mistaken_for_a_binary() {
        // O corte cai no meio de um caractere de dois bytes. Recusar o arquivo
        // como binario perderia um texto perfeitamente legivel.
        let (dir, ctx) = workspace();
        let mut big = "x".repeat(MAX_BYTES - 1);
        big.push_str(&"ç".repeat(10));
        std::fs::write(dir.path().join("acentos.txt"), &big).unwrap();

        let out = Read.execute(json!({ "path": "acentos.txt" }), &ctx).await;

        assert!(!out.is_error, "{}", out.content);
    }

    #[test]
    fn schema_declares_path_as_required() {
        let schema = Read.input_schema();
        assert_eq!(schema["required"][0], "path");
        assert_eq!(schema["properties"]["path"]["type"], "string");
        assert_eq!(Read.name(), "read");
        assert!(!Read.description().is_empty());
    }
}
