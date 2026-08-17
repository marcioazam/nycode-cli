//! Ferramenta `grep`: busca um padrão no conteúdo dos arquivos.
//!
//! O agente já tem `bash` e poderia chamar `grep` por lá. Esta existe para a
//! sessão restringida: sem ela, negar `bash` deixa o agente cego, e a escolha
//! passa a ser entre dar shell ou não ter agente.

use std::fmt::Write as _;

use async_trait::async_trait;
use grep_regex::RegexMatcherBuilder;
use grep_searcher::{BinaryDetection, SearcherBuilder};
use serde_json::{Value, json};

use super::collect::{Collect, MAX_MATCHES};
use super::engine;
use crate::tool::{Tool, ToolContext, ToolOutput};

/// Teto de linhas de contexto por lado.
///
/// Pedir vinte linhas em volta de duzentos casamentos é pedir o arquivo inteiro
/// de volta pela porta dos fundos.
const MAX_CONTEXT: usize = 5;

#[derive(Debug, Default, Clone, Copy)]
pub struct Grep;

#[async_trait]
#[allow(clippy::unnecessary_literal_bound)]
impl Tool for Grep {
    fn name(&self) -> &str {
        "grep"
    }

    fn description(&self) -> &str {
        "Busca uma expressao regular no conteudo dos arquivos do workspace e \
         devolve as linhas que casam, com caminho e numero de linha. Respeita o \
         `.gitignore` do projeto. Aceita um filtro de nome de arquivo em `glob`. \
         Nao modifica nada."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "pattern": {
                    "type": "string",
                    "description": "Expressao regular a procurar no conteudo dos arquivos"
                },
                "path": {
                    "type": "string",
                    "description": "Subdiretorio onde buscar, relativo a raiz. Padrao: a raiz"
                },
                "glob": {
                    "type": "string",
                    "description": "Filtro de caminho, com `*`, `?` e `**`. Exemplo: `*.rs` ou `src/**/*.rs`"
                },
                "case_sensitive": {
                    "type": "boolean",
                    "description": "Diferenciar maiusculas de minusculas. Padrao: false"
                },
                "literal": {
                    "type": "boolean",
                    "description": "Tratar `pattern` como texto exato, sem metacaracteres. \
                                    Use para procurar algo como `foo(bar)` sem escapar. Padrao: false"
                },
                "context": {
                    "type": "integer",
                    "description": "Quantas linhas mostrar antes e depois de cada casamento, \
                                    ate 5. Padrao: 0"
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximo de linhas devolvidas. Padrao: 200"
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
        let glob = match input
            .get("glob")
            .and_then(Value::as_str)
            .map(engine::glob)
            .transpose()
        {
            Ok(glob) => glob,
            Err(message) => return ToolOutput::error(message),
        };
        let case_sensitive = input
            .get("case_sensitive")
            .and_then(Value::as_bool)
            .unwrap_or(false);

        let literal = input
            .get("literal")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        // Recortado no teto em vez de recusado: o modelo pediu contexto, e
        // devolver erro por ter pedido demais custa uma rodada para conseguir o
        // que cinco linhas já dariam.
        let context = usize::try_from(input.get("context").and_then(Value::as_u64).unwrap_or(0))
            .unwrap_or(MAX_CONTEXT)
            .min(MAX_CONTEXT);
        let cap = match super::cap::of(&input, MAX_MATCHES) {
            Ok(cap) => cap,
            Err(err) => return err,
        };

        let matcher = match RegexMatcherBuilder::new()
            .case_insensitive(!case_sensitive)
            .fixed_strings(literal)
            .line_terminator(Some(b'\n'))
            .build(pattern)
        {
            Ok(matcher) => matcher,
            // O modelo escreve o padrão; um erro que não diz o que está errado
            // faz ele tentar o mesmo de novo.
            Err(err) => {
                return ToolOutput::error(format!(
                    "expressao regular invalida `{pattern}`: {err}; \
                     para procurar o texto exato, passe `literal: true`"
                ));
            }
        };

        let mut searcher = SearcherBuilder::new()
            .line_number(true)
            .before_context(context)
            .after_context(context)
            // Um binário lido como texto vira lixo no contexto; parar no
            // primeiro byte nulo é melhor que despejar bytes que não
            // significam nada para o modelo.
            .binary_detection(BinaryDetection::quit(0))
            .build();

        let mut out = String::new();
        let mut hits = 0;
        let mut lines = 0;
        let mut truncated = false;

        for found in engine::files(&root) {
            if let Some(glob) = &glob
                && !glob.is_match(&found.relative)
                && !glob.is_match(name_of(&found.relative))
            {
                continue;
            }

            let sink = Collect {
                out: &mut out,
                relative: &found.relative,
                hits: &mut hits,
                lines: &mut lines,
                cap,
            };
            // Uma falha de leitura é um arquivo que sumiu ou que não é legível;
            // parar a busca por isso perderia tudo que já foi encontrado.
            let _ = searcher.search_path(&matcher, &found.path, sink);

            if lines >= cap {
                truncated = true;
                break;
            }
        }

        if hits == 0 {
            // Uma resposta vazia faria o modelo suspeitar da ferramenta em vez
            // de concluir que o termo não existe.
            return ToolOutput::ok(format!("nenhuma linha casa com `{pattern}`"));
        }
        if truncated {
            // Diz o próximo passo em vez de só constatar o corte: sem isso o
            // modelo repete a mesma busca esperando resposta diferente.
            let _ = write!(
                out,
                "\n[{cap} linhas, o teto; restrinja com `path` ou `glob`, \
                 reduza `context`, ou torne o padrao mais especifico]"
            );
        }
        ToolOutput::ok(out)
    }
}

/// O nome do arquivo dentro de um caminho relativo.
fn name_of(relative: &str) -> &str {
    relative.rsplit('/').next().unwrap_or(relative)
}

/// Resolve o subdiretório da busca, ou a raiz.
fn resolve_scope(input: &Value, ctx: &ToolContext) -> Result<std::path::PathBuf, String> {
    let Some(requested) = input.get("path").and_then(Value::as_str) else {
        return Ok(ctx.root().to_path_buf());
    };
    ctx.resolve(requested).map_err(|err| err.to_string())
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
    async fn context_lines_come_back_so_the_match_does_not_need_a_second_read() {
        // Sem contexto, toda busca util vira busca seguida de `read` — duas
        // rodadas para responder o que uma resolve.
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("a.rs"),
            "primeira\nsegunda\nalvo\nquarta\nquinta\n",
        )
        .unwrap();
        let ctx = ToolContext::new(dir.path()).unwrap();

        let out = Grep
            .execute(json!({ "pattern": "alvo", "context": 1 }), &ctx)
            .await;

        assert!(out.content.contains("segunda"), "{}", out.content);
        assert!(out.content.contains("quarta"), "{}", out.content);
        assert!(
            !out.content.contains("primeira"),
            "contexto de 1 nao pode trazer a linha 1: {}",
            out.content
        );
    }

