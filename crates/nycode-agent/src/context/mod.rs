//! Contexto descoberto no workspace.
//!
//! Duas fontes, ambas em formatos que já existem: arquivos de instrução do
//! projeto e skills em `SKILL.md`. Nenhum formato próprio é inventado — ver
//! ADR-0002.

pub mod commands;
pub mod instructions;
pub mod skills;

use std::path::Path;

pub use commands::Command;
pub use instructions::Instruction;
pub use skills::Skill;

/// Tudo que o workspace contribui para a sessão.
#[derive(Debug, Clone, Default)]
pub struct Context {
    pub instructions: Vec<Instruction>,
    pub skills: Vec<Skill>,
    /// Slash commands. Não entram no prompt de sistema: são atalhos de entrada,
    /// expandidos no cliente antes de virar um pedido comum.
    pub commands: Vec<Command>,
}

impl Context {
    /// Varre o workspace e as camadas fora dele (config do usuário e ancestrais).
    #[must_use]
    pub fn discover(root: &Path) -> Self {
        Self::from_sources(
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

    /// `ceiling` corta a subida ancestral; sem ele, sobe até a raiz do disco.
    #[must_use]
    pub fn from_sources(root: &Path, user: Option<&Path>, ceiling: Option<&Path>) -> Self {
        Self {
            instructions: instructions::from_sources(root, user, ceiling),
            skills: skills::discover(root),
            commands: commands::discover(root),
        }
    }

    /// Monta o prompt de sistema completo.
    #[must_use]
    pub fn system_prompt(&self, base: &str, root: &Path) -> String {
        let mut prompt = base.to_owned();
        for block in [
            instructions::render(root, &self.instructions),
            skills::render(&self.skills),
        ]
        .into_iter()
        .flatten()
        {
            prompt.push_str("\n\n");
            prompt.push_str(&block);
        }
        prompt
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.instructions.is_empty() && self.skills.is_empty() && self.commands.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_empty_workspace_leaves_the_base_prompt_untouched() {
        let dir = tempfile::tempdir().unwrap();
        let context = Context::from_sources(dir.path(), None, Some(dir.path()));

        assert!(context.is_empty());
        assert_eq!(context.system_prompt("base", dir.path()), "base");
    }

    #[test]
    fn discovered_context_is_appended_after_the_base_prompt() {
        // A base define o comportamento do agente; as convencoes do projeto a
        // especializam. Inverter a ordem deixaria a base sobrescrever o projeto.
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("AGENTS.md"), "rode os testes").unwrap();

        let prompt = Context::from_sources(dir.path(), None, Some(dir.path()))
            .system_prompt("Voce e o nycode.", dir.path());
        assert!(prompt.starts_with("Voce e o nycode."));
        assert!(prompt.contains("rode os testes"));
    }

    #[test]
    fn instructions_come_before_skills() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("AGENTS.md"), "convencao").unwrap();
        let skill_dir = dir.path().join(".nycode/skills/uma");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: uma\ndescription: faz algo\n---\ncorpo\n",
        )
        .unwrap();

        let prompt = Context::from_sources(dir.path(), None, Some(dir.path()))
            .system_prompt("base", dir.path());
        let conventions = prompt.find("Convencoes").unwrap();
        let skills = prompt.find("Skills").unwrap();
        assert!(conventions < skills);
    }
}
