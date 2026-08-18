//! Arquivos de instrução do projeto.
//!
//! Lê as convenções que a organização já mantém — `AGENTS.md`, `CLAUDE.md`,
//! `.claude/rules/` — em vez de exigir um formato próprio. O `nylla-gateway` já
//! tem esses arquivos na raiz; o `nycode` deve respeitá-los no primeiro uso, sem
//! configuração.

use std::fmt::Write as _;
use std::path::{Path, PathBuf};

/// Arquivos de instrução procurados em cada camada, em ordem de leitura.
const INSTRUCTION_FILES: &[&str] = &["AGENTS.md", "CLAUDE.md", "NYCODE.md"];

/// Substitui os demais arquivos de instrução *naquele* diretório.
const OVERRIDE: &str = "AGENTS.override.md";

/// Diretórios de regras, cujo conteúdo `.md` é lido por inteiro.
const RULE_DIRS: &[&str] = &[".claude/rules", ".nycode/rules"];

/// Um arquivo de instrução carregado.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Instruction {
    pub path: PathBuf,
    pub contents: String,
    source: Source,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Source {
    User,
    Workspace,
}

/// Teto de bytes por arquivo.
///
/// Um `AGENTS.md` gigante consumiria a janela antes da primeira pergunta.
const MAX_BYTES: usize = 64 * 1024;

/// Carrega as camadas visíveis nesta máquina: config do usuário, ancestrais e raiz.
#[must_use]
pub fn discover(root: &Path) -> Vec<Instruction> {
    from_sources(
        root,
        crate::policy::config_dir(
            std::env::var_os("XDG_CONFIG_HOME")
                .as_deref()
                .map(Path::new),
            std::env::var_os("HOME").as_deref().map(Path::new),
        )
        .as_deref(),
        None,
    )
}

/// `ceiling` limita a subida: sem ele, sobe até a raiz do sistema de arquivos.
#[must_use]
pub(crate) fn from_sources(
    root: &Path,
    user: Option<&Path>,
    ceiling: Option<&Path>,
) -> Vec<Instruction> {
    let mut found = Vec::new();
    if let Some(dir) = user {
        found.extend(layer(dir, Source::User));
    }
    for dir in chain(root, ceiling) {
        found.extend(layer(&dir, Source::Workspace));
    }
    found
}

fn chain(root: &Path, ceiling: Option<&Path>) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let mut current = root.to_path_buf();
    loop {
        if ceiling.is_some_and(|stop| !current.starts_with(stop)) {
            break;
        }
        dirs.push(current.clone());
        let Some(parent) = current.parent() else {
            break;
        };
        if parent == current.as_path() {
            break;
        }
        current = parent.to_path_buf();
    }
    dirs.reverse();
    dirs
}

fn layer(dir: &Path, source: Source) -> Vec<Instruction> {
    let mut found = Vec::new();
    if let Some(over) = read(dir, &dir.join(OVERRIDE), source) {
        found.push(over);
    } else {
        for name in INSTRUCTION_FILES {
            if let Some(instruction) = read(dir, &dir.join(name), source) {
                found.push(instruction);
            }
        }
    }
    for relative in RULE_DIRS {
        let Ok(entries) = std::fs::read_dir(dir.join(relative)) else {
            continue;
        };
        let mut rules: Vec<_> = entries
            .filter_map(std::result::Result::ok)
            .map(|e| e.path())
            .filter(|p| p.extension().is_some_and(|ext| ext == "md"))
            .collect();
        rules.sort();
        found.extend(rules.iter().filter_map(|p| read(dir, p, source)));
    }
    found
}

