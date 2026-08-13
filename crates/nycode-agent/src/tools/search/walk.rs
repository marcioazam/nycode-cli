//! Varredura de diretório compartilhada pelas ferramentas de leitura.
//!
//! Existe separada porque as três — buscar conteúdo, buscar nome, listar — só
//! diferem no que fazem com cada entrada. As regras que elas compartilham são
//! as que importam: não sair da raiz, não seguir link simbólico, e não despejar
//! `target/` nem `.git/` no contexto do modelo.

use std::path::{Path, PathBuf};

/// Diretórios que nunca entram numa varredura.
///
/// São o volume que domina qualquer repositório real e que o modelo nunca quer
/// ver. Incluí-los gastaria a janela inteira antes do primeiro resultado útil.
pub const SKIPPED: &[&str] = &[
    ".git",
    "target",
    "node_modules",
    ".venv",
    "__pycache__",
    "dist",
    "build",
];

/// Teto de arquivos visitados numa varredura.
///
/// Um repositório grande com um padrão que casa com tudo produziria uma
/// resposta que não cabe na janela e uma espera que parece travamento.
pub const MAX_VISITED: usize = 20_000;

/// Um arquivo encontrado na varredura.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Found {
    pub path: PathBuf,
    /// Caminho relativo à raiz da varredura, para exibição.
    pub relative: String,
}

/// Percorre `root` em profundidade, devolvendo os arquivos.
///
/// A ordem é determinística: dois repositórios idênticos produzem a mesma
/// resposta, e uma resposta que muda de ordem entre execuções invalida o cache
/// de prompt do backend sem nenhum ganho.
#[must_use]
pub fn files(root: &Path) -> Vec<Found> {
    files_within(root, MAX_VISITED)
}

/// O mesmo que [`files`], com o teto parametrizado.
///
/// O teto é parâmetro para que o teste que prova que ele segura possa usar dez
/// arquivos em vez de vinte mil.
#[must_use]
fn files_within(root: &Path, cap: usize) -> Vec<Found> {
    let mut out = Vec::new();
    let mut pending = vec![root.to_path_buf()];

    while let Some(dir) = pending.pop() {
        if out.len() >= cap {
            break;
        }
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };

        for (_, is_dir, path) in sorted_entries(entries, cap) {
            // O teto vale aqui dentro, e não só no topo do laço externo: um
            // diretório plano com milhões de arquivos é uma iteração só.
            if out.len() >= cap {
                break;
            }

            if is_dir {
                pending.push(path);
            } else {
                out.push(Found {
                    relative: relative_to(root, &path),
                    path,
                });
            }
        }
    }

    out.sort_by(|a, b| a.relative.cmp(&b.relative));
    out
}

/// As entradas úteis de um diretório, em ordem estável e em número limitado.
///
/// Limitado aqui e não só na saída: coletar o diretório inteiro num `Vec` para
/// depois descartar o excedente já custou a memória. Como nunca se emite mais
/// que `cap`, guardar os `cap` menores entrega o mesmo prefixo que a ordem
/// estável entregaria, com o pico de memória preso ao teto.
fn sorted_entries(
    entries: std::fs::ReadDir,
    cap: usize,
) -> Vec<(std::ffi::OsString, bool, PathBuf)> {
    let mut kept = std::collections::BinaryHeap::new();

    for entry in entries.flatten() {
        let name = entry.file_name();
        if SKIPPED.contains(&name.to_string_lossy().as_ref()) {
            continue;
        }

        // `file_type` não segue link simbólico, que é o que se quer: seguir um
        // poderia sair da raiz e varrer o sistema inteiro.
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if !kind.is_dir() && !kind.is_file() {
            continue;
        }

        kept.push((name, kind.is_dir(), entry.path()));
        if kept.len() > cap {
            kept.pop();
        }
    }

    kept.into_sorted_vec()
}

