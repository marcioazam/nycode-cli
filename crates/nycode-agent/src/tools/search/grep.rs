//! Ferramenta `grep`: busca um padrão no conteúdo dos arquivos.
//!
//! O agente já tem `bash` e poderia chamar `grep` por lá. Esta existe para a
//! sessão restringida: sem ela, negar `bash` deixa o agente cego, e a escolha
//! passa a ser entre dar shell ou não ter agente.

use std::fmt::Write as _;

use async_trait::async_trait;
use serde_json::{Value, json};

use super::walk;
use crate::tool::{Tool, ToolContext, ToolOutput};

/// Teto de linhas devolvidas.
///
/// Um padrão que casa com tudo produziria uma resposta maior que a janela.
const MAX_MATCHES: usize = 200;

/// Teto de bytes por linha exibida.
///
/// Um arquivo minificado tem linhas de megabytes; uma delas basta para estourar
/// a janela.
const MAX_LINE: usize = 300;

#[derive(Debug, Default, Clone, Copy)]
pub struct Grep;

#[async_trait]
#[allow(clippy::unnecessary_literal_bound)]
impl Tool for Grep {
    fn name(&self) -> &str {
        "grep"
    }

    fn description(&self) -> &str {
        "Busca um texto no conteudo dos arquivos do workspace e devolve as linhas \
         que casam, com caminho e numero de linha. Aceita um filtro de nome de \
         arquivo em `glob`. Nao modifica nada."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "pattern": {
                    "type": "string",
                    "description": "Texto a procurar no conteudo dos arquivos"
                },
                "path": {
                    "type": "string",
                    "description": "Subdiretorio onde buscar, relativo a raiz. Padrao: a raiz"
                },
                "glob": {
                    "type": "string",
                    "description": "Filtro de nome de arquivo, com `*` e `?`. Exemplo: `*.rs`"
                },
                "case_sensitive": {
                    "type": "boolean",
                    "description": "Diferenciar maiusculas de minusculas. Padrao: false"
                }
            },
            "required": ["pattern"]
        })
    }

    async fn execute(&self, input: Value, ctx: &ToolContext) -> ToolOutput {
        let Some(pattern) = input.get("pattern").and_then(Value::as_str) else {
            return ToolOutput::error("argumento obrigatorio ausente: `pattern`");
        };
        if pattern.is_empty() {
            return ToolOutput::error("`pattern` vazio casaria com tudo");
        }

        let root = match resolve_scope(&input, ctx) {
            Ok(root) => root,
            Err(message) => return ToolOutput::error(message),
        };
        let glob = input.get("glob").and_then(Value::as_str);
        let case_sensitive = input
            .get("case_sensitive")
            .and_then(Value::as_bool)
            .unwrap_or(false);

        let needle = if case_sensitive {
            pattern.to_owned()
        } else {
            pattern.to_lowercase()
        };

        let mut out = String::new();
        let mut matches = 0;
        let mut truncated = false;

        for found in walk::files(&root) {
            if let Some(glob) = glob {
                let name = found.relative.rsplit('/').next().unwrap_or(&found.relative);
                if !walk::matches_glob(glob, name) {
                    continue;
                }
            }
            // Um binário lido como texto vira lixo no contexto; pular é melhor
            // que despejar bytes que não significam nada para o modelo.
            let Ok(contents) = std::fs::read_to_string(&found.path) else {
                continue;
            };

            for (number, line) in contents.lines().enumerate() {
                let haystack = if case_sensitive {
                    line.to_owned()
                } else {
                    line.to_lowercase()
                };
                if !haystack.contains(&needle) {
                    continue;
                }

                if matches >= MAX_MATCHES {
                    truncated = true;
                    break;
                }
                matches += 1;
                let _ = writeln!(
                    out,
                    "{}:{}: {}",
                    found.relative,
                    number + 1,
                    clip(line.trim_end())
                );
            }
            if truncated {
                break;
            }
        }

        if matches == 0 {
            // Uma resposta vazia faria o modelo suspeitar da ferramenta em vez
            // de concluir que o termo não existe.
            return ToolOutput::ok(format!("nenhuma linha casa com `{pattern}`"));
        }
        if truncated {
            let _ = write!(out, "\n[truncado em {MAX_MATCHES} resultados]");
        }
        ToolOutput::ok(out)
    }
}

