//! Ferramenta `ls`: lista o conteúdo de um diretório.

use std::fmt::Write as _;

use async_trait::async_trait;
use serde_json::{Value, json};

use crate::tool::{Tool, ToolContext, ToolOutput};

/// Teto de entradas listadas.
const MAX_ENTRIES: usize = 500;

#[derive(Debug, Default, Clone, Copy)]
pub struct Ls;

#[async_trait]
#[allow(clippy::unnecessary_literal_bound)]
impl Tool for Ls {
    fn name(&self) -> &str {
        "ls"
    }

    fn description(&self) -> &str {
        "Lista o conteudo de um diretorio do workspace, marcando diretorios com \
         `/` e mostrando o tamanho dos arquivos. Nao e recursivo e nao modifica \
         nada."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Diretorio a listar, relativo a raiz. Padrao: a raiz"
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximo de entradas devolvidas. Padrao: 500"
                }
            }
        })
    }

    async fn execute(&self, input: Value, ctx: &ToolContext) -> ToolOutput {
        let cap = match super::cap::of(&input, MAX_ENTRIES) {
            Ok(cap) => cap,
            Err(err) => return err,
        };
        let requested = input.get("path").and_then(Value::as_str).unwrap_or(".");
        let dir = match ctx.resolve(requested) {
            Ok(path) => path,
            Err(err) => return ToolOutput::error(err.to_string()),
        };

        if !dir.is_dir() {
            return ToolOutput::error(format!("`{requested}` nao e um diretorio"));
        }

        let Some((listed, total)) = listing(&dir, cap) else {
            return ToolOutput::error(format!("nao foi possivel listar `{requested}`"));
        };

        if total == 0 {
            return ToolOutput::ok(format!("`{requested}` esta vazio"));
        }

        let mut out = String::new();
        for line in &listed {
            let _ = writeln!(out, "{line}");
        }
        if total > cap {
            let _ = write!(out, "\n[truncado em {cap} de {total} entradas]");
        }
        ToolOutput::ok(out)
    }
}

