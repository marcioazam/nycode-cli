//! O catálogo de ferramentas que o modelo vê, distinto do gate de permissão.
//!
//! `--allow-writes` decide o que pode *rodar*. `--tools` decide o que é
//! *oferecido*. As duas decisões não se substituem.

use std::collections::BTreeSet;
use std::sync::Arc;
use std::time::Duration;

use nycode_agent::{Agent, Tool};

use super::cli::Cli;
use super::grant::Grant;

/// O que a invocação oferece ao modelo.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Catalog {
    /// O conjunto nativo, mais o que o MCP consentido acrescentar.
    All,
    /// Nada. `--no-tools`.
    None,
    /// Só estes nomes. Ausente no registro é erro, não silêncio.
    Only(BTreeSet<String>),
}

impl Catalog {
    /// O que as flags pedem.
    #[must_use]
    pub fn from_cli(cli: &Cli) -> Self {
        if cli.no_tools {
            Self::None
        } else if cli.tools.is_empty() {
            Self::All
        } else {
            Self::Only(
                cli.tools
                    .iter()
                    .map(|name| name.trim().to_owned())
                    .filter(|name| !name.is_empty())
                    .collect(),
            )
        }
    }

    /// Se este nome entra no catálogo.
    #[must_use]
    pub fn allows(&self, name: &str) -> bool {
        match self {
            Self::All => true,
            Self::None => false,
            Self::Only(names) => names.contains(name),
        }
    }

    pub(crate) fn select(&self, tools: Vec<Arc<dyn Tool>>) -> Vec<Arc<dyn Tool>> {
        match self {
            Self::All => tools,
            Self::None => Vec::new(),
            Self::Only(names) => tools
                .into_iter()
                .filter(|tool| names.contains(tool.name()))
                .collect(),
        }
    }
}

/// Aplica o catálogo da invocação a um conjunto já carregado.
#[must_use]
pub(crate) fn apply(agent: Agent, catalog: &Catalog, tools: Vec<Arc<dyn Tool>>) -> Agent {
    catalog
        .select(tools)
        .into_iter()
        .fold(agent, Agent::with_tool)
}

#[must_use]
pub(crate) fn add_natives(agent: Agent, cli: &Cli, timeout: Duration) -> Agent {
    apply(
        agent,
        &Catalog::from_cli(cli),
        nycode_agent::tools::all_within(timeout),
    )
}

#[must_use]
pub(crate) fn add_task(
    agent: Agent,
    cli: &Cli,
    backend: Arc<dyn nycode_agent::Backend>,
    grant: Grant,
) -> Agent {
    if Catalog::from_cli(cli).allows("task") {
        agent.with_tool(Arc::new(
            nycode_agent::tools::Task::new(backend).with_gate(move || grant.gate()),
        ))
    } else {
        agent
    }
}

#[must_use]
pub(crate) fn add_extensions(agent: Agent, cli: &Cli, extra: Vec<Arc<dyn Tool>>) -> Agent {
    apply(agent, &Catalog::from_cli(cli), extra)
}

