//! Ferramenta `edit`: substituição textual exata.

use async_trait::async_trait;
use serde_json::{Value, json};

use crate::tool::{Tool, ToolContext, ToolOutput};

/// Teto de bytes de um arquivo editável.
///
/// Generoso para qualquer arquivo de código real, e ainda assim um teto: sem
/// ele, editar um arquivo de dois gigabytes aloca o arquivo e mais uma cópia
/// dele num processo cujo orçamento de memória residente é de `30 MiB` (NFR-2).
const MAX_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Default, Clone, Copy)]
pub struct Edit;

#[async_trait]
#[allow(clippy::unnecessary_literal_bound)]
impl Tool for Edit {
    fn name(&self) -> &str {
        "edit"
    }

    fn description(&self) -> &str {
        "Substitui uma ocorrencia exata de texto num arquivo. O texto procurado \
         precisa ser unico no arquivo; inclua contexto ao redor para garantir isso."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "Caminho relativo a raiz" },
                "old_string": { "type": "string", "description": "Texto exato a substituir" },
                "new_string": { "type": "string", "description": "Texto que entra no lugar" }
            },
            "required": ["path", "old_string", "new_string"]
        })
    }

    async fn execute(&self, input: Value, ctx: &ToolContext) -> ToolOutput {
        let field = |name: &str| input.get(name).and_then(Value::as_str);

        let (Some(requested), Some(old), Some(new)) =
            (field("path"), field("old_string"), field("new_string"))
        else {
            return ToolOutput::error(
                "argumentos obrigatorios: `path`, `old_string` e `new_string`",
            );
        };

        if old == new {
            return ToolOutput::error("`old_string` e `new_string` sao iguais; nada a fazer");
        }
        if old.is_empty() {
            return ToolOutput::error("`old_string` vazio casaria em qualquer posicao");
        }

        let path = match ctx.resolve(requested) {
            Ok(path) => path,
            Err(err) => return ToolOutput::error(err.to_string()),
        };

        let Ok(read) = crate::capped::read(&path, MAX_BYTES).await else {
            return ToolOutput::error(format!("nao foi possivel ler {requested}"));
        };
        // A substituição faz uma cópia, então o pico é o dobro do arquivo.
        // Recusar é melhor que estourar o orçamento de RSS no meio de uma
        // edição e deixar o arquivo por escrever.
        if read.truncated() {
            return ToolOutput::error(format!(
                "{requested} tem {} bytes; o teto para edicao e {MAX_BYTES}",
                read.total
            ));
        }
        let Ok(contents) = std::str::from_utf8(&read.bytes) else {
            return ToolOutput::error(format!("nao foi possivel ler {requested}"));
        };

        // Uma edicao ambigua e o modo classico de corromper um arquivo: o modelo
        // pede a primeira ocorrencia e recebe outra. Recusar e obrigar mais
        // contexto e mais barato que desfazer.
        let occurrences = contents.matches(old).count();
        match occurrences {
            0 => {
                return ToolOutput::error(format!(
                    "`old_string` nao encontrado em {requested}; \
                     confira espacos e indentacao"
                ));
            }
            1 => {}
            n => {
                return ToolOutput::error(format!(
                    "`old_string` aparece {n} vezes em {requested}; \
                     inclua mais contexto para torna-lo unico"
                ));
            }
        }

        let updated = contents.replacen(old, new, 1);
        match tokio::fs::write(&path, &updated).await {
            Ok(()) => ToolOutput::ok(format!(
                "{requested} editado ({} bytes -> {} bytes)",
                contents.len(),
                updated.len()
            )),
            Err(err) => ToolOutput::error(format!("nao foi possivel escrever {requested}: {err}")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn workspace_with(contents: &str) -> (tempfile::TempDir, ToolContext) {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.rs"), contents).unwrap();
        let ctx = ToolContext::new(dir.path()).unwrap();
        (dir, ctx)
    }

    fn edit(old: &str, new: &str) -> Value {
        json!({ "path": "a.rs", "old_string": old, "new_string": new })
    }

    #[tokio::test]
    async fn replaces_a_unique_occurrence() {
        let (dir, ctx) = workspace_with("fn main() {\n    antigo();\n}\n");
        let out = Edit.execute(edit("antigo()", "novo()"), &ctx).await;

        assert!(!out.is_error, "{}", out.content);
        let result = std::fs::read_to_string(dir.path().join("a.rs")).unwrap();
        assert!(result.contains("novo()"));
        assert!(!result.contains("antigo()"));
    }

    #[tokio::test]
    async fn a_file_too_large_to_edit_is_refused_before_it_is_read() {
        // A substituicao faz uma copia, entao o pico e o dobro do arquivo.
        // Recusar e melhor que estourar o orcamento de RSS no meio da edicao e
        // deixar o arquivo por escrever.
        let (dir, ctx) = workspace_with("");
        std::fs::write(dir.path().join("a.rs"), "x".repeat(MAX_BYTES + 1)).unwrap();

        let out = Edit.execute(edit("x", "y"), &ctx).await;

        assert!(out.is_error);
        assert!(out.content.contains("teto para edicao"), "{}", out.content);
        assert_eq!(
            std::fs::metadata(dir.path().join("a.rs")).unwrap().len(),
            (MAX_BYTES + 1) as u64,
            "o arquivo recusado nao pode ser tocado"
        );
    }

    #[tokio::test]
    async fn an_ambiguous_match_is_refused_instead_of_guessing() {
        // Este e o modo classico de corromper um arquivo: o modelo pede a
        // primeira ocorrencia e recebe outra.
        let (dir, ctx) = workspace_with("x = 1;\ny = 1;\n");
        let out = Edit.execute(edit("= 1", "= 2"), &ctx).await;

        assert!(out.is_error);
        assert!(out.content.contains("2 vezes"));
        assert_eq!(
            std::fs::read_to_string(dir.path().join("a.rs")).unwrap(),
            "x = 1;\ny = 1;\n",
            "o arquivo nao pode ser tocado numa edicao ambigua"
        );
    }

    #[tokio::test]
    async fn a_missing_match_says_to_check_whitespace() {
        // Quase sempre a causa e indentacao, e dizer isso economiza uma rodada.
        let (_dir, ctx) = workspace_with("fn main() {}\n");
        let out = Edit.execute(edit("nao existe", "x"), &ctx).await;

        assert!(out.is_error);
        assert!(out.content.contains("indentacao"));
    }

    #[tokio::test]
    async fn an_empty_old_string_is_refused() {
        // String vazia casa em toda posicao; `matches("")` conta n+1 ocorrencias
        // e a substituicao produziria lixo.
        let (_dir, ctx) = workspace_with("conteudo");
        let out = Edit.execute(edit("", "x"), &ctx).await;
        assert!(out.is_error);
        assert!(out.content.contains("qualquer posicao"));
    }

    #[tokio::test]
    async fn an_identical_replacement_is_refused() {
        let (_dir, ctx) = workspace_with("conteudo");
        let out = Edit.execute(edit("conteudo", "conteudo"), &ctx).await;
        assert!(out.is_error);
        assert!(out.content.contains("iguais"));
    }

    #[tokio::test]
    async fn multiline_replacements_work() {
        let (dir, ctx) = workspace_with("a\nb\nc\n");
        let out = Edit.execute(edit("a\nb", "a\nB"), &ctx).await;

        assert!(!out.is_error, "{}", out.content);
        assert_eq!(
            std::fs::read_to_string(dir.path().join("a.rs")).unwrap(),
            "a\nB\nc\n"
        );
    }

    #[tokio::test]
    async fn a_missing_file_and_traversal_are_both_errors() {
        let (_dir, ctx) = workspace_with("x");
        let missing = Edit
            .execute(
                json!({ "path": "z.rs", "old_string": "a", "new_string": "b" }),
                &ctx,
            )
            .await;
        assert!(missing.is_error);

        let escape = Edit
            .execute(
                json!({ "path": "../z", "old_string": "a", "new_string": "b" }),
                &ctx,
            )
            .await;
        assert!(escape.is_error);
        assert!(escape.content.contains("fora da raiz"));
    }

    #[tokio::test]
    async fn missing_arguments_are_reported() {
        let (_dir, ctx) = workspace_with("x");
        let out = Edit.execute(json!({ "path": "a.rs" }), &ctx).await;
        assert!(out.is_error);
        assert!(out.content.contains("old_string"));
    }

    #[test]
    fn the_schema_requires_all_three_arguments() {
        let required = Edit.input_schema()["required"].as_array().unwrap().len();
        assert_eq!(required, 3);
        assert_eq!(Edit.name(), "edit");
    }
}
