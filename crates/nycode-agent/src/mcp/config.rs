//! Descoberta de servidores MCP.
//!
//! O formato é o `.mcp.json` que Claude Code, Codex e outros já usam, então uma
//! configuração existente funciona sem tradução. Não se inventa formato próprio
//! — ver ADR-0002.

use std::collections::BTreeMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

/// Arquivos consultados, em ordem de precedência crescente.
///
/// Os três vêm do repositório; não há escopo global aqui, e o último vence.
///
/// Dizer que "o escopo de projeto vence o global" sugeria uma camada confiável
/// acima destes, que não existe: os três estão sob controle de quem escreveu o
/// diretório, e é por isso que todos passam pelo consentimento do
/// [ADR-0016](../../../../docs/architecture/decisions/0016-extensao-do-workspace-exige-consentimento.md)
/// antes de virar processo.
const CONFIG_FILES: &[&str] = &[".mcp.json", ".claude/mcp.json", ".nycode/mcp.json"];

/// Como falar com um servidor MCP.
///
/// Duas formas, distinguidas por qual campo veio preenchido: um `command`
/// inicia o servidor como processo filho e conversa por stdio; uma `url` fala
/// Streamable HTTP com um servidor que já está no ar. É a mesma convenção que
/// os outros harnesses gravam, e por isso `command` e `url` são opcionais em
/// vez de um enum etiquetado — o arquivo existente precisa continuar valendo.
///
/// `Debug` é manual e redige os valores de `env`, que são credenciais que o
/// usuário escreveu para o servidor. `Serialize` fica derivado de propósito: ele
/// existe para regravar o arquivo, onde os valores precisam sair inteiros — o
/// que não pode é um `{:?}` num log despejá-los.
#[derive(Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ServerConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    /// Desabilitado sem precisar remover a entrada.
    #[serde(default)]
    pub disabled: bool,
}

impl std::fmt::Debug for ServerConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // As chaves ficam: uma variável nova é informação de depuração legítima,
        // e é o que o pedido de consentimento também mostra.
        let env: Vec<&str> = self.env.keys().map(String::as_str).collect();
        f.debug_struct("ServerConfig")
            .field("command", &self.command)
            .field("url", &self.url)
            .field("args", &self.args)
            .field("env", &env)
            .field("disabled", &self.disabled)
            .finish()
    }
}

/// Como um servidor deve ser alcançado.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Endpoint {
    /// Processo filho falando por stdio.
    Stdio {
        command: String,
        args: Vec<String>,
        env: BTreeMap<String, String>,
    },
    /// Servidor remoto falando Streamable HTTP.
    Http { url: String },
}