/// Recusa nome pedido que nenhuma ferramenta carregada conhece.
///
/// Ignorar em silêncio faria `--tools reed` parecer `--no-tools`.
pub fn check_requested(cli: &Cli, extra: &[Arc<dyn Tool>]) -> anyhow::Result<()> {
    let Catalog::Only(requested) = Catalog::from_cli(cli) else {
        return Ok(());
    };
    let mut known: BTreeSet<String> = nycode_agent::tools::all()
        .iter()
        .map(|tool| tool.name().to_owned())
        .collect();
    known.insert("task".to_owned());
    known.extend(extra.iter().map(|tool| tool.name().to_owned()));
    let missing: Vec<String> = requested.difference(&known).cloned().collect();
    anyhow::ensure!(
        missing.is_empty(),
        "ferramenta desconhecida: {}",
        missing.join(", ")
    );
    Ok(())
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
mod tests {
    use super::*;
    use clap::Parser as _;

    fn names(tools: &[Arc<dyn Tool>]) -> Vec<&str> {
        let mut names: Vec<_> = tools.iter().map(|tool| tool.name()).collect();
        names.sort_unstable();
        names
    }

    fn cli_with(tools: &[&str], no_tools: bool) -> Cli {
        Cli {
            tools: tools.iter().map(|name| (*name).to_owned()).collect(),
            no_tools,
            ..Cli::parse_from(["nycode"])
        }
    }

    #[test]
    fn the_default_offers_every_native_tool() {
        let catalog = Catalog::from_cli(&cli_with(&[], false));
        assert_eq!(catalog, Catalog::All);
        let kept = catalog.select(nycode_agent::tools::all());
        assert_eq!(
            names(&kept),
            ["bash", "edit", "find", "grep", "ls", "read", "write"]
        );
    }

    #[test]
    fn no_tools_offers_an_empty_catalog() {
        let catalog = Catalog::from_cli(&cli_with(&[], true));
        assert_eq!(catalog, Catalog::None);
        assert!(catalog.select(nycode_agent::tools::all()).is_empty());
        assert!(!catalog.allows("read"));
        assert!(!catalog.allows("task"));
    }

    #[test]
    fn a_name_list_is_the_catalog_sent_to_the_model_not_a_grant() {
        // write continua no catalogo; o gate e quem recusa rodar. As duas
        // decisoes nao se substituem.
        let catalog = Catalog::from_cli(&cli_with(&["read", " write", "  "], false));
        let kept = catalog.select(nycode_agent::tools::all());
        assert_eq!(names(&kept), ["read", "write"]);
        assert!(catalog.allows("write"));
        assert!(!catalog.allows("bash"));
        let denied = nycode_agent::ToolCall {
            id: "t".to_owned(),
            name: "write".to_owned(),
            input: serde_json::Value::Null,
        };
        assert!(!Grant::ReadOnly.gate().check(&denied).is_allowed());
    }

    #[test]
    fn an_unknown_name_is_an_error_instead_of_an_empty_catalog() {
        let err =
            check_requested(&cli_with(&["read", "reed"], false), &[]).expect_err("nome inventado");
        assert!(err.to_string().contains("reed"));
        assert!(!err.to_string().contains("read"));
        check_requested(&cli_with(&["read"], false), &[]).expect("read existe");
        check_requested(&cli_with(&["read", "  "], false), &[]).expect("blank is dropped");
        check_requested(&cli_with(&["read"], false), &nycode_agent::tools::all())
            .expect("extra nativo");
        check_requested(&cli_with(&["task"], false), &[]).expect("task existe");
        assert!(Catalog::from_cli(&cli_with(&["task"], false)).allows("task"));
        assert!(!Catalog::from_cli(&cli_with(&["read"], false)).allows("task"));
    }

    struct Mute;

    #[async_trait::async_trait]
    impl nycode_agent::Backend for Mute {
        async fn stream(
            &self,
            _: Vec<nycode_ai::anthropic::Message>,
            _: Option<String>,
            _: Vec<nycode_ai::anthropic::ToolSpec>,
        ) -> nycode_ai::Result<nycode_agent::backend::EventStream> {
            Ok(Box::pin(futures_util::stream::empty()))
        }
    }

    fn agent() -> Agent {
        let dir = tempfile::tempdir().unwrap();
        Agent::new(
            Arc::new(Mute),
            nycode_agent::ToolContext::new(dir.path()).unwrap(),
        )
    }

    #[test]
    fn the_session_helpers_offer_only_what_the_catalog_allows() {
        let none = add_natives(agent(), &cli_with(&[], true), Duration::from_secs(1));
        assert!(!format!("{none:?}").contains("read"));
        let read = format!(
            "{:?}",
            add_natives(agent(), &cli_with(&["read"], false), Duration::from_secs(1))
        );
        assert!(read.contains("read") && !read.contains("bash"), "{read}");
        assert!(
            format!(
                "{:?}",
                add_task(
                    agent(),
                    &cli_with(&["task"], false),
                    Arc::new(Mute),
                    Grant::ReadOnly
                )
            )
            .contains("task")
        );
        assert!(
            !format!(
                "{:?}",
                add_task(
                    agent(),
                    &cli_with(&["read"], false),
                    Arc::new(Mute),
                    Grant::ReadOnly
                )
            )
            .contains("task")
        );
        let extra = format!(
            "{:?}",
            add_extensions(
                agent(),
                &cli_with(&["read"], false),
                nycode_agent::tools::all()
            )
        );
        assert!(extra.contains("read") && !extra.contains("bash"), "{extra}");
    }
}
