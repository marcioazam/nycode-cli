//! Quanto a sessão concede de antemão.
//!
//! Era um booleano, e o booleano dizia menos do que fazia: `--allow-writes`
//! trocava o gate por um que permite tudo — shell e toda ferramenta de todo
//! servidor MCP de terceiro —, quando o nome promete escrita de arquivo.
//!
//! Três valores porque são três decisões diferentes, e o usuário precisa poder
//! tomar a do meio.

use nycode_agent::{AllowAll, Allowlist, Gate, ReadOnly};

/// Ferramentas que `--allow-writes` concede.
///
/// Só as que editam o workspace. `bash` fica de fora porque um shell alcança
/// tudo que as outras alcançam e mais, e porque a contenção dele é de outro
/// tipo: as ferramentas passam pela resolução de caminho, o comando não.
const WRITE_TOOLS: &[&str] = &["write", "edit"];

/// O que a sessão pode fazer sem perguntar.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Grant {
    /// Nada além de ler. É o padrão.
    #[default]
    ReadOnly,
    /// Escrever e editar arquivo, e só isso.
    Writes,
    /// Tudo, inclusive shell e ferramenta de servidor de terceiro.
    All,
}

impl Grant {
    /// O que as flags da linha de comando pedem.
    ///
    /// `--allow-all` vence porque é o pedido mais específico: quem passa as
    /// duas está pedindo a maior.
    #[must_use]
    pub const fn from_flags(writes: bool, all: bool) -> Self {
        if all {
            Self::All
        } else if writes {
            Self::Writes
        } else {
            Self::ReadOnly
        }
    }

    /// O gate correspondente.
    #[must_use]
    pub fn gate(self) -> Box<dyn Gate> {
        match self {
            Self::ReadOnly => Box::new(ReadOnly),
            Self::Writes => Box::new(Allowlist::new(WRITE_TOOLS.iter().copied())),
            Self::All => Box::new(AllowAll),
        }
    }

    /// Se a sessão já decidiu tudo e não há o que perguntar.
    ///
    /// Só a concessão total dispensa a pergunta. Com `--allow-writes` ainda há
    /// decisão a tomar sobre `bash`, e é a interface que a toma.
    #[must_use]
    pub const fn decides_everything(self) -> bool {
        matches!(self, Self::All)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nycode_agent::ToolCall;

    fn call(name: &str) -> ToolCall {
        ToolCall {
            id: "t1".to_owned(),
            name: name.to_owned(),
            input: serde_json::Value::Null,
        }
    }

    #[test]
    fn the_default_grants_nothing_beyond_reading() {
        let gate = Grant::default().gate();
        assert!(gate.check(&call("read")).is_allowed());
        assert!(!gate.check(&call("write")).is_allowed());
        assert!(!gate.check(&call("bash")).is_allowed());
    }

    #[test]
    fn permission_to_write_is_not_permission_to_run_a_shell() {
        // Era o defeito: `--allow-writes` trocava o gate por um que permitia
        // tudo, e o nome prometia escrita de arquivo.
        let gate = Grant::Writes.gate();

        assert!(gate.check(&call("write")).is_allowed());
        assert!(gate.check(&call("edit")).is_allowed());
        assert!(
            !gate.check(&call("bash")).is_allowed(),
            "shell nao foi pedido"
        );
    }

    #[test]
    fn permission_to_write_is_not_permission_to_call_a_third_party_tool() {
        // Uma ferramenta de servidor MCP chega com nome qualificado; conceder
        // escrita nao pode conceder o catalogo inteiro de terceiro junto.
        let gate = Grant::Writes.gate();
        assert!(!gate.check(&call("docs__search")).is_allowed());
    }

    #[test]
    fn writing_still_lets_the_agent_read_what_it_wrote() {
        // Escrever sem poder verificar produziria um agente cego para o proprio
        // efeito.
        let gate = Grant::Writes.gate();
        assert!(gate.check(&call("read")).is_allowed());
        assert!(gate.check(&call("grep")).is_allowed());
    }

    #[test]
    fn the_broad_grant_still_exists_for_whoever_asks_for_it() {
        let gate = Grant::All.gate();
        assert!(gate.check(&call("bash")).is_allowed());
        assert!(gate.check(&call("qualquer_coisa")).is_allowed());
    }

    #[test]
    fn the_broader_flag_wins_when_both_are_given() {
        assert_eq!(Grant::from_flags(false, false), Grant::ReadOnly);
        assert_eq!(Grant::from_flags(true, false), Grant::Writes);
        assert_eq!(Grant::from_flags(false, true), Grant::All);
        assert_eq!(Grant::from_flags(true, true), Grant::All);
    }

    #[test]
    fn only_the_broad_grant_settles_every_question_in_advance() {
        // Com `--allow-writes` ainda ha decisao a tomar sobre `bash`, e quem a
        // toma e a interface.
        assert!(Grant::All.decides_everything());
        assert!(!Grant::Writes.decides_everything());
        assert!(!Grant::ReadOnly.decides_everything());
    }
}
