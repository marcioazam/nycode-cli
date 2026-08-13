//! Carregamento de skills no formato `SKILL.md`.
//!
//! O formato é o padrão aberto que Claude Code, Codex e outros já leem, então
//! uma skill escrita para qualquer um deles funciona aqui sem tradução.

use std::fmt::Write as _;
use std::path::{Path, PathBuf};

/// Uma skill descoberta no disco.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Skill {
    pub name: String,
    /// O que faz a skill ser escolhida. É o campo que mais importa: uma
    /// descrição vaga faz a skill nunca disparar.
    pub description: String,
    pub body: String,
    pub path: PathBuf,
}

/// Diretórios varridos, em ordem de precedência crescente.
///
/// O escopo de projeto vence o global porque uma convenção do repositório é mais
/// específica que uma preferência da máquina.
const SKILL_DIRS: &[&str] = &[".nycode/skills", ".claude/skills", ".agents/skills"];

/// Descobre skills a partir da raiz do workspace.
#[must_use]
pub fn discover(root: &Path) -> Vec<Skill> {
    let mut skills = Vec::new();
    for relative in SKILL_DIRS {
        let dir = root.join(relative);
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.filter_map(std::result::Result::ok) {
            let manifest = entry.path().join("SKILL.md");
            if let Some(skill) = load(root, &manifest) {
                skills.push(skill);
            }
        }
    }
    // Ordem estavel: um catalogo que muda de ordem entre execucoes invalida o
    // cache de prompt do backend sem nenhum ganho.
    skills.sort_by(|a, b| a.name.cmp(&b.name));
    skills.dedup_by(|a, b| a.name == b.name);
    skills
}

/// Lê uma skill de um `SKILL.md`.
///
/// Retorna `None` quando o frontmatter não declara `name` e `description`: sem
/// eles o modelo não tem como decidir quando usar a skill, e carregá-la só
/// gastaria contexto.
#[must_use]
pub fn load(root: &Path, path: &Path) -> Option<Skill> {
    if !crate::tool::stays_within(root, path) {
        tracing::warn!(
            path = %path.display(),
            "skill aponta para fora do workspace, ignorada"
        );
        return None;
    }
    let contents = std::fs::read_to_string(path).ok()?;
    let (frontmatter, body) = split_frontmatter(&contents)?;

    let name = field(frontmatter, "name")?;
    let description = field(frontmatter, "description")?;
    if name.is_empty() || description.is_empty() {
        return None;
    }

    Some(Skill {
        name,
        description,
        body: body.trim().to_owned(),
        path: path.to_path_buf(),
    })
}

/// Separa o frontmatter YAML do corpo.
fn split_frontmatter(contents: &str) -> Option<(&str, &str)> {
    let rest = contents
        .strip_prefix("---\n")
        .or_else(|| contents.strip_prefix("---\r\n"))?;
    let end = rest.find("\n---")?;
    Some((
        &rest[..end],
        rest[end..].trim_start_matches(['\n', '-', '\r']),
    ))
}

/// Extrai um campo escalar do frontmatter.
///
/// Um parser YAML completo seria mais correto, mas `SKILL.md` na prática usa
/// apenas escalares de uma linha, e a dependência extra não se paga.
fn field(frontmatter: &str, key: &str) -> Option<String> {
    frontmatter.lines().find_map(|line| {
        let (found, value) = line.split_once(':')?;
        if found.trim() != key {
            return None;
        }
        Some(value.trim().trim_matches(['"', '\'']).to_owned())
    })
}

