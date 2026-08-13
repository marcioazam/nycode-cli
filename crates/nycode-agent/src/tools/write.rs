//! Ferramenta `write`: cria ou substitui um arquivo.

use async_trait::async_trait;
use serde_json::{Value, json};

use crate::tool::{Tool, ToolContext, ToolOutput};

#[derive(Debug, Default, Clone, Copy)]
pub struct Write;

#[async_trait]
#[allow(clippy::unnecessary_literal_bound)]
impl Tool for Write {
    fn name(&self) -> &str {
        "write"
    }

    fn description(&self) -> &str {
        "Escreve conteudo num arquivo do workspace, criando os diretorios \
         intermediarios. Substitui o conteudo existente por completo; para \
         alteracoes pontuais prefira `edit`."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "Caminho relativo a raiz" },
                "content": { "type": "string", "description": "Conteudo completo do arquivo" }
            },
            "required": ["path", "content"]
        })
    }

    async fn execute(&self, input: Value, ctx: &ToolContext) -> ToolOutput {
        let Some(requested) = input.get("path").and_then(Value::as_str) else {
            return ToolOutput::error("argumento obrigatorio ausente: `path`");
        };
        // Distinguir ausente de vazio importa: escrever `""` e uma operacao
        // legitima, esquecer o argumento e um erro do modelo.
        let Some(content) = input.get("content").and_then(Value::as_str) else {
            return ToolOutput::error("argumento obrigatorio ausente: `content`");
        };

        let path = match ctx.resolve(requested) {
            Ok(path) => path,
            Err(err) => return ToolOutput::error(err.to_string()),
        };

        if path.is_dir() {
            return ToolOutput::error(format!("{requested} e um diretorio"));
        }

        if let Some(parent) = path.parent()
            && let Err(err) = tokio::fs::create_dir_all(parent).await
        {
            return ToolOutput::error(format!(
                "nao foi possivel criar {}: {err}",
                parent.display()
            ));
        }

        let existed = path.exists();
        match tokio::fs::write(&path, content).await {
            Ok(()) => {
                let verb = if existed { "substituido" } else { "criado" };
                ToolOutput::ok(format!("{requested} {verb} ({} bytes)", content.len()))
            }
            Err(err) => ToolOutput::error(format!("nao foi possivel escrever {requested}: {err}")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn workspace() -> (tempfile::TempDir, ToolContext) {
        let dir = tempfile::tempdir().unwrap();
        let ctx = ToolContext::new(dir.path()).unwrap();
        (dir, ctx)
    }

    #[tokio::test]
    async fn creates_a_file_and_reports_it_as_created() {
        let (dir, ctx) = workspace();
        let out = Write
            .execute(json!({ "path": "a.txt", "content": "ola" }), &ctx)
            .await;

        assert!(!out.is_error);
        assert!(out.content.contains("criado"));
        assert_eq!(
            std::fs::read_to_string(dir.path().join("a.txt")).unwrap(),
            "ola"
        );
    }

    #[tokio::test]
    async fn replacing_an_existing_file_says_so() {
        // O modelo precisa saber que sobrescreveu, nao criou: a diferenca muda o
        // que ele reporta ao usuario.
        let (dir, ctx) = workspace();
        std::fs::write(dir.path().join("a.txt"), "antes").unwrap();

        let out = Write
            .execute(json!({ "path": "a.txt", "content": "depois" }), &ctx)
            .await;
        assert!(out.content.contains("substituido"));
        assert_eq!(
            std::fs::read_to_string(dir.path().join("a.txt")).unwrap(),
            "depois"
        );
    }

    #[tokio::test]
    async fn creates_intermediate_directories() {
        let (dir, ctx) = workspace();
        let out = Write
            .execute(json!({ "path": "a/b/c.txt", "content": "x" }), &ctx)
            .await;

        assert!(!out.is_error, "{}", out.content);
        assert!(dir.path().join("a/b/c.txt").exists());
    }

    #[tokio::test]
    async fn writing_an_empty_string_is_legitimate_but_omitting_content_is_not() {
        let (dir, ctx) = workspace();

        let empty = Write
            .execute(json!({ "path": "vazio.txt", "content": "" }), &ctx)
            .await;
        assert!(!empty.is_error);
        assert_eq!(
            std::fs::read_to_string(dir.path().join("vazio.txt")).unwrap(),
            ""
        );

        let missing = Write.execute(json!({ "path": "x.txt" }), &ctx).await;
        assert!(missing.is_error);
        assert!(missing.content.contains("content"));
    }

    #[tokio::test]
    async fn path_traversal_is_refused() {
        let (_dir, ctx) = workspace();
        let out = Write
            .execute(json!({ "path": "../fora.txt", "content": "x" }), &ctx)
            .await;
        assert!(out.is_error);
        assert!(out.content.contains("fora da raiz"));
    }

    #[tokio::test]
    async fn writing_over_a_directory_is_refused_with_a_clear_message() {
        let (dir, ctx) = workspace();
        std::fs::create_dir(dir.path().join("umdir")).unwrap();

        let out = Write
            .execute(json!({ "path": "umdir", "content": "x" }), &ctx)
            .await;
        assert!(out.is_error);
        assert!(out.content.contains("diretorio"));
    }

    #[test]
    fn the_schema_requires_both_arguments() {
        let schema = Write.input_schema();
        let required: Vec<_> = schema["required"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap())
            .collect();
        assert!(required.contains(&"path"));
        assert!(required.contains(&"content"));
        assert_eq!(Write.name(), "write");
    }
}