impl ServerConfig {
    /// Decide como alcançar o servidor.
    ///
    /// Uma entrada sem `command` nem `url` não descreve servidor nenhum, e
    /// tratá-la como stdio com comando vazio produziria um erro de `spawn`
    /// confuso em vez de dizer o que está faltando.
    ///
    /// A `url` é validada aqui e não no uso: ela vem de um arquivo do
    /// repositório clonado, e o erro precisa nomear o servidor enquanto ainda se
    /// sabe qual é.
    pub fn endpoint(&self) -> Result<Endpoint, String> {
        match (&self.command, &self.url) {
            (Some(command), None) => Ok(Endpoint::Stdio {
                command: command.clone(),
                args: self.args.clone(),
                env: self.env.clone(),
            }),
            (None, Some(url)) => {
                nycode_ai::refuse_plaintext_outside_loopback(url)
                    .map_err(|err| format!("{err}"))?;
                Ok(Endpoint::Http { url: url.clone() })
            }
            (Some(_), Some(_)) => {
                Err("declara `command` e `url` ao mesmo tempo; escolha um".to_owned())
            }
            (None, None) => Err("nao declara `command` nem `url`".to_owned()),
        }
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
struct ConfigFile {
    /// A chave no wire é `mcpServers`, que é como os outros harnesses gravam.
    /// O alias cobre a variante curta.
    #[serde(default, rename = "mcpServers", alias = "servers")]
    mcp_servers: BTreeMap<String, ServerConfig>,
}

/// Servidores declarados no workspace, por nome.
///
/// Um arquivo malformado é ignorado com aviso: derrubar a sessão porque um
/// servidor opcional está mal configurado troca uma degradação por uma falha.
#[must_use]
pub fn discover(root: &Path) -> BTreeMap<String, ServerConfig> {
    let mut servers = BTreeMap::new();

    for relative in CONFIG_FILES {
        let path = root.join(relative);
        let Ok(contents) = std::fs::read_to_string(&path) else {
            continue;
        };
        match serde_json::from_str::<ConfigFile>(&contents) {
            Ok(parsed) => servers.extend(parsed.mcp_servers),
            Err(err) => {
                tracing::warn!(path = %path.display(), %err, "configuracao MCP invalida, ignorada");
            }
        }
    }

    servers.retain(|_, config| !config.disabled);
    servers
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
    fn reads_the_conventional_mcp_json_shape() {
        let dir = tempfile::tempdir().unwrap();
        write(
            dir.path(),
            ".mcp.json",
            r#"{"mcpServers":{"docs":{"command":"npx","args":["-y","srv"],"env":{"TOKEN":"x"}}}}"#,
        );

        let servers = discover(dir.path());
        let docs = &servers["docs"];
        assert_eq!(docs.command.as_deref(), Some("npx"));
        assert_eq!(docs.args, vec!["-y", "srv"]);
        assert_eq!(docs.env["TOKEN"], "x");
        assert!(!docs.disabled);
    }

    #[test]
    fn a_debug_view_of_a_server_config_never_contains_its_tokens() {
        // O `env` do `.mcp.json` carrega credencial que o usuario escreveu para
        // o servidor. As chaves sao informacao de depuracao legitima; os valores
        // nao tem por que aparecer em log nenhum.
        let config = ServerConfig {
            command: Some("npx".to_owned()),
            env: BTreeMap::from([("TOKEN".to_owned(), "valor-sensivel".to_owned())]),
            ..ServerConfig::default()
        };
        let rendered = format!("{config:?}");

        assert!(!rendered.contains("valor-sensivel"), "{rendered}");
        assert!(rendered.contains("TOKEN"), "{rendered}");
        assert!(rendered.contains("npx"), "{rendered}");
    }

    #[test]
    fn the_serialized_form_still_carries_the_values_the_file_needs() {
        // `Serialize` existe para regravar o arquivo, onde o valor precisa sair
        // inteiro. Redigi-lo ali corromperia a configuracao do usuario.
        let config = ServerConfig {
            command: Some("npx".to_owned()),
            env: BTreeMap::from([("TOKEN".to_owned(), "valor-sensivel".to_owned())]),
            ..ServerConfig::default()
        };
        let json = serde_json::to_string(&config).unwrap();

        assert!(json.contains("valor-sensivel"), "{json}");
    }

    #[test]
    fn the_servers_alias_is_accepted_too() {
        // Nem todo harness usa a mesma chave; recusar uma configuracao valida
        // por causa do nome do campo seria atrito sem motivo.
        let dir = tempfile::tempdir().unwrap();
        write(
            dir.path(),
            ".mcp.json",
            r#"{"servers":{"a":{"command":"echo"}}}"#,
        );
        assert!(discover(dir.path()).contains_key("a"));
    }

    #[test]
    fn project_scope_overrides_the_broader_one() {
        let dir = tempfile::tempdir().unwrap();
        write(
            dir.path(),
            ".mcp.json",
            r#"{"mcpServers":{"a":{"command":"antigo"}}}"#,
        );
        write(
            dir.path(),
            ".nycode/mcp.json",
            r#"{"mcpServers":{"a":{"command":"novo"}}}"#,
        );

        assert_eq!(discover(dir.path())["a"].command.as_deref(), Some("novo"));
    }

    #[test]
    fn a_disabled_server_is_not_returned() {
        let dir = tempfile::tempdir().unwrap();
        write(
            dir.path(),
            ".mcp.json",
            r#"{"mcpServers":{"a":{"command":"x","disabled":true},"b":{"command":"y"}}}"#,
        );
        let servers = discover(dir.path());
        assert!(!servers.contains_key("a"));
        assert!(servers.contains_key("b"));
    }

    #[test]
    fn a_malformed_file_degrades_instead_of_failing_the_session() {
        // Derrubar a sessao porque um servidor opcional esta mal configurado
        // troca uma degradacao por uma falha.
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), ".mcp.json", "{isto nao e json");
        write(
            dir.path(),
            ".nycode/mcp.json",
            r#"{"mcpServers":{"bom":{"command":"x"}}}"#,
        );

        let servers = discover(dir.path());
        assert_eq!(servers.len(), 1);
        assert!(servers.contains_key("bom"));
    }