/// As linhas de uma listagem, em ordem estável, e quantas entradas existem.
///
/// Guarda no máximo `cap` linhas: montar a listagem inteira para depois
/// descartar o excedente já custou a memória, e um diretório com milhões de
/// entradas é justamente onde isso pesa. Como o que se emite são as `cap`
/// primeiras em ordem, guardar as `cap` menores dá o mesmo resultado.
///
/// O teto é parâmetro para que o teste que prova o limite use dez entradas em
/// vez de quinhentas.
fn listing(dir: &std::path::Path, cap: usize) -> Option<(Vec<String>, usize)> {
    if !dir.is_dir() {
        return None;
    }

    let mut kept = std::collections::BinaryHeap::new();
    let mut total = 0;

    // A mesma política da varredura, com profundidade de um: o que o
    // `.gitignore` declara derivado não é listado, porque listá-lo convidaria o
    // modelo a entrar nele.
    for entry in super::engine::walker(dir)
        .max_depth(Some(1))
        .build()
        .flatten()
    {
        // A raiz da listagem também é uma entrada da varredura.
        if entry.depth() == 0 {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();

        let Some(kind) = entry.file_type() else {
            continue;
        };

        total += 1;
        kept.push(if kind.is_dir() {
            format!("{name}/")
        } else if kind.is_symlink() {
            format!("{name}@")
        } else {
            let size = entry.metadata().map_or(0, |m| m.len());
            format!("{name}\t{size}")
        });
        if kept.len() > cap {
            kept.pop();
        }
    }

    // Ordem estável: uma listagem que muda de ordem entre execuções invalida o
    // cache de prompt do backend sem nenhum ganho.
    Some((kept.into_sorted_vec(), total))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn workspace() -> (tempfile::TempDir, ToolContext) {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::create_dir_all(root.join("target")).unwrap();
        // O que todo repositorio Rust real declara, e que passou a ser quem
        // decide o que a listagem esconde.
        std::fs::write(root.join(".gitignore"), "target/\n").unwrap();
        std::fs::write(root.join("README.md"), "cinco").unwrap();
        std::fs::write(root.join("src/main.rs"), "").unwrap();
        let ctx = ToolContext::new(root).unwrap();
        (dir, ctx)
    }

    async fn ls(input: Value) -> ToolOutput {
        let (_dir, ctx) = workspace();
        Ls.execute(input, &ctx).await
    }

    #[tokio::test]
    async fn lists_the_root_by_default_marking_directories() {
        let out = ls(json!({})).await;
        assert!(!out.is_error);
        assert!(out.content.contains("src/"), "{}", out.content);
        assert!(out.content.contains("README.md\t5"), "{}", out.content);
    }

    #[tokio::test]
    async fn what_the_repository_declared_as_derived_is_not_offered_to_the_model() {
        // Lista-lo convidaria o modelo a entrar num diretorio que a varredura
        // pula. Quem decide o que e derivado e o `.gitignore` do projeto, e nao
        // uma lista fixa que nao conhece o diretorio de saida deste projeto.
        let out = ls(json!({})).await;
        assert!(!out.content.contains("target"), "{}", out.content);
        assert!(out.content.contains("src/"), "{}", out.content);
    }

    #[tokio::test]
    async fn a_subdirectory_can_be_listed() {
        let out = ls(json!({ "path": "src" })).await;
        assert!(out.content.contains("main.rs"), "{}", out.content);
        assert!(!out.content.contains("README"), "{}", out.content);
    }

    #[tokio::test]
    async fn listing_a_file_says_it_is_not_a_directory() {
        // Devolver o conteudo seria fazer o trabalho de `read` e confundir o
        // modelo sobre qual ferramenta usar.
        let out = ls(json!({ "path": "README.md" })).await;
        assert!(out.is_error);
        assert!(
            out.content.contains("nao e um diretorio"),
            "{}",
            out.content
        );
    }

    #[tokio::test]
    async fn a_path_outside_the_workspace_is_refused() {
        let out = ls(json!({ "path": "../fora" })).await;
        assert!(out.is_error);
    }

    #[tokio::test]
    async fn a_directory_that_does_not_exist_is_an_error_not_an_empty_listing() {
        let out = ls(json!({ "path": "nao-existe" })).await;
        assert!(out.is_error);
    }

    #[tokio::test]
    async fn an_empty_directory_says_it_is_empty() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("vazio")).unwrap();
        let ctx = ToolContext::new(dir.path()).unwrap();

        let out = Ls.execute(json!({ "path": "vazio" }), &ctx).await;
        assert!(!out.is_error);
        assert!(out.content.contains("vazio"), "{}", out.content);
    }

    #[tokio::test]
    async fn the_listing_is_in_a_stable_order() {
        let first = ls(json!({})).await;
        let second = ls(json!({})).await;
        assert_eq!(first.content, second.content);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_symlink_is_marked_rather_than_followed() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("alvo.txt"), "x").unwrap();
        std::os::unix::fs::symlink("alvo.txt", dir.path().join("atalho")).unwrap();
        let ctx = ToolContext::new(dir.path()).unwrap();

        let out = Ls.execute(json!({}), &ctx).await;
        assert!(out.content.contains("atalho@"), "{}", out.content);
    }

    #[test]
    fn the_listing_never_holds_more_lines_than_the_ceiling() {
        // Truncar na saida nao ajuda se a listagem inteira ja foi montada na
        // memoria: o pico e o que conta contra o orcamento de RSS.
        let dir = tempfile::tempdir().unwrap();
        for i in 0..10 {
            std::fs::write(dir.path().join(format!("a{i}.txt")), "").unwrap();
        }

        let (listed, total) = listing(dir.path(), 3).unwrap();
        assert!(listed.len() <= 3, "{} linhas guardadas", listed.len());
        assert_eq!(total, 10, "a contagem precisa ver todas");
    }

    #[tokio::test]
    async fn a_huge_directory_is_truncated_and_says_so() {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..(MAX_ENTRIES + 20) {
            std::fs::write(dir.path().join(format!("a{i:04}.txt")), "").unwrap();
        }
        let ctx = ToolContext::new(dir.path()).unwrap();

        let out = Ls.execute(json!({}), &ctx).await;
        assert!(out.content.contains("truncado"), "{}", out.content);
    }
    #[tokio::test]
    async fn a_per_call_limit_caps_below_the_default() {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..5 {
            std::fs::write(dir.path().join(format!("a{i}.txt")), "").unwrap();
        }
        let ctx = ToolContext::new(dir.path()).unwrap();
        let out = Ls.execute(json!({ "limit": 2 }), &ctx).await;
        let hits = out.content.lines().filter(|l| l.contains(".txt")).count();
        assert_eq!(hits, 2, "{}", out.content);
        let exact = Ls.execute(json!({ "limit": 5 }), &ctx).await;
        assert!(!exact.content.contains("truncado"), "{}", exact.content);
    }
}