/// Resolve o subdiretório da busca, ou a raiz.
fn resolve_scope(input: &Value, ctx: &ToolContext) -> Result<std::path::PathBuf, String> {
    let Some(requested) = input.get("path").and_then(Value::as_str) else {
        return Ok(ctx.root().to_path_buf());
    };
    ctx.resolve(requested).map_err(|err| err.to_string())
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
mod tests {
    use super::*;

    fn workspace() -> (tempfile::TempDir, ToolContext) {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::write(
            root.join("src/main.rs"),
            "fn main() {\n    let alvo = 1;\n}\n",
        )
        .unwrap();
        std::fs::write(root.join("src/lib.rs"), "// nada aqui\n").unwrap();
        std::fs::write(root.join("notas.md"), "o ALVO aparece aqui tambem\n").unwrap();
        let ctx = ToolContext::new(root).unwrap();
        (dir, ctx)
    }

    async fn grep(input: Value) -> ToolOutput {
        let (_dir, ctx) = workspace();
        Grep.execute(input, &ctx).await
    }

    #[tokio::test]
    async fn finds_the_line_with_its_path_and_number() {
        let out = grep(json!({ "pattern": "alvo" })).await;
        assert!(!out.is_error);
        assert!(out.content.contains("src/main.rs:2:"), "{}", out.content);
        assert!(out.content.contains("let alvo = 1;"), "{}", out.content);
    }

    #[tokio::test]
    async fn the_search_ignores_case_by_default() {
        // Um modelo escreve o termo como lembra; exigir caixa exata faria a
        // ferramenta parecer quebrada.
        let out = grep(json!({ "pattern": "alvo" })).await;
        assert!(out.content.contains("notas.md"), "{}", out.content);
    }

    #[tokio::test]
    async fn case_sensitive_narrows_the_search_when_asked() {
        let out = grep(json!({ "pattern": "ALVO", "case_sensitive": true })).await;
        assert!(out.content.contains("notas.md"), "{}", out.content);
        assert!(!out.content.contains("main.rs"), "{}", out.content);
    }

    #[tokio::test]
    async fn a_glob_restricts_which_files_are_searched() {
        let out = grep(json!({ "pattern": "alvo", "glob": "*.md" })).await;
        assert!(out.content.contains("notas.md"), "{}", out.content);
        assert!(!out.content.contains("main.rs"), "{}", out.content);
    }

    #[tokio::test]
    async fn no_match_says_so_instead_of_answering_empty() {
        // Resposta vazia faria o modelo suspeitar da ferramenta em vez de
        // concluir que o termo nao existe.
        let out = grep(json!({ "pattern": "inexistente" })).await;
        assert!(!out.is_error);
        assert!(out.content.contains("nenhuma linha"), "{}", out.content);
    }

    #[tokio::test]
    async fn an_empty_pattern_is_refused_rather_than_matching_everything() {
        let out = grep(json!({ "pattern": "" })).await;
        assert!(out.is_error);
    }

    #[tokio::test]
    async fn a_missing_pattern_names_the_argument() {
        let out = grep(json!({})).await;
        assert!(out.is_error);
        assert!(out.content.contains("pattern"), "{}", out.content);
    }

    #[tokio::test]
    async fn the_search_can_be_narrowed_to_a_subdirectory() {
        let out = grep(json!({ "pattern": "alvo", "path": "src" })).await;
        assert!(out.content.contains("main.rs"), "{}", out.content);
        assert!(!out.content.contains("notas.md"), "{}", out.content);
    }

    #[tokio::test]
    async fn a_path_outside_the_workspace_is_refused() {
        let out = grep(json!({ "pattern": "x", "path": "../fora" })).await;
        assert!(out.is_error);
    }

    #[tokio::test]
    async fn a_binary_file_is_skipped_rather_than_dumped() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("bin.dat"), [0xff, 0xfe, 0x00, 0x01]).unwrap();
        std::fs::write(dir.path().join("texto.txt"), "alvo\n").unwrap();
        let ctx = ToolContext::new(dir.path()).unwrap();

        let out = Grep.execute(json!({ "pattern": "alvo" }), &ctx).await;
        assert!(out.content.contains("texto.txt"), "{}", out.content);
        assert!(!out.content.contains("bin.dat"), "{}", out.content);
    }

    #[tokio::test]
    async fn a_very_long_line_is_clipped_instead_of_flooding_the_window() {
        let dir = tempfile::tempdir().unwrap();
        let long = format!("alvo{}", "x".repeat(5000));
        std::fs::write(dir.path().join("minificado.js"), long).unwrap();
        let ctx = ToolContext::new(dir.path()).unwrap();

        let out = Grep.execute(json!({ "pattern": "alvo" }), &ctx).await;
        assert!(out.content.ends_with("...\n"), "{}", out.content);
        assert!(out.content.len() < 1000, "{} bytes", out.content.len());
    }

    #[tokio::test]
    async fn too_many_matches_are_truncated_and_say_so() {
        let dir = tempfile::tempdir().unwrap();
        let many = "alvo\n".repeat(MAX_MATCHES + 50);
        std::fs::write(dir.path().join("muitos.txt"), many).unwrap();
        let ctx = ToolContext::new(dir.path()).unwrap();

        let out = Grep.execute(json!({ "pattern": "alvo" }), &ctx).await;
        assert!(out.content.contains("truncado"), "{}", out.content);
        assert_eq!(
            out.content.lines().filter(|l| l.contains("muitos")).count(),
            MAX_MATCHES
        );
    }
}
