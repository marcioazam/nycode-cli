//! Ferramenta `find`: busca arquivos por nome.

use std::fmt::Write as _;

use async_trait::async_trait;
use serde_json::{Value, json};

use super::walk;
use crate::tool::{Tool, ToolContext, ToolOutput};

/// Teto de caminhos devolvidos.
const MAX_RESULTS: usize = 300;

#[derive(Debug, Default, Clone, Copy)]
pub struct Find;

#[async_trait]
#[allow(clippy::unnecessary_literal_bound)]
impl Tool for Find {
    fn name(&self) -> &str {
        "find"
    }

    fn description(&self) -> &str {
        "Lista os arquivos do workspace cujo nome casa com um padrao, usando `*` \
         e `?`. Exemplo: `*.rs`. Nao modifica nada."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "pattern": {
                    "type": "string",
                    "description": "Padrao de nome de arquivo, com `*` e `?`"
                },
                "path": {
                    "type": "string",
                    "description": "Subdiretorio onde buscar, relativo a raiz. Padrao: a raiz"
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
            return ToolOutput::error("`pattern` vazio nao casa com nada");
        }

        let root = match input.get("path").and_then(Value::as_str) {
            Some(requested) => match ctx.resolve(requested) {
                Ok(path) => path,
                Err(err) => return ToolOutput::error(err.to_string()),
            },
            None => ctx.root().to_path_buf(),
        };

        // O padrão casa contra o nome do arquivo, e também contra o caminho
        // relativo: um modelo escreve tanto `*.rs` quanto `src/*.rs`.
        let hits: Vec<_> = walk::files(&root)
            .into_iter()
            .filter(|found| {
                let name = found.relative.rsplit('/').next().unwrap_or(&found.relative);
                walk::matches_glob(pattern, name) || walk::matches_glob(pattern, &found.relative)
            })
            .collect();

        if hits.is_empty() {
            return ToolOutput::ok(format!("nenhum arquivo casa com `{pattern}`"));
        }

        let truncated = hits.len() > MAX_RESULTS;
        let mut out = String::new();
        for found in hits.iter().take(MAX_RESULTS) {
            let _ = writeln!(out, "{}", found.relative);
        }
        if truncated {
            let _ = write!(
                out,
                "\n[truncado em {MAX_RESULTS} de {} resultados]",
                hits.len()
            );
        }
        ToolOutput::ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn workspace() -> (tempfile::TempDir, ToolContext) {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("src/nested")).unwrap();
        std::fs::create_dir_all(root.join("docs")).unwrap();
        std::fs::write(root.join("src/main.rs"), "").unwrap();
        std::fs::write(root.join("src/nested/deep.rs"), "").unwrap();
        std::fs::write(root.join("docs/guia.md"), "").unwrap();
        std::fs::write(root.join("README.md"), "").unwrap();
        let ctx = ToolContext::new(root).unwrap();
        (dir, ctx)
    }

    async fn find(input: Value) -> ToolOutput {
        let (_dir, ctx) = workspace();
        Find.execute(input, &ctx).await
    }

    #[tokio::test]
    async fn an_extension_pattern_finds_files_at_every_depth() {
        let out = find(json!({ "pattern": "*.rs" })).await;
        assert!(!out.is_error);
        assert!(out.content.contains("src/main.rs"), "{}", out.content);
        assert!(
            out.content.contains("src/nested/deep.rs"),
            "{}",
            out.content
        );
        assert!(!out.content.contains(".md"), "{}", out.content);
    }

    #[tokio::test]
    async fn a_path_shaped_pattern_also_works() {
        // Um modelo escreve tanto `*.rs` quanto `src/*.rs`; recusar o segundo
        // faria a ferramenta parecer quebrada.
        let out = find(json!({ "pattern": "docs/*" })).await;
        assert!(out.content.contains("docs/guia.md"), "{}", out.content);
        assert!(!out.content.contains("README"), "{}", out.content);
    }

    #[tokio::test]
    async fn the_results_are_in_a_stable_order() {
        let first = find(json!({ "pattern": "*" })).await;
        let second = find(json!({ "pattern": "*" })).await;
        assert_eq!(first.content, second.content);
    }

    #[tokio::test]
    async fn no_match_says_so_instead_of_answering_empty() {
        let out = find(json!({ "pattern": "*.py" })).await;
        assert!(!out.is_error);
        assert!(out.content.contains("nenhum arquivo"), "{}", out.content);
    }

    #[tokio::test]
    async fn the_search_can_be_narrowed_to_a_subdirectory() {
        let out = find(json!({ "pattern": "*.rs", "path": "src/nested" })).await;
        assert!(out.content.contains("deep.rs"), "{}", out.content);
        assert!(!out.content.contains("main.rs"), "{}", out.content);
    }

    #[tokio::test]
    async fn a_path_outside_the_workspace_is_refused() {
        let out = find(json!({ "pattern": "*", "path": "../fora" })).await;
        assert!(out.is_error);
    }

    #[tokio::test]
    async fn an_empty_or_missing_pattern_is_refused() {
        assert!(find(json!({})).await.is_error);
        assert!(find(json!({ "pattern": "" })).await.is_error);
    }

    #[tokio::test]
    async fn too_many_results_are_truncated_and_say_so() {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..(MAX_RESULTS + 20) {
            std::fs::write(dir.path().join(format!("a{i:04}.txt")), "").unwrap();
        }
        let ctx = ToolContext::new(dir.path()).unwrap();

        let out = Find.execute(json!({ "pattern": "*.txt" }), &ctx).await;
        assert!(out.content.contains("truncado"), "{}", out.content);
    }
}
