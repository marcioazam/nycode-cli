//! Carregamento de skills no formato `SKILL.md`.
//!
//! O formato é o padrão aberto que Claude Code, Codex e outros já leem, então
//! uma skill escrita para qualquer um deles funciona aqui sem tradução.

use std::collections::BTreeMap;
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
    pub license: Option<String>,
    pub compatibility: Option<String>,
    pub allowed_tools: Option<String>,
    pub metadata: BTreeMap<String, String>,
    pub disable_model_invocation: bool,
}

/// Diretórios varridos, em ordem de precedência crescente.
///
/// Os três vêm do repositório; não há escopo global aqui, e o último vence.
/// Uma skill não vira processo, mas o nome e a descrição dela entram no prompt
/// de sistema, então a origem é a mesma de todo o resto: o diretório clonado.
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
        license: optional(frontmatter, "license"),
        compatibility: optional(frontmatter, "compatibility"),
        allowed_tools: optional(frontmatter, "allowed-tools"),
        metadata: mapping(frontmatter, "metadata"),
        disable_model_invocation: optional(frontmatter, "disable-model-invocation")
            .is_some_and(|v| v == "true"),
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

fn optional(frontmatter: &str, key: &str) -> Option<String> {
    field(frontmatter, key).filter(|value| !value.is_empty())
}

fn mapping(frontmatter: &str, key: &str) -> BTreeMap<String, String> {
    let header = format!("{key}:");
    let mut lines = frontmatter.lines().peekable();
    let mut map = BTreeMap::new();
    while let Some(line) = lines.next() {
        if line.trim() != header {
            continue;
        }
        while let Some(next) = lines.peek().copied() {
            let Some(rest) = next.strip_prefix("  ") else {
                break;
            };
            let Some((k, v)) = rest.split_once(':') else {
                break;
            };
            if k.is_empty() || k.starts_with(' ') {
                break;
            }
            map.insert(
                k.trim().to_owned(),
                v.trim().trim_matches(['"', '\'']).to_owned(),
            );
            lines.next();
        }
        break;
    }
    map
}

/// Renderiza as skills como bloco de instrução.
///
/// O corpo fica de fora — despejar todos de uma vez gastaria a janela com
/// instrução que a maioria dos turnos não usa. Mas o **caminho** entra: sem ele
/// o modelo sabe que a skill existe e não tem como carregar o corpo dela, e a
/// economia de janela vira a skill não funcionar.
#[must_use]
pub fn render(skills: &[Skill]) -> Option<String> {
    let visible: Vec<&Skill> = skills
        .iter()
        .filter(|skill| !skill.disable_model_invocation)
        .collect();
    if visible.is_empty() {
        return None;
    }
    let mut out = String::from(
        "# Skills disponiveis\n\nLeia o arquivo indicado para carregar a skill antes de segui-la.\n\n",
    );
    for skill in visible {
        let _ = writeln!(
            out,
            "## {}\n{}\nArquivo: {}",
            skill.name,
            skill.description,
            skill.path.display()
        );
        declare(&mut out, "Licenca", skill.license.as_deref());
        declare(&mut out, "Compatibilidade", skill.compatibility.as_deref());
        declare(&mut out, "Ferramentas", skill.allowed_tools.as_deref());
        for (key, value) in &skill.metadata {
            let _ = writeln!(out, "{key}: {value}");
        }
        out.push('\n');
    }
    Some(out)
}

fn declare(out: &mut String, label: &str, value: Option<&str>) {
    if let Some(value) = value {
        let _ = writeln!(out, "{label}: {value}");
    }
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

    #[test]
    fn rendering_names_the_file_so_the_body_can_be_loaded_when_it_is_needed() {
        // Deixar o corpo de fora so funciona se houver como busca-lo depois.
        // Sem o caminho, o modelo sabe que a skill existe e nao consegue segui-la
        // — a economia de janela vira a skill nao funcionar.
        let dir = tempfile::tempdir().unwrap();
        write_skill(dir.path(), ".nycode/skills", "revisor", VALID);

        let rendered = render(&discover(dir.path())).unwrap();

        assert!(
            rendered.contains("SKILL.md"),
            "o caminho do manifesto precisa aparecer: {rendered}"
        );
        assert!(rendered.contains("revisor/SKILL.md"), "{rendered}");
    }
    #[test]
    fn a_skill_that_disables_model_invocation_is_kept_but_not_rendered() {
        let dir = tempfile::tempdir().unwrap();
        write_skill(
            dir.path(),
            ".nycode/skills",
            "secreto",
            "---\nname: secreto\ndescription: nao mostre\ndisable-model-invocation: true\n---\ncorpo\n",
        );
        write_skill(dir.path(), ".nycode/skills", "revisor", VALID);
        let skills = discover(dir.path());
        assert_eq!(skills.len(), 2);
        assert!(
            skills
                .iter()
                .any(|s| s.name == "secreto" && s.disable_model_invocation)
        );
        let rendered = render(&skills).unwrap();
        assert!(!rendered.contains("secreto"), "{rendered}");
        assert!(rendered.contains("revisor"), "{rendered}");
    }

    #[test]
    fn optional_agent_skills_fields_are_declared_in_the_catalog() {
        let dir = tempfile::tempdir().unwrap();
        write_skill(
            dir.path(),
            ".nycode/skills",
            "pdf",
            "---\nname: pdf\ndescription: extrai texto\nlicense: MIT\ncompatibility: needs git\nallowed-tools: Read\nmetadata:\n  author: nylla\n    deeper: ignored\n---\ncorpo\n",
        );
        let rendered = render(&discover(dir.path())).unwrap();
        assert!(rendered.contains("MIT"), "{rendered}");
        assert!(rendered.contains("needs git"), "{rendered}");
        assert!(rendered.contains("Read"), "{rendered}");
        assert!(rendered.contains("nylla"), "{rendered}");
        assert!(
            !rendered.contains("deeper") && !rendered.contains("ignored"),
            "{rendered}"
        );
    }
}
