//! Ferramenta `edit`: substituição textual exata.

use async_trait::async_trait;
use serde_json::{Value, json};

use crate::tool::{Tool, ToolContext, ToolOutput};

mod replace;

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
        "Substitui ocorrencias exatas de texto num arquivo. Cada trecho \
         procurado precisa ser unico; varias trocas disjuntas vao em \
         `replacements` na mesma chamada."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "Caminho relativo a raiz" },
                "old_string": { "type": "string", "description": "Texto exato a substituir" },
                "new_string": { "type": "string", "description": "Texto que entra no lugar" },
                "replacements": {
                    "type": "array",
                    "description": "Trocas disjuntas no mesmo arquivo, cada uma com old_string e new_string"
                }
            },
            "required": ["path"]
        })
    }

    async fn execute(&self, input: Value, ctx: &ToolContext) -> ToolOutput {
        let Some(requested) = input.get("path").and_then(Value::as_str) else {
            return ToolOutput::error("argumento obrigatorio ausente: `path`");
        };
        let pairs = match pairs_from(&input) {
            Ok(pairs) => pairs,
            Err(output) => return output,
        };

        let path = match ctx.resolve(requested) {
            Ok(path) => path,
            Err(err) => return ToolOutput::error(err.to_string()),
        };

        // Pelo descritor: entre esta leitura e a escrita lá embaixo há a
        // comparação de ocorrências, que é a maior janela de troca de caminho
        // do repositório.
        let Ok(opened) = crate::tool::contain::open_read_async(ctx.root(), &path) else {
            return ToolOutput::error(format!("nao foi possivel ler {requested}"));
        };
        let Ok(read) = crate::capped::read_open(opened, MAX_BYTES).await else {
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
        let Ok(raw) = std::str::from_utf8(&read.bytes) else {
            return ToolOutput::error(format!("nao foi possivel ler {requested}"));
        };

        // O modelo escreve `old_string` com `\n`, sempre. Num arquivo com CRLF
        // isso nunca casa, e a resposta hoje seria "nao encontrado; confira
        // espacos e indentacao" — que manda procurar a diferença errada, porque
        // o que difere é invisível.
        let shape = Shape::of(raw);
        let contents = shape.to_lf(raw);
        let updated = match replace::apply(&contents, &pairs) {
            Ok(updated) => shape.restore(&updated),
            Err(err) => return ToolOutput::error(format!("{err} ({requested})")),
        };
        match crate::tool::contain::write(ctx.root(), &path, updated.as_bytes()).await {
            Ok(()) => ToolOutput::ok(format!(
                "{requested} editado ({} bytes -> {} bytes)",
                raw.len(),
                updated.len()
            )),
            Err(err) => ToolOutput::error(format!("nao foi possivel escrever {requested}: {err}")),
        }
    }
}

fn pairs_from(input: &Value) -> Result<Vec<(String, String)>, ToolOutput> {
    if let Some(list) = input.get("replacements").and_then(Value::as_array) {
        if list.is_empty() {
            return Err(ToolOutput::error("`replacements` vazio; nada a fazer"));
        }
        let mut pairs = Vec::with_capacity(list.len());
        for item in list {
            let old = item.get("old_string").and_then(Value::as_str);
            let new = item.get("new_string").and_then(Value::as_str);
            match (old, new) {
                (Some(old), Some(new)) => pairs.push((old.to_owned(), new.to_owned())),
                _ => {
                    return Err(ToolOutput::error(
                        "cada item de `replacements` precisa de `old_string` e `new_string`",
                    ));
                }
            }
        }
        return Ok(pairs);
    }

    let field = |name: &str| input.get(name).and_then(Value::as_str);
    match (field("old_string"), field("new_string")) {
        (Some(old), Some(new)) => Ok(vec![(old.to_owned(), new.to_owned())]),
        _ => Err(ToolOutput::error(
            "argumentos obrigatorios: `path`, `old_string` e `new_string`",
        )),
    }
}

/// A terminação de linha que a edição precisa devolver intacta.
///
/// Casar exige normalizar, porque o modelo só escreve `\n`. Gravar exige
/// desnormalizar, porque um arquivo que troca de terminação vira um diff de
/// arquivo inteiro no `git` — a edição de uma linha aparece como reescrita de
/// todas, e quem revisa não consegue ver o que mudou.
///
/// O BOM não entra aqui, e a ausência é deliberada: ele fica no começo do
/// conteúdo e atravessa a substituição intacto por conta própria. Tratá-lo
/// explicitamente seria código que não muda nenhum desfecho — os testes que o
/// cobrem passam com e sem. Eles ficam mesmo assim, para que uma implementação
/// futura não o perca sem alguém notar.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Shape {
    crlf: bool,
}

impl Shape {
    /// Lê a terminação do arquivo como ele está no disco.
    ///
    /// Só é `crlf` quando **toda** quebra é CRLF. Num arquivo misto a conversão
    /// de ida e volta reescreveria as linhas que já eram LF, que é justamente o
    /// diff de arquivo inteiro que se quer evitar — ali o byte cru preserva mais.
    fn of(raw: &str) -> Self {
        let quebras = raw.matches('\n').count();
        Self {
            crlf: quebras > 0 && raw.matches("\r\n").count() == quebras,
        }
    }

