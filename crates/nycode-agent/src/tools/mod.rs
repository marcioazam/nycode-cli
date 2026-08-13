//! Ferramentas nativas.
//!
//! Dois conjuntos. O de mutação — ler, escrever, editar, executar — é o padrão,
//! e não cresce: capacidades adicionais chegam por servidores MCP, e não por
//! acréscimo a este módulo (ADR-0002).
//!
//! O somente-leitura — buscar conteúdo, buscar nome, listar — existe para que
//! uma sessão possa ser restringida sem ficar cega. Sem ele, negar `bash` deixa
//! o agente sem como olhar o repositório, e a escolha passa a ser entre dar
//! shell ou não ter agente.

mod bash;
mod edit;
mod read;
mod search;
mod task;
mod write;

pub use bash::Bash;
pub use edit::Edit;
pub use read::Read;
pub use search::{Find, Grep, Ls};
pub use task::Task;
pub use write::Write;

use std::sync::Arc;

use crate::tool::Tool;

/// Ferramentas que observam o workspace sem alterá-lo.
#[must_use]
pub fn read_only() -> Vec<Arc<dyn Tool>> {
    vec![Arc::new(Read), Arc::new(Grep), Arc::new(Find), Arc::new(Ls)]
}

/// Ferramentas que alteram o workspace.
#[must_use]
pub fn mutating() -> Vec<Arc<dyn Tool>> {
    vec![Arc::new(Write), Arc::new(Edit), Arc::new(Bash::default())]
}

/// Todas as ferramentas nativas, prontas para registro.
#[must_use]
pub fn all() -> Vec<Arc<dyn Tool>> {
    let mut tools = read_only();
    tools.extend(mutating());
    tools
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::policy::permission::Gate as _;

    fn names(tools: &[Arc<dyn Tool>]) -> Vec<String> {
        let mut names: Vec<_> = tools.iter().map(|t| t.name().to_owned()).collect();
        names.sort();
        names
    }

    #[test]
    fn the_native_set_is_exactly_the_seven_documented_tools() {
        // Se este teste precisar mudar, a decisao do ADR-0002 esta sendo
        // revertida e isso merece uma conversa, nao um commit.
        assert_eq!(
            names(&all()),
            vec!["bash", "edit", "find", "grep", "ls", "read", "write"]
        );
    }

    #[test]
    fn the_read_only_set_matches_what_the_permission_gate_allows() {
        // O gate somente-leitura nomeia estas quatro. Divergir faria uma sessao
        // restringida receber uma ferramenta que o gate recusa em seguida, ou
        // ficar sem uma que ele permitiria.
        let allowed = names(&read_only());
        for name in &allowed {
            assert!(
                crate::policy::permission::ReadOnly
                    .check(&crate::tool::ToolCall {
                        id: "t".to_owned(),
                        name: name.clone(),
                        input: serde_json::Value::Null,
                    })
                    .is_allowed(),
                "o gate recusa `{name}`, que esta no conjunto somente-leitura"
            );
        }
        assert_eq!(allowed, vec!["find", "grep", "ls", "read"]);
    }

    #[test]
    fn no_mutating_tool_passes_the_read_only_gate() {
        for tool in mutating() {
            assert!(
                !crate::policy::permission::ReadOnly
                    .check(&crate::tool::ToolCall {
                        id: "t".to_owned(),
                        name: tool.name().to_owned(),
                        input: serde_json::Value::Null,
                    })
                    .is_allowed(),
                "o gate permite `{}`, que altera o workspace",
                tool.name()
            );
        }
    }

    #[test]
    fn the_two_sets_do_not_overlap() {
        for tool in mutating() {
            assert!(
                !names(&read_only()).contains(&tool.name().to_owned()),
                "`{}` esta nos dois conjuntos",
                tool.name()
            );
        }
    }

    #[test]
    fn every_tool_declares_a_description_and_an_object_schema() {
        // Uma descricao vazia faz o modelo nunca escolher a ferramenta; um schema
        // sem `type` faz o backend recusar a declaracao.
        for tool in all() {
            assert!(
                !tool.description().is_empty(),
                "{} sem descricao",
                tool.name()
            );
            assert_eq!(
                tool.input_schema()["type"],
                "object",
                "{} sem schema",
                tool.name()
            );
        }
    }
}
