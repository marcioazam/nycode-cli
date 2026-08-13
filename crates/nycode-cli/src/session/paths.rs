//! Como um caminho do workspace aparece na tela.
//!
//! Mora ao lado da montagem porque é ela que resolve a raiz e descobre os
//! arquivos de contexto; isto é só o nome curto com que os dois aparecem no
//! rodapé. Muda quando a convenção de exibição muda, e não quando a montagem
//! ganha um passo.

use std::path::Path;

/// Abrevia o caminho do workspace com `~` quando ele está sob o home.
#[must_use]
pub fn display_path(root: &Path) -> String {
    abbreviate(root, std::env::var_os("HOME").as_deref().map(Path::new))
}

/// O mesmo, com o home explícito.
///
/// O home é parâmetro e não leitura de ambiente porque `set_var` é `unsafe` na
/// edition 2024, e `unsafe_code` é `forbid` no workspace: sem esta costura o
/// comportamento seria intestável.
#[must_use]
pub fn abbreviate(root: &Path, home: Option<&Path>) -> String {
    let rendered = root.display().to_string();
    let Some(home) = home else {
        return rendered;
    };
    // Um home vazio ou na raiz transformaria todo caminho absoluto em `~/...`.
    if home.as_os_str().is_empty() || home == Path::new("/") {
        return rendered;
    }
    root.strip_prefix(home)
        .map_or(rendered, |rest| format!("~/{}", rest.display()))
}

/// Nome de um arquivo de contexto relativo à raiz.
#[must_use]
pub fn display_relative(path: &Path, root: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .display()
        .to_string()
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
mod tests {
    use super::*;

    #[test]
    fn a_path_under_home_is_shown_abbreviated() {
        // Sopa de caminho absoluto no rodape rouba a largura que o resto da
        // informacao precisa.
        let home = Path::new("/home/alguem");
        assert_eq!(
            abbreviate(Path::new("/home/alguem/proj"), Some(home)),
            "~/proj"
        );
        assert_eq!(
            abbreviate(Path::new("/home/alguem/a/b"), Some(home)),
            "~/a/b"
        );
    }

    #[test]
    fn a_path_outside_home_is_shown_whole() {
        let home = Path::new("/home/alguem");
        assert_eq!(abbreviate(Path::new("/etc"), Some(home)), "/etc");
        // Prefixo textual coincidente nao e o mesmo que estar sob o diretorio.
        assert_eq!(
            abbreviate(Path::new("/home/alguem-outro/p"), Some(home)),
            "/home/alguem-outro/p"
        );
    }

    #[test]
    fn without_a_usable_home_the_path_is_left_alone() {
        // Um home vazio ou na raiz transformaria todo caminho absoluto em `~`.
        let path = Path::new("/srv/proj");
        assert_eq!(abbreviate(path, None), "/srv/proj");
        assert_eq!(abbreviate(path, Some(Path::new(""))), "/srv/proj");
        assert_eq!(abbreviate(path, Some(Path::new("/"))), "/srv/proj");
    }

    #[test]
    fn the_home_directory_itself_abbreviates_cleanly() {
        let home = Path::new("/home/alguem");
        assert_eq!(abbreviate(home, Some(home)), "~/");
    }

    #[test]
    fn a_context_file_is_named_relative_to_the_workspace() {
        assert_eq!(
            display_relative(Path::new("/w/.claude/rules/a.md"), Path::new("/w")),
            ".claude/rules/a.md"
        );
        // Fora da raiz, o caminho inteiro e o unico nome honesto.
        assert_eq!(
            display_relative(Path::new("/outro/AGENTS.md"), Path::new("/w")),
            "/outro/AGENTS.md"
        );
    }
}