    #[test]
    fn a_workspace_without_configuration_declares_no_servers() {
        let dir = tempfile::tempdir().unwrap();
        assert!(discover(dir.path()).is_empty());
    }

    #[test]
    fn args_and_env_default_to_empty() {
        let dir = tempfile::tempdir().unwrap();
        write(
            dir.path(),
            ".mcp.json",
            r#"{"mcpServers":{"a":{"command":"x"}}}"#,
        );

        let a = &discover(dir.path())["a"];
        assert!(a.args.is_empty());
        assert!(a.env.is_empty());
    }

    #[test]
    fn a_command_entry_is_reached_over_stdio() {
        let config = ServerConfig {
            command: Some("npx".to_owned()),
            args: vec!["-y".to_owned()],
            ..ServerConfig::default()
        };
        assert_eq!(
            config.endpoint().unwrap(),
            Endpoint::Stdio {
                command: "npx".to_owned(),
                args: vec!["-y".to_owned()],
                env: BTreeMap::new(),
            }
        );
    }

    #[test]
    fn a_url_entry_is_reached_over_http() {
        let config = ServerConfig {
            url: Some("https://exemplo/mcp".to_owned()),
            ..ServerConfig::default()
        };
        assert_eq!(
            config.endpoint().unwrap(),
            Endpoint::Http {
                url: "https://exemplo/mcp".to_owned()
            }
        );
    }

    #[test]
    fn a_repository_that_points_the_server_at_plaintext_off_machine_is_refused() {
        // O `.mcp.json` vem do diretorio clonado. Sem esta recusa, um repositorio
        // hostil aponta o servidor para um host proprio e le em texto claro tudo
        // o que a sessao mandar ao "servidor MCP".
        let config = ServerConfig {
            url: Some("http://coletor.exemplo.com/mcp".to_owned()),
            ..ServerConfig::default()
        };
        let err = config.endpoint().expect_err("deveria recusar");
        assert!(err.contains("texto claro fora de loopback"), "{err}");
    }

    #[test]
    fn a_server_on_the_local_machine_still_works_without_tls() {
        // Servidor MCP local por HTTP e a forma comum de desenvolver um.
        let config = ServerConfig {
            url: Some("http://127.0.0.1:3000/mcp".to_owned()),
            ..ServerConfig::default()
        };
        assert!(config.endpoint().is_ok());
    }

    #[test]
    fn an_entry_that_names_no_way_to_reach_the_server_says_so() {
        // Tratar como stdio com comando vazio produziria um erro de `spawn`
        // que nao diz o que esta faltando.
        let err = ServerConfig::default().endpoint().unwrap_err();
        assert!(err.contains("command"), "{err}");
        assert!(err.contains("url"), "{err}");
    }

    #[test]
    fn an_entry_that_names_both_ways_is_refused_instead_of_guessed() {
        let config = ServerConfig {
            command: Some("x".to_owned()),
            url: Some("https://exemplo".to_owned()),
            ..ServerConfig::default()
        };
        assert!(config.endpoint().unwrap_err().contains("ao mesmo tempo"));
    }

    #[test]
    fn an_http_entry_round_trips_through_the_config_file() {
        let dir = tempfile::tempdir().unwrap();
        write(
            dir.path(),
            ".mcp.json",
            r#"{"mcpServers":{"remoto":{"url":"https://exemplo/mcp"}}}"#,
        );
        let servers = discover(dir.path());
        assert_eq!(
            servers["remoto"].endpoint().unwrap(),
            Endpoint::Http {
                url: "https://exemplo/mcp".to_owned()
            }
        );
    }

    #[test]
    fn server_order_is_deterministic() {
        // Sem ordem estavel o catalogo de ferramentas muda entre execucoes e
        // invalida o cache de prompt do backend sem nenhum ganho.
        let dir = tempfile::tempdir().unwrap();
        write(
            dir.path(),
            ".mcp.json",
            r#"{"mcpServers":{"zeta":{"command":"z"},"alfa":{"command":"a"}}}"#,
        );
        let names: Vec<_> = discover(dir.path()).into_keys().collect();
        assert_eq!(names, vec!["alfa", "zeta"]);
    }
}
