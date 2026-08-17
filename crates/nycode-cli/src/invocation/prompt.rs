//! A base do prompt de sistema: embutida, arquivo ou flag.
//!
//! Instruções e skills continuam anexadas depois, em [`nycode_agent::Context`].
//! Substituir a base não as apaga — é o mesmo contrato da referência.

use std::path::Path;

use anyhow::Context as _;

use super::cli::Cli;

/// Prompt de sistema mínimo.
///
/// Modelos de fronteira já são treinados para o formato de agente de
/// codificação; prompt longo aqui gasta contexto sem ganho proporcional.
pub const BUILTIN: &str = "Voce e o NyCode CLI, um agente de codificacao que opera \
     no terminal dentro do repositorio do usuario. Use as ferramentas disponiveis para \
     inspecionar arquivos antes de afirmar qualquer coisa sobre o codigo. Seja direto.";

const MAX_BYTES: usize = 64 * 1024;

/// Resolve a base a partir das flags e dos arquivos desta máquina.
pub fn resolve(cli: &Cli, root: &Path) -> anyhow::Result<String> {
    from_sources(
        cli,
        root,
        nycode_agent::policy::config_dir(
            std::env::var_os("XDG_CONFIG_HOME")
                .as_deref()
                .map(Path::new),
            std::env::var_os("HOME").as_deref().map(Path::new),
        )
        .as_deref(),
    )
}

/// `user` é a pasta de config; sem ela, só o projeto e as flags entram.
pub fn from_sources(cli: &Cli, root: &Path, user: Option<&Path>) -> anyhow::Result<String> {
    let base = if let Some(text) = cli.system.as_deref() {
        text.to_owned()
    } else if let Some(text) = load(root, ".nycode/SYSTEM.md")? {
        text
    } else if let Some(dir) = user {
        load(dir, "SYSTEM.md")?.unwrap_or_else(|| BUILTIN.to_owned())
    } else {
        BUILTIN.to_owned()
    };

    let extra = if let Some(text) = cli.append_system.as_deref() {
        Some(text.to_owned())
    } else if let Some(text) = load(root, ".nycode/APPEND_SYSTEM.md")? {
        Some(text)
    } else if let Some(dir) = user {
        load(dir, "APPEND_SYSTEM.md")?
    } else {
        None
    };

    Ok(match extra {
        Some(extra) if !extra.is_empty() => format!("{base}\n\n{extra}"),
        _ => base,
    })
}

fn load(layer: &Path, relative: &str) -> anyhow::Result<Option<String>> {
    let path = layer.join(relative);
    if !path.exists() {
        return Ok(None);
    }
    anyhow::ensure!(
        nycode_agent::tool::stays_within(layer, &path),
        "arquivo de prompt aponta para fora: {}",
        path.display()
    );
    let read = nycode_agent::capped::read_blocking(&path, MAX_BYTES)
        .with_context(|| format!("nao foi possivel ler {}", path.display()))?;
    let mut text = read.text().to_owned();
    if read.truncated() {
        text.push_str("\n\n[truncado]\n");
    }
    Ok(Some(text))
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use clap::Parser as _;

    fn cli_with(system: Option<&str>, append: Option<&str>) -> Cli {
        Cli {
            system: system.map(str::to_owned),
            append_system: append.map(str::to_owned),
            ..Cli::parse_from(["nycode"])
        }
    }

    fn write(dir: &Path, relative: &str, body: &str) {
        let path = dir.join(relative);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, body).unwrap();
    }

    #[test]
    fn the_default_is_the_builtin_prompt() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            from_sources(&cli_with(None, None), dir.path(), None).unwrap(),
            BUILTIN
        );
    }

    #[test]
    fn a_project_file_replaces_the_builtin() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), ".nycode/SYSTEM.md", "so o projeto");
        write(dir.path(), "AGENTS.md", "nao e a base");
        assert_eq!(
            from_sources(&cli_with(None, None), dir.path(), None).unwrap(),
            "so o projeto"
        );
    }

    #[test]
    fn a_user_file_replaces_the_builtin_when_the_project_has_none() {
        let dir = tempfile::tempdir().unwrap();
        let user = tempfile::tempdir().unwrap();
        write(user.path(), "SYSTEM.md", "do usuario");
        write(user.path(), "APPEND_SYSTEM.md", "mais");
        assert_eq!(
            from_sources(&cli_with(None, None), dir.path(), Some(user.path())).unwrap(),
            "do usuario\n\nmais"
        );
    }

    #[test]
    fn the_project_file_wins_over_the_user_file() {
        let dir = tempfile::tempdir().unwrap();
        let user = tempfile::tempdir().unwrap();
        write(dir.path(), ".nycode/SYSTEM.md", "projeto");
        write(dir.path(), ".nycode/APPEND_SYSTEM.md", "p-extra");
        write(user.path(), "SYSTEM.md", "usuario");
        write(user.path(), "APPEND_SYSTEM.md", "u-extra");
        assert_eq!(
            from_sources(&cli_with(None, None), dir.path(), Some(user.path())).unwrap(),
            "projeto\n\np-extra"
        );
    }

    #[test]
    fn the_system_flag_replaces_files() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), ".nycode/SYSTEM.md", "arquivo");
        assert_eq!(
            from_sources(&cli_with(Some("pela flag"), None), dir.path(), None).unwrap(),
            "pela flag"
        );
    }

    #[test]
    fn an_append_file_follows_the_base() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), ".nycode/SYSTEM.md", "base");
        write(dir.path(), ".nycode/APPEND_SYSTEM.md", "extra");
        assert_eq!(
            from_sources(&cli_with(None, None), dir.path(), None).unwrap(),
            "base\n\nextra"
        );
    }

    #[test]
    fn the_append_flag_replaces_the_append_file() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), ".nycode/APPEND_SYSTEM.md", "arquivo");
        assert_eq!(
            from_sources(&cli_with(None, Some("pela flag")), dir.path(), None).unwrap(),
            format!("{BUILTIN}\n\npela flag")
        );
    }

    #[test]
    fn replace_and_append_flags_compose() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            from_sources(&cli_with(Some("base"), Some("extra")), dir.path(), None).unwrap(),
            "base\n\nextra"
        );
    }

    #[test]
    fn a_directory_named_like_the_file_is_an_error() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(".nycode/SYSTEM.md")).unwrap();
        let err = from_sources(&cli_with(None, None), dir.path(), None).unwrap_err();
        assert!(err.to_string().contains("SYSTEM.md"), "{err}");
    }

    #[test]
    fn an_empty_append_does_not_add_a_blank_section() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            from_sources(&cli_with(Some("base"), Some("")), dir.path(), None).unwrap(),
            "base"
        );
    }

    #[test]
    fn a_file_under_the_byte_ceiling_is_not_marked_truncated() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), ".nycode/SYSTEM.md", &"x".repeat(2000));
        let prompt = from_sources(&cli_with(None, None), dir.path(), None).unwrap();
        assert_eq!(prompt.len(), 2000);
        assert!(!prompt.contains("[truncado]"));
    }
}