/// Renderiza as skills como bloco de instrução.
#[must_use]
pub fn render(skills: &[Skill]) -> Option<String> {
    if skills.is_empty() {
        return None;
    }
    let mut out = String::from("# Skills disponiveis\n\n");
    for skill in skills {
        let _ = write!(out, "## {}\n{}\n\n", skill.name, skill.description);
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_skill(root: &Path, dir: &str, name: &str, contents: &str) {
        let path = root.join(dir).join(name);
        std::fs::create_dir_all(&path).unwrap();
        std::fs::write(path.join("SKILL.md"), contents).unwrap();
    }

    const VALID: &str = "---\nname: revisor\ndescription: Revisa codigo antes do commit\n---\n\nInstrucoes detalhadas.\n";

    #[test]
    fn loads_name_description_and_body() {
        let dir = tempfile::tempdir().unwrap();
        write_skill(dir.path(), ".nycode/skills", "revisor", VALID);

        let skills = discover(dir.path());
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].name, "revisor");
        assert_eq!(skills[0].description, "Revisa codigo antes do commit");
        assert_eq!(skills[0].body, "Instrucoes detalhadas.");
    }

    #[test]
    fn reads_the_claude_code_and_agents_directories_too() {
        // Uma skill escrita para outro harness precisa funcionar sem traducao.
        let dir = tempfile::tempdir().unwrap();
        write_skill(
            dir.path(),
            ".claude/skills",
            "a",
            VALID.replace("revisor", "de-claude").as_str(),
        );
        write_skill(
            dir.path(),
            ".agents/skills",
            "b",
            VALID.replace("revisor", "de-agents").as_str(),
        );

        let names: Vec<_> = discover(dir.path()).into_iter().map(|s| s.name).collect();
        assert!(names.contains(&"de-claude".to_owned()));
        assert!(names.contains(&"de-agents".to_owned()));
    }

    #[test]
    #[cfg(unix)]
    fn a_skill_manifest_that_leaves_the_root_is_not_loaded() {
        // O alvo e um SKILL.md valido de proposito: se fosse lixo, o teste
        // passaria por falta de frontmatter e nao por causa da contencao.
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("roubado.md"), VALID).unwrap();
        let skill_dir = dir.path().join(".nycode/skills/uma");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::os::unix::fs::symlink(
            outside.path().join("roubado.md"),
            skill_dir.join("SKILL.md"),
        )
        .unwrap();

        assert!(discover(dir.path()).is_empty());
    }

    #[test]
    fn a_skill_without_a_description_is_skipped() {
        // Sem descricao o modelo nao tem como decidir quando usar a skill;
        // carrega-la so gastaria contexto.
        let dir = tempfile::tempdir().unwrap();
        write_skill(
            dir.path(),
            ".nycode/skills",
            "muda",
            "---\nname: muda\n---\n\ncorpo\n",
        );
        assert!(discover(dir.path()).is_empty());
    }

    #[test]
    fn a_file_without_frontmatter_is_skipped() {
        let dir = tempfile::tempdir().unwrap();
        write_skill(dir.path(), ".nycode/skills", "solta", "# Apenas markdown\n");
        assert!(discover(dir.path()).is_empty());
    }

    #[test]
    fn quoted_values_are_unwrapped() {
        let dir = tempfile::tempdir().unwrap();
        write_skill(
            dir.path(),
            ".nycode/skills",
            "x",
            "---\nname: \"com aspas\"\ndescription: 'simples'\n---\ncorpo\n",
        );
        let skills = discover(dir.path());
        assert_eq!(skills[0].name, "com aspas");
        assert_eq!(skills[0].description, "simples");
    }

    #[test]
    fn duplicate_names_collapse_to_one() {
        // A mesma skill presente em dois diretorios nao deve entrar duas vezes
        // no prompt.
        let dir = tempfile::tempdir().unwrap();
        write_skill(dir.path(), ".nycode/skills", "a", VALID);
        write_skill(dir.path(), ".claude/skills", "a", VALID);
        assert_eq!(discover(dir.path()).len(), 1);
    }

    #[test]
    fn discovery_order_is_stable_across_runs() {
        // Ordem instavel invalida o cache de prompt do backend sem ganho.
        let dir = tempfile::tempdir().unwrap();
        for name in ["zeta", "alfa", "meio"] {
            write_skill(
                dir.path(),
                ".nycode/skills",
                name,
                &VALID.replace("revisor", name),
            );
        }
        let first: Vec<_> = discover(dir.path()).into_iter().map(|s| s.name).collect();
        let second: Vec<_> = discover(dir.path()).into_iter().map(|s| s.name).collect();
        assert_eq!(first, second);
        assert_eq!(first, vec!["alfa", "meio", "zeta"]);
    }

    #[test]
    fn a_workspace_without_skills_yields_nothing_to_render() {
        let dir = tempfile::tempdir().unwrap();
        assert!(discover(dir.path()).is_empty());
        assert!(render(&[]).is_none());
    }

    #[test]
    fn rendering_lists_name_and_description_but_not_the_body() {
        // O corpo so entra em contexto quando a skill e efetivamente usada;
        // despejar tudo de uma vez desperdicaria a janela.
        let dir = tempfile::tempdir().unwrap();
        write_skill(dir.path(), ".nycode/skills", "revisor", VALID);

        let rendered = render(&discover(dir.path())).unwrap();
        assert!(rendered.contains("revisor"));
        assert!(rendered.contains("Revisa codigo"));
        assert!(!rendered.contains("Instrucoes detalhadas"));
    }
}