    #[tokio::test]
    async fn a_context_line_is_marked_differently_from_the_line_that_matched() {
        // Onze linhas sem distincao deixam o modelo sem saber qual delas e a
        // que ele procurou.
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.rs"), "antes\nalvo\ndepois\n").unwrap();
        let ctx = ToolContext::new(dir.path()).unwrap();

        let out = Grep
            .execute(json!({ "pattern": "alvo", "context": 1 }), &ctx)
            .await;

        assert!(out.content.contains("a.rs:2: alvo"), "{}", out.content);
        assert!(out.content.contains("a.rs-1- antes"), "{}", out.content);
    }

    #[tokio::test]
    async fn a_literal_search_finds_text_that_would_be_metacharacters_in_a_regex() {
        // `foo(bar)` como regex e um grupo de captura e nao casa com o texto.
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.rs"), "chamada de foo(bar) aqui\n").unwrap();
        let ctx = ToolContext::new(dir.path()).unwrap();

        let como_regex = Grep.execute(json!({ "pattern": "foo(bar)" }), &ctx).await;
        assert!(
            como_regex.content.contains("nenhuma linha"),
            "como regex nao deveria casar: {}",
            como_regex.content
        );

        let literal = Grep
            .execute(json!({ "pattern": "foo(bar)", "literal": true }), &ctx)
            .await;
        assert!(literal.content.contains("foo(bar)"), "{}", literal.content);
    }

    #[tokio::test]
    async fn an_invalid_pattern_says_how_to_search_for_it_as_text() {
        // So recusar faz o modelo tentar escapar por conta e gastar outra rodada.
        let dir = tempfile::tempdir().unwrap();
        let ctx = ToolContext::new(dir.path()).unwrap();

        let out = Grep.execute(json!({ "pattern": "a(" }), &ctx).await;

        assert!(out.is_error);
        assert!(out.content.contains("literal"), "{}", out.content);
    }

    #[tokio::test]
    async fn context_cannot_push_the_answer_past_the_line_ceiling() {
        // O teto conta linhas e nao casamentos: sobre casamentos, um contexto de
        // cinco multiplicaria a resposta por onze sem nada perceber.
        let dir = tempfile::tempdir().unwrap();
        let many = "alvo\n".repeat(MAX_MATCHES + 50);
        std::fs::write(dir.path().join("muitos.txt"), many).unwrap();
        let ctx = ToolContext::new(dir.path()).unwrap();

        let out = Grep
            .execute(json!({ "pattern": "alvo", "context": 5 }), &ctx)
            .await;

        assert_eq!(
            out.content.lines().filter(|l| l.contains("muitos")).count(),
            MAX_MATCHES
        );
    }

    #[tokio::test]
    async fn a_context_beyond_the_ceiling_is_clipped_instead_of_refused() {
        // Recusar custa uma rodada para conseguir o que cinco linhas ja davam.
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.rs"), "alvo\n").unwrap();
        let ctx = ToolContext::new(dir.path()).unwrap();

        let out = Grep
            .execute(json!({ "pattern": "alvo", "context": 9000 }), &ctx)
            .await;

        assert!(!out.is_error, "{}", out.content);
        assert!(out.content.contains("alvo"), "{}", out.content);
    }

    #[tokio::test]
    async fn too_many_matches_are_truncated_and_say_so() {
        let dir = tempfile::tempdir().unwrap();
        let many = "alvo\n".repeat(MAX_MATCHES + 50);
        std::fs::write(dir.path().join("muitos.txt"), many).unwrap();
        let ctx = ToolContext::new(dir.path()).unwrap();

        let out = Grep.execute(json!({ "pattern": "alvo" }), &ctx).await;
        // O aviso diz o proximo passo: so constatar o corte faz o modelo
        // repetir a mesma busca esperando resposta diferente.
        assert!(out.content.contains("restrinja"), "{}", out.content);
        assert_eq!(
            out.content.lines().filter(|l| l.contains("muitos")).count(),
            MAX_MATCHES
        );
    }

    #[tokio::test]
    async fn a_per_call_limit_caps_below_the_default() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("m.txt"), "alvo\nalvo\nalvo\n").unwrap();
        let ctx = ToolContext::new(dir.path()).unwrap();
        let out = Grep
            .execute(json!({ "pattern": "alvo", "limit": 1 }), &ctx)
            .await;
        let hits = out.content.lines().filter(|l| l.contains("m.txt")).count();
        assert_eq!(hits, 1, "{}", out.content);
    }
}