/// Lê um arquivo de instrução, se ele de fato pertencer à camada.
///
/// A checagem de link é aqui e não no chamador porque todo caminho de leitura
/// passa por esta função, e uma que escapasse dela bastaria para reabrir o
/// vazamento.
fn read(root: &Path, path: &Path, source: Source) -> Option<Instruction> {
    if !crate::tool::stays_within(root, path) {
        tracing::warn!(
            path = %path.display(),
            "arquivo de instrucao aponta para fora da camada, ignorado"
        );
        return None;
    }
    let read = crate::capped::read_blocking(path, MAX_BYTES).ok()?;
    let text = read.text();
    if text.trim().is_empty() {
        return None;
    }
    let contents = if read.truncated() {
        format!("{text}\n\n[truncado]\n")
    } else {
        text.to_owned()
    };
    Some(Instruction {
        path: path.to_path_buf(),
        contents,
        source,
    })
}

/// Concatena as instruções num bloco anexável ao prompt de sistema.
#[must_use]
pub fn render(root: &Path, instructions: &[Instruction], trust_workspace: bool) -> Option<String> {
    let visible: Vec<_> = instructions
        .iter()
        .filter(|instruction| trust_workspace || instruction.source == Source::User)
        .collect();
    if visible.is_empty() {
        return None;
    }
    let mut out = String::from("# Convencoes do projeto\n\n");
    for instruction in visible {
        let label = instruction
            .path
            .strip_prefix(root)
            .unwrap_or(&instruction.path);
        let _ = write!(
            out,
            "## {}\n\n{}\n\n",
            label.display(),
            instruction.contents.trim()
        );
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(root: &Path, relative: &str, contents: &str) {
        let path = root.join(relative);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, contents).unwrap();
    }

    #[test]
    fn reads_the_conventions_the_organization_already_keeps() {
        // O nylla-gateway ja tem AGENTS.md e CLAUDE.md na raiz; o nycode precisa
        // respeita-los sem configuracao.
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "AGENTS.md", "regra de agentes");
        write(dir.path(), "CLAUDE.md", "regra do claude");

        let found = from_sources(dir.path(), None, Some(dir.path()));
        assert_eq!(found.len(), 2);
        assert!(found[0].contents.contains("regra de agentes"));
    }

    #[test]
    #[cfg(unix)]
    fn an_instruction_file_that_leaves_the_root_is_not_loaded() {
        // Este e o vetor que nao precisa de chamada de ferramenta nenhuma: o
        // conteudo entra no prompt de sistema na abertura da sessao. Um link
        // commitado no repositorio despeja qualquer arquivo do usuario ali, sem
        // gate, sem aprovacao e sem o modelo precisar cooperar.
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("segredo"), "chave privada").unwrap();
        std::os::unix::fs::symlink(outside.path().join("segredo"), dir.path().join("AGENTS.md"))
            .unwrap();

        let found = from_sources(dir.path(), None, Some(dir.path()));
        assert!(found.is_empty(), "{found:?}");
    }

    #[test]
    #[cfg(unix)]
    fn a_rule_file_that_leaves_the_root_is_not_loaded() {
        // O diretorio de regras tem a mesma exposicao do arquivo na raiz, e um
        // `.md` la dentro chama menos atencao numa revisao de diff.
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("segredo"), "chave privada").unwrap();
        std::fs::create_dir_all(dir.path().join(".claude/rules")).unwrap();
        std::os::unix::fs::symlink(
            outside.path().join("segredo"),
            dir.path().join(".claude/rules/regra.md"),
        )
        .unwrap();

        assert!(from_sources(dir.path(), None, Some(dir.path())).is_empty());
    }

    #[test]
    fn reads_rule_directories_in_alphabetical_order() {
        // A ordem do sistema de arquivos varia entre maquinas e mudaria o prompt
        // sem que ninguem tivesse mudado nada.
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), ".claude/rules/zeta.md", "z");
        write(dir.path(), ".claude/rules/alfa.md", "a");
        write(dir.path(), ".claude/rules/meio.md", "m");

        let contents: Vec<_> = from_sources(dir.path(), None, Some(dir.path()))
            .into_iter()
            .map(|i| i.contents)
            .collect();
        assert_eq!(contents, vec!["a", "m", "z"]);
    }

    #[test]
    fn non_markdown_files_in_rule_directories_are_ignored() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), ".claude/rules/regra.md", "vale");
        write(dir.path(), ".claude/rules/notas.txt", "nao vale");

        let contents: Vec<_> = from_sources(dir.path(), None, Some(dir.path()))
            .into_iter()
            .map(|i| i.contents)
            .collect();
        assert_eq!(contents, vec!["vale"]);
    }

    #[test]
    fn an_empty_file_is_not_loaded() {
        // Um arquivo em branco so gastaria tokens de cabecalho.
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "AGENTS.md", "   \n\n");
        assert!(from_sources(dir.path(), None, Some(dir.path())).is_empty());
    }

    #[test]
    fn an_oversized_file_is_truncated_and_says_so() {
        // Um AGENTS.md gigante consumiria a janela antes da primeira pergunta.
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "AGENTS.md", &"x".repeat(MAX_BYTES + 1_000));

        let found = from_sources(dir.path(), None, Some(dir.path()));
        assert!(found[0].contents.contains("[truncado]"));
    }

    #[test]
    fn a_workspace_without_conventions_renders_nothing() {
        let dir = tempfile::tempdir().unwrap();
        assert!(from_sources(dir.path(), None, Some(dir.path())).is_empty());
        assert!(render(dir.path(), &[], false).is_none());
    }

    #[test]
    fn rendering_labels_each_source_by_relative_path() {
        // Sem o rotulo, o modelo nao sabe de onde veio a regra e nao consegue
        // citar a origem quando o usuario pergunta.
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "AGENTS.md", "sempre rodar os testes");

        let rendered = render(
            dir.path(),
            &from_sources(dir.path(), None, Some(dir.path())),
            true,
        )
        .unwrap();
        assert!(rendered.contains("## AGENTS.md"));
        assert!(rendered.contains("sempre rodar os testes"));
    }
    #[test]
    fn an_ancestor_directory_contributes_its_instructions() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "AGENTS.md", "ancestral");
        write(dir.path(), "proj/AGENTS.md", "projeto");
        let found = from_sources(&dir.path().join("proj"), None, Some(dir.path()));
        let texts: Vec<_> = found.iter().map(|i| i.contents.as_str()).collect();
        assert_eq!(texts, ["ancestral", "projeto"]);
    }

    #[test]
    fn user_config_instructions_are_loaded_before_the_project() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "user/AGENTS.md", "pessoal");
        write(dir.path(), "proj/AGENTS.md", "projeto");
        let found = from_sources(
            &dir.path().join("proj"),
            Some(&dir.path().join("user")),
            Some(&dir.path().join("proj")),
        );
        let texts: Vec<_> = found.iter().map(|i| i.contents.as_str()).collect();
        assert_eq!(texts, ["pessoal", "projeto"]);
    }

    #[test]
    fn an_override_in_a_directory_replaces_other_instruction_files_there() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "AGENTS.md", "ancestral");
        write(dir.path(), "proj/AGENTS.md", "projeto");
        write(dir.path(), "proj/CLAUDE.md", "claude");
        write(dir.path(), "proj/AGENTS.override.md", "local");
        let found = from_sources(&dir.path().join("proj"), None, Some(dir.path()));
        let texts: Vec<_> = found.iter().map(|i| i.contents.as_str()).collect();
        assert_eq!(texts, ["ancestral", "local"]);
    }

    #[test]
    fn an_override_does_not_hide_instructions_from_another_directory() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "AGENTS.md", "ancestral");
        write(dir.path(), "proj/AGENTS.override.md", "local");
        let found = from_sources(&dir.path().join("proj"), None, Some(dir.path()));
        let texts: Vec<_> = found.iter().map(|i| i.contents.as_str()).collect();
        assert_eq!(texts, ["ancestral", "local"]);
    }
}
