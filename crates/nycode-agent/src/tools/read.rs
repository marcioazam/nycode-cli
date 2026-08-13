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

        let read = match crate::capped::read(&path, MAX_BYTES).await {
            Ok(read) => read,
            Err(err) => {
                return ToolOutput::error(format!("nao foi possivel ler {requested}: {err}"));
            }
        };
        let truncated = read.truncated();

        let text = match std::str::from_utf8(&read.bytes) {
            Ok(text) => text,
            // Cortar no teto pode partir um codepoint ao meio, e isso não é o
            // mesmo que um binário: ali o inválido está só nas últimas bytes.
            Err(err) if truncated && read.bytes.len() - err.valid_up_to() < 4 => read.text(),
            // Um binario lido como texto vira lixo no contexto e desperdica
            // tokens.
            Err(_) => {
                return ToolOutput::error(format!(
                    "{requested} nao e texto UTF-8 ({} bytes)",
                    read.total
                ));
            }
        };

        let mut out = String::with_capacity(text.len() + 64);
        for (n, line) in text.lines().enumerate() {
            let _ = writeln!(out, "{:>6}\t{line}", n + 1);
        }
        if truncated {
            let _ = write!(
                out,
                "\n[truncado em {MAX_BYTES} bytes; o arquivo tem {}]\n",
                read.total
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
        assert!(out.content.contains("UTF-8"));
    }

    #[tokio::test]
    async fn oversized_files_are_truncated_and_say_so() {
        // Truncar em silencio faria o modelo raciocinar sobre um arquivo que ele
        // acha que leu inteiro.
        let (dir, ctx) = workspace();
        let big = "x".repeat(MAX_BYTES + 5_000);
        std::fs::write(dir.path().join("big.txt"), &big).unwrap();

        let out = Read.execute(json!({ "path": "big.txt" }), &ctx).await;
        assert!(!out.is_error);
        assert!(out.content.contains("[truncado em"));
        assert!(out.content.contains(&(MAX_BYTES + 5_000).to_string()));
    }

    #[tokio::test]
    async fn a_codepoint_split_by_the_ceiling_is_not_mistaken_for_a_binary() {
        // O corte no teto cai no meio de um caractere de dois bytes. Recusar o
        // arquivo como binario perderia um texto perfeitamente legivel.
        let (dir, ctx) = workspace();
        let mut big = "x".repeat(MAX_BYTES - 1);
        big.push_str(&"ç".repeat(10));
        std::fs::write(dir.path().join("acentos.txt"), &big).unwrap();

        let out = Read.execute(json!({ "path": "acentos.txt" }), &ctx).await;

        assert!(!out.is_error, "{}", out.content);
        assert!(out.content.contains("[truncado em"));
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
