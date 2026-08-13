//! Gate de permissão de ferramentas.
//!
//! O padrão é somente-leitura. Um agente que escreve e executa comandos sem
//! consentimento explícito é uma decisão que o usuário precisa tomar, não uma
//! conveniência que o harness assume — especialmente em modo headless, onde não
//! há ninguém para perguntar.

use std::collections::BTreeSet;

use crate::tool::ToolCall;

/// Veredito sobre uma chamada.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Decision {
    Allow,
    /// Recusada, com o motivo que chega ao modelo.
    Deny(String),
    /// Sem resposta óbvia: perguntar a quem estiver atendendo.
    ///
    /// Em modo headless não há a quem perguntar e isto vira recusa. É o caso do
    /// meio entre "sempre pode" e "nunca pode", e existe porque decidir tudo de
    /// antemão obriga a escolher entre sessão inútil e cheque em branco.
    Ask,
}

impl Decision {
    #[must_use]
    pub const fn is_allowed(&self) -> bool {
        matches!(self, Self::Allow)
    }
}

/// Decide se uma chamada pode ser executada.
pub trait Gate: Send + Sync + std::fmt::Debug {
    fn check(&self, call: &ToolCall) -> Decision;
}

/// Ferramentas que não modificam nada.
const READ_ONLY: &[&str] = &["read", "grep", "find", "ls"];

/// Somente-leitura. É o padrão.
#[derive(Debug, Default, Clone, Copy)]
pub struct ReadOnly;

impl Gate for ReadOnly {
    fn check(&self, call: &ToolCall) -> Decision {
        if READ_ONLY.contains(&call.name.as_str()) {
            return Decision::Allow;
        }
        Decision::Deny(format!(
            "`{}` modifica o workspace e a sessao esta em modo somente-leitura. \
             O usuario precisa habilitar escrita explicitamente.",
            call.name
        ))
    }
}

/// Permite o que não muta e pergunta pelo resto.
///
/// É o gate de uma sessão interativa: há a quem perguntar, então decidir de
/// antemão obrigaria a escolher entre sessão inútil e cheque em branco.
#[derive(Debug, Default, Clone, Copy)]
pub struct Ask;

impl Gate for Ask {
    fn check(&self, call: &ToolCall) -> Decision {
        if READ_ONLY.contains(&call.name.as_str()) {
            return Decision::Allow;
        }
        Decision::Ask
    }
}

/// Permite tudo. Exige escolha consciente do operador.
#[derive(Debug, Default, Clone, Copy)]
pub struct AllowAll;

impl Gate for AllowAll {
    fn check(&self, _call: &ToolCall) -> Decision {
        Decision::Allow
    }
}

/// Permite apenas os nomes listados, somando-se aos de leitura.
#[derive(Debug, Clone)]
pub struct Allowlist {
    allowed: BTreeSet<String>,
}

impl Allowlist {
    pub fn new<I, S>(names: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        let mut allowed: BTreeSet<String> = READ_ONLY.iter().map(|s| (*s).to_owned()).collect();
        allowed.extend(names.into_iter().map(Into::into));
        Self { allowed }
    }
}

impl Gate for Allowlist {
    fn check(&self, call: &ToolCall) -> Decision {
        if self.allowed.contains(&call.name) {
            return Decision::Allow;
        }
        Decision::Deny(format!(
            "`{}` nao esta na lista permitida ({})",
            call.name,
            self.allowed.iter().cloned().collect::<Vec<_>>().join(", ")
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn call(name: &str) -> ToolCall {
        ToolCall {
            id: "t1".to_owned(),
            name: name.to_owned(),
            input: json!({}),
        }
    }

    #[test]
    fn read_only_permits_reads_and_refuses_mutations() {
        for name in READ_ONLY {
            assert!(
                ReadOnly.check(&call(name)).is_allowed(),
                "{name} deveria passar"
            );
        }
        for name in ["write", "edit", "bash"] {
            assert!(
                !ReadOnly.check(&call(name)).is_allowed(),
                "{name} nao deveria passar"
            );
        }
    }

    #[test]
    fn a_refusal_explains_itself_to_the_model() {
        // O modelo precisa entender que foi politica, nao falha da ferramenta,
        // senao ele tenta de novo em loop.
        let Decision::Deny(reason) = ReadOnly.check(&call("bash")) else {
            panic!("bash deveria ser recusado");
        };
        assert!(reason.contains("bash"));
        assert!(reason.contains("somente-leitura"));
    }

    #[test]
    fn an_unknown_tool_is_refused_by_default_not_allowed() {
        // Falhar aberto aqui significaria que qualquer ferramenta nova, incluindo
        // uma vinda de um servidor MCP de terceiro, roda sem consentimento.
        assert!(!ReadOnly.check(&call("ferramenta_nova")).is_allowed());
    }

    #[test]
    fn allow_all_permits_everything_including_unknown_tools() {
        assert!(AllowAll.check(&call("bash")).is_allowed());
        assert!(AllowAll.check(&call("qualquer_coisa")).is_allowed());
    }

    #[test]
    fn an_allowlist_always_includes_the_read_only_set() {
        // Listar `write` sem herdar `read` produziria um agente que escreve sem
        // conseguir verificar o que escreveu.
        let gate = Allowlist::new(["write"]);
        assert!(gate.check(&call("write")).is_allowed());
        assert!(gate.check(&call("read")).is_allowed());
        assert!(!gate.check(&call("bash")).is_allowed());
    }

    #[test]
    fn the_allowlist_refusal_names_what_is_permitted() {
        let gate = Allowlist::new(["write"]);
        let Decision::Deny(reason) = gate.check(&call("bash")) else {
            panic!("bash deveria ser recusado");
        };
        assert!(reason.contains("write"));
        assert!(reason.contains("read"));
    }

    #[test]
    fn an_empty_allowlist_is_still_read_only_not_deny_all() {
        let gate = Allowlist::new(Vec::<String>::new());
        assert!(gate.check(&call("read")).is_allowed());
        assert!(!gate.check(&call("write")).is_allowed());
    }
}