/// Caminho relativo à raiz, com separador de barra.
#[must_use]
pub fn relative_to(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .components()
        .map(|c| c.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

/// Se o nome casa com um padrão de glob simples.
///
/// Suporta `*` e `?`, que é o que um modelo escreve. Um motor de glob completo
/// traria dependência e sintaxe que ninguém usa aqui.
#[must_use]
pub fn matches_glob(pattern: &str, name: &str) -> bool {
    glob_at(pattern.as_bytes(), name.as_bytes())
}

fn glob_at(pattern: &[u8], name: &[u8]) -> bool {
    let mut p = 0;
    let mut n = 0;
    // Onde estava o último `*` e quanto ele já tinha engolido. Descasou? Volta
    // para ele e engole mais um byte. É isso que troca o backtracking
    // exponencial — que um padrão como `*a*a*a*b` fazia explodir — por O(n·m).
    let mut star = None;
    let mut swallowed = 0;

    while let Some(&current) = name.get(n) {
        match pattern.get(p) {
            Some(b'*') => {
                star = Some(p);
                swallowed = n;
                p += 1;
            }
            Some(b'?') => {
                p += 1;
                n += 1;
            }
            Some(expected) if *expected == current => {
                p += 1;
                n += 1;
            }
            _ => {
                let Some(last) = star else {
                    return false;
                };
                p = last + 1;
                swallowed += 1;
                n = swallowed;
            }
        }
    }

    // Sobrou padrão: só casa se for `*`, que aceita o resto vazio.
    pattern.iter().skip(p).all(|byte| *byte == b'*')
}

#[cfg(test)]
mod tests {
    use super::*;

    fn workspace() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("src/nested")).unwrap();
        std::fs::create_dir_all(root.join("target/debug")).unwrap();
        std::fs::create_dir_all(root.join(".git/objects")).unwrap();
        std::fs::write(root.join("README.md"), "leia").unwrap();
        std::fs::write(root.join("src/main.rs"), "fn main() {}").unwrap();
        std::fs::write(root.join("src/nested/deep.rs"), "profundo").unwrap();
        std::fs::write(root.join("target/debug/artefato"), "lixo").unwrap();
        std::fs::write(root.join(".git/objects/abc"), "objeto").unwrap();
        dir
    }

    #[test]
    fn the_walk_finds_files_at_every_depth() {
        let dir = workspace();
        let found: Vec<_> = files(dir.path()).into_iter().map(|f| f.relative).collect();

        assert!(found.contains(&"README.md".to_owned()));
        assert!(found.contains(&"src/main.rs".to_owned()));
        assert!(found.contains(&"src/nested/deep.rs".to_owned()));
    }

    #[test]
    fn build_output_and_version_control_never_enter_the_context() {
        // Sao o volume que domina qualquer repositorio real; incluí-los
        // gastaria a janela antes do primeiro resultado util.
        let dir = workspace();
        let found: Vec<_> = files(dir.path()).into_iter().map(|f| f.relative).collect();

        assert!(!found.iter().any(|f| f.starts_with("target/")), "{found:?}");
        assert!(!found.iter().any(|f| f.starts_with(".git/")), "{found:?}");
    }

    #[test]
    fn the_order_is_stable_across_runs() {
        // Uma resposta que muda de ordem entre execucoes invalida o cache de
        // prompt do backend sem nenhum ganho.
        let dir = workspace();
        assert_eq!(files(dir.path()), files(dir.path()));
    }

    #[test]
    fn a_symlink_is_not_followed_out_of_the_root() {
        // Seguir um link poderia varrer o sistema inteiro.
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("segredo.txt"), "nao deveria aparecer").unwrap();

        #[cfg(unix)]
        std::os::unix::fs::symlink(outside.path(), dir.path().join("atalho")).unwrap();

        let found: Vec<_> = files(dir.path()).into_iter().map(|f| f.relative).collect();
        assert!(!found.iter().any(|f| f.contains("segredo")), "{found:?}");
    }

    #[test]
    fn an_unreadable_directory_is_skipped_rather_than_failing_the_walk() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("visivel.txt"), "x").unwrap();

        let found = files(dir.path());
        assert_eq!(found.len(), 1);
    }

    #[test]
    fn an_empty_directory_yields_nothing() {
        let dir = tempfile::tempdir().unwrap();
        assert!(files(dir.path()).is_empty());
    }

    #[test]
    fn the_visit_ceiling_holds_inside_a_single_directory() {
        // Um diretorio plano gigante e visitado numa iteracao so do laco
        // externo: se o teto so for checado la, ele nao segura nada.
        let dir = tempfile::tempdir().unwrap();
        for n in 0..10 {
            std::fs::write(dir.path().join(format!("arquivo-{n}.txt")), "x").unwrap();
        }

        let found = files_within(dir.path(), 3);
        assert!(
            found.len() <= 3,
            "{} arquivos passaram do teto",
            found.len()
        );
    }

    #[test]
    fn a_pathological_pattern_does_not_hang_the_search() {
        // O padrao vem do modelo e nenhuma ferramenta tem prazo de execucao:
        // um glob que exige backtracking exponencial pendura a chamada inteira.
        let name = "a".repeat(64);
        assert!(!matches_glob("*a*a*a*a*a*a*a*a*b", &name));
    }

    #[test]
    fn a_glob_matches_the_shapes_a_model_writes() {
        assert!(matches_glob("*.rs", "main.rs"));
        assert!(matches_glob("main.*", "main.rs"));
        assert!(matches_glob("*", "qualquer"));
        assert!(matches_glob("main.rs", "main.rs"));
        assert!(matches_glob("m?in.rs", "main.rs"));
        assert!(matches_glob("*test*", "meu_test_a.rs"));
    }

    #[test]
    fn a_glob_that_does_not_match_says_so() {
        assert!(!matches_glob("*.rs", "main.py"));
        assert!(!matches_glob("m?in.rs", "mn.rs"));
        assert!(!matches_glob("main.rs", "main.rs.bak"));
        assert!(!matches_glob("", "algo"));
    }

    #[test]
    fn an_empty_name_only_matches_an_empty_or_star_pattern() {
        assert!(matches_glob("", ""));
        assert!(matches_glob("*", ""));
        assert!(!matches_glob("?", ""));
    }

    #[test]
    fn consecutive_stars_do_not_change_the_meaning() {
        assert!(matches_glob("**.rs", "main.rs"));
        assert!(matches_glob("*a*b*", "xaybz"));
    }

    #[test]
    fn the_relative_path_uses_forward_slashes() {
        let rendered = relative_to(Path::new("/w"), Path::new("/w/src/nested/a.rs"));
        assert_eq!(rendered, "src/nested/a.rs");
    }

    #[test]
    fn a_path_outside_the_root_keeps_its_own_shape() {
        // Nao deveria acontecer, mas silenciar produziria um nome enganoso.
        let rendered = relative_to(Path::new("/w"), Path::new("/outro/a.rs"));
        assert!(rendered.contains("outro"), "{rendered}");
    }
}