    /// O conteúdo na forma em que o modelo escreve.
    fn to_lf(self, raw: &str) -> String {
        if self.crlf {
            raw.replace("\r\n", "\n")
        } else {
            raw.to_owned()
        }
    }

    /// O conteúdo de volta na forma do arquivo.
    fn restore(self, updated: &str) -> String {
        if self.crlf {
            updated.replace('\n', "\r\n")
        } else {
            updated.to_owned()
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

    /// Lê o arquivo como bytes, que é onde CRLF e BOM aparecem.
    fn bytes_of(dir: &tempfile::TempDir) -> Vec<u8> {
        std::fs::read(dir.path().join("a.rs")).unwrap()
    }

    #[tokio::test]
    async fn a_multiline_match_works_in_a_file_that_uses_crlf() {
        // O modelo so escreve `\n`. Num arquivo com CRLF o casamento exato falha
        // e a resposta manda "confira espacos e indentacao" — procurar uma
        // diferenca que e invisivel.
        let (_dir, ctx) = workspace_with("fn main() {\r\n    antigo();\r\n}\r\n");

        let out = Edit
            .execute(
                edit("fn main() {\n    antigo();", "fn main() {\n    novo();"),
                &ctx,
            )
            .await;

        assert!(!out.is_error, "{}", out.content);
    }

    #[tokio::test]
    async fn a_crlf_file_is_still_crlf_after_the_edit() {
        // Converter para LF ao gravar transforma a edicao de uma linha num diff
        // de arquivo inteiro, e quem revisa perde de vista o que mudou.
        let (dir, ctx) = workspace_with("um\r\ndois\r\ntres\r\n");

        let out = Edit.execute(edit("dois", "DOIS"), &ctx).await;

        assert!(!out.is_error, "{}", out.content);
        assert_eq!(bytes_of(&dir), b"um\r\nDOIS\r\ntres\r\n");
    }

    #[tokio::test]
    async fn an_lf_file_does_not_gain_carriage_returns() {
        // A restauracao so vale onde havia CRLF; aplicada sempre, ela corromperia
        // todo arquivo Unix do repositorio.
        let (dir, ctx) = workspace_with("um\ndois\ntres\n");

        Edit.execute(edit("dois", "DOIS"), &ctx).await;

        assert_eq!(bytes_of(&dir), b"um\nDOIS\ntres\n");
    }

    #[tokio::test]
    async fn a_file_with_a_bom_keeps_it() {
        // Nenhum codigo trata o BOM: ele atravessa a substituicao por conta
        // propria. O teste fica para que uma implementacao futura nao o perca
        // sem alguem notar — perder o BOM e invisivel em inspecao por texto.
        let (dir, ctx) = workspace_with("\u{feff}antigo\n");

        let out = Edit.execute(edit("antigo", "novo"), &ctx).await;

        assert!(!out.is_error, "{}", out.content);
        assert_eq!(bytes_of(&dir), "\u{feff}novo\n".as_bytes());
    }

    #[tokio::test]
    async fn a_file_without_a_bom_does_not_gain_one() {
        let (dir, ctx) = workspace_with("antigo\n");

        Edit.execute(edit("antigo", "novo"), &ctx).await;

        assert_eq!(bytes_of(&dir), b"novo\n");
    }

    #[tokio::test]
    async fn a_file_with_mixed_endings_is_left_byte_exact() {
        // Normalizar um arquivo misto reescreveria as linhas que ja eram LF, que
        // e justamente o diff de arquivo inteiro que se quer evitar. Ali o byte
        // cru preserva mais.
        let (dir, ctx) = workspace_with("um\r\ndois\ntres\r\n");

        Edit.execute(edit("dois", "DOIS"), &ctx).await;

        assert_eq!(bytes_of(&dir), b"um\r\nDOIS\ntres\r\n");
    }

    #[test]
    fn a_file_of_a_single_line_has_no_endings_to_preserve() {
        // Sem quebra nenhuma nao ha terminacao dominante a deduzir, e supor CRLF
        // acrescentaria um retorno que o arquivo nunca teve.
        assert!(!Shape::of("sem quebra").crlf);
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
        let empty = Edit
            .execute(json!({ "path": "a.rs", "replacements": [] }), &ctx)
            .await;
        assert!(empty.is_error);
    }

    #[test]
    fn the_schema_requires_the_path() {
        let schema = Edit.input_schema();
        let required = schema["required"].as_array().unwrap();
        assert_eq!(required, &["path"]);
        assert_eq!(Edit.name(), "edit");
    }

    #[tokio::test]
    async fn disjoint_replacements_edit_the_file_in_one_call() {
        let (dir, ctx) = workspace_with("um dois tres\n");
        let out = Edit
            .execute(
                json!({
                    "path": "a.rs",
                    "replacements": [
                        {"old_string": "um", "new_string": "UM"},
                        {"old_string": "tres", "new_string": "TRES"}
                    ]
                }),
                &ctx,
            )
            .await;
        assert!(!out.is_error, "{}", out.content);
        assert_eq!(bytes_of(&dir), b"UM dois TRES\n");
    }
}
