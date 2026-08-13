//! Estabelecer a conexão com um servidor MCP.
//!
//! Separado da conversa em si porque muda por outros motivos: aqui o que varia
//! é transporte, arranque e degradação por servidor; lá é o formato do
//! resultado de uma chamada.

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Arc;

use nycode_agent::Tool;
use nycode_agent::mcp::{Endpoint, McpTool, ServerConfig, Transport};
use rmcp::ServiceExt;
use rmcp::service::RoleClient;
use rmcp::transport::{StreamableHttpClientTransport, TokioChildProcess};
use serde_json::Value;

use super::{Connected, Session, Timeouts};
use crate::error::Error;

/// Conecta a um servidor e devolve as ferramentas que ele expõe.
pub async fn connect(name: &str, config: &ServerConfig, root: &Path) -> Result<Connected, Error> {
    connect_within(name, config, root, Timeouts::default()).await
}

/// O mesmo que [`connect`], com os prazos escolhidos.
///
/// Os prazos são parâmetro para que o teste do estouro custe milissegundos em
/// vez dos vinte segundos do padrão.
pub async fn connect_within(
    name: &str,
    config: &ServerConfig,
    root: &Path,
    timeouts: Timeouts,
) -> Result<Connected, Error> {
    let endpoint = config.endpoint().map_err(|reason| Error::Config {
        server: name.to_owned(),
        reason,
    })?;

    match endpoint {
        Endpoint::Stdio { command, args, env } => {
            let transport = TokioChildProcess::new(stdio_command(
                &command,
                &args,
                &env,
                &confinement_prefix(root),
            ))
            .map_err(|err| Error::Connect {
                server: name.to_owned(),
                reason: err.to_string(),
            })?;
            attach_within(name, transport, timeouts).await
        }
        Endpoint::Http { url } => {
            attach_within(name, StreamableHttpClientTransport::from_uri(url), timeouts).await
        }
    }
}

/// O prefixo de confinamento de um servidor stdio, para a raiz dada.
///
/// A política é a de cliente de rede
/// ([ADR-0017](../../../../docs/architecture/decisions/0017-duas-politicas-de-confinamento.md)):
/// o servidor alcança a API que é a razão de ele existir, e não escreve no
/// workspace, porque responde perguntas e não edita arquivo.
fn confinement_prefix(root: &Path) -> Vec<String> {
    nycode_agent::sandbox::prefix(
        &nycode_agent::sandbox::detect_from_path(),
        nycode_agent::sandbox::Policy::NetworkClient,
        root,
    )
}

/// Monta o comando do servidor stdio, com o confinamento e o ambiente dele.
///
/// O prefixo é parâmetro e não detectado aqui dentro para que o comportamento
/// de ambiente seja exercitável sem depender de `bwrap` estar instalado na
/// máquina de quem roda a suíte.
fn stdio_command(
    command: &str,
    args: &[String],
    env: &BTreeMap<String, String>,
    prefix: &[String],
) -> tokio::process::Command {
    let mut cmd = match prefix.split_first() {
        Some((wrapper, rest)) => {
            let mut cmd = tokio::process::Command::new(wrapper);
            cmd.args(rest).arg(command);
            cmd
        }
        // Sem confinamento o servidor sobe como sempre subiu, e o aviso da
        // sessão é o que diz isso ao usuário.
        None => tokio::process::Command::new(command),
    };
    cmd.args(args);
    // Um servidor declarado pelo repositório alcança a rede por construção;
    // herdar o ambiente do harness seria entregar a credencial a um processo
    // que o repositório escolheu. O que ele precisa além do mínimo está no
    // `.mcp.json`, que é onde a decisão fica visível para quem revisa.
    nycode_agent::policy::environment::clear(&mut cmd);
    // O declarado vem por último e vence: é o que o usuário escreveu.
    for (key, value) in env {
        cmd.env(key, value);
    }
    cmd
}

/// Faz o handshake e monta as ferramentas, seja qual for o transporte.
///
/// Genérica sobre o transporte porque é a única forma de exercitar o protocolo
/// de verdade num teste: um par de canais em memória fala MCP tão bem quanto um
/// processo filho, e sem depender de ter um servidor instalado na máquina.
pub async fn attach_within<T, E, A>(
    name: &str,
    transport: T,
    timeouts: Timeouts,
) -> Result<Connected, Error>
where
    T: rmcp::transport::IntoTransport<RoleClient, E, A>,
    E: std::error::Error + Send + Sync + 'static,
{
    let expired = |stage| Error::Timeout {
        server: name.to_owned(),
        stage,
        seconds: timeouts.connect.as_secs(),
    };

    let service = tokio::time::timeout(timeouts.connect, ().serve(transport))
        .await
        .map_err(|_| expired("o handshake"))?
        .map_err(|err| Error::Connect {
            server: name.to_owned(),
            reason: err.to_string(),
        })?;

    let session = Arc::new(Session {
        server: name.to_owned(),
        service,
        timeouts,
    });

    let listed = tokio::time::timeout(timeouts.connect, session.service.list_all_tools())
        .await
        .map_err(|_| expired("a listagem de ferramentas"))?
        .map_err(|err| Error::List {
            server: name.to_owned(),
            reason: err.to_string(),
        })?;

    let tools = listed
        .into_iter()
        .map(|tool| {
            let schema = Value::Object((*tool.input_schema).clone());
            Arc::new(McpTool::new(
                name,
                tool.name.to_string(),
                tool.description.unwrap_or_default().to_string(),
                schema,
                Arc::clone(&session) as Arc<dyn Transport>,
            )) as Arc<dyn Tool>
        })
        .collect();

    Ok((session, tools))
}

/// Conecta a todos os servidores declarados, degradando por servidor.
///
/// Um servidor que não sobe não derruba a sessão: o aviso vai para o log e os
/// outros seguem. É a mesma regra que a descoberta já aplica a um `.mcp.json`
/// malformado — trocar uma degradação por uma falha tornaria qualquer servidor
/// opcional em dependência obrigatória.
pub async fn connect_all(
    servers: &BTreeMap<String, ServerConfig>,
    root: &Path,
) -> (Vec<Arc<Session>>, Vec<Arc<dyn Tool>>, Vec<Error>) {
    let mut sessions = Vec::new();
    let mut tools = Vec::new();
    let mut failures = Vec::new();

    for (name, config) in servers {
        match connect(name, config, root).await {
            Ok((session, mut found)) => {
                sessions.push(session);
                tools.append(&mut found);
            }
            Err(err) => failures.push(err),
        }
    }

    (sessions, tools, failures)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(command: &str, args: &[&str]) -> ServerConfig {
        ServerConfig {
            command: Some(command.to_owned()),
            args: args.iter().map(|a| (*a).to_owned()).collect(),
            ..ServerConfig::default()
        }
    }

    /// `expect_err` exigiria `Debug` no lado `Ok`, e `dyn Tool` não tem.
    fn failure(result: Result<Connected, Error>) -> Error {
        match result {
            Err(err) => err,
            Ok(_) => panic!("esperava falha"),
        }
    }

    #[tokio::test]
    async fn a_server_does_not_inherit_the_harness_environment() {
        // O ambiente do harness carrega a chave do gateway, e um servidor
        // declarado pelo repositorio alcanca a rede por construcao: herda-la
        // seria entregar a credencial a um processo que o repositorio escolheu.
        //
        // A prova e comportamental de proposito. `Command` nao expoe se o
        // ambiente foi limpo — so o diff — entao inspecionar a struct passaria
        // com `env_clear` ausente.
        let out = stdio_command("printenv", &[], &BTreeMap::new(), &[])
            .output()
            .await
            .expect("printenv existe em qualquer unix");
        let vars = String::from_utf8_lossy(&out.stdout);

        // O cargo enche o ambiente do processo de teste com estas.
        assert!(!vars.contains("CARGO_PKG_NAME="), "{vars}");
        assert!(!vars.contains("CARGO_MANIFEST_DIR="), "{vars}");
        assert!(
            vars.contains("PATH="),
            "sem PATH o servidor nao seria encontrado: {vars}"
        );
    }

    #[tokio::test]
    async fn the_confinement_prefix_actually_wraps_the_declared_command() {
        // Sem isto a politica existiria, seria testada e nunca seria aplicada —
        // o defeito que este repositorio ja registrou uma vez, quando tres
        // requisitos estavam entregues por modulos que o binario nunca chamava.
        let out = stdio_command(
            "oi",
            &[],
            &BTreeMap::new(),
            &["echo".to_owned(), "envolvido".to_owned()],
        )
        .output()
        .await
        .expect("echo existe em qualquer unix");

        let saida = String::from_utf8_lossy(&out.stdout);
        assert!(saida.contains("envolvido oi"), "{saida}");
    }

    #[test]
    fn the_server_policy_is_the_one_that_reaches_the_network() {
        // A escolha da politica e uma linha so, e errar qual e delas trocaria
        // um servidor util por um servidor sem rede — ou o contrario, um
        // servidor com escrita no workspace que ninguem pediu.
        let argv = confinement_prefix(Path::new("/w")).join(" ");
        if argv.is_empty() {
            // Sem confinamento na maquina o prefixo e vazio, e o que se protege
            // e que ele seja vazio de verdade e nao um confinamento fingido.
            return;
        }
        assert!(!argv.contains("--unshare-net"), "{argv}");
        assert!(!argv.contains("--bind /w /w"), "{argv}");
    }

    #[tokio::test]
    async fn what_the_configuration_declares_reaches_the_server() {
        // Limpar o ambiente nao pode significar impedir o servidor de receber o
        // token que o usuario escreveu para ele.
        let declared = BTreeMap::from([("TOKEN_DECLARADO".to_owned(), "valor".to_owned())]);
        let out = stdio_command("printenv", &[], &declared, &[])
            .output()
            .await
            .expect("printenv existe em qualquer unix");
        let vars = String::from_utf8_lossy(&out.stdout);

        assert!(vars.contains("TOKEN_DECLARADO=valor"), "{vars}");
    }

    #[tokio::test]
    async fn a_server_that_does_not_exist_names_itself_in_the_error() {
        let err = failure(
            connect(
                "fantasma",
                &config("nycode-nao-existe-mesmo", &[]),
                Path::new("."),
            )
            .await,
        );

        assert_eq!(err.server(), "fantasma");
        assert!(
            matches!(err, Error::Connect { .. }),
            "esperava falha de conexao, veio {err:?}"
        );
    }

    #[tokio::test]
    async fn an_entry_without_a_way_to_reach_the_server_fails_before_spawning() {
        let err = failure(connect("vazio", &ServerConfig::default(), Path::new(".")).await);
        assert!(matches!(err, Error::Config { .. }), "{err:?}");
    }

    #[tokio::test]
    async fn a_process_that_is_not_a_server_fails_instead_of_hanging() {
        // `true` sobe e sai sem falar o protocolo. Sem tratamento, o handshake
        // ficaria esperando para sempre uma resposta que nao vem.
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(20),
            connect("mudo", &config("true", &[]), Path::new(".")),
        )
        .await;

        assert!(result.is_ok(), "o handshake precisa terminar, nao pendurar");
        assert!(result.unwrap().is_err(), "um processo mudo nao e servidor");
    }

    #[tokio::test]
    async fn a_server_that_accepts_and_goes_silent_does_not_hang_the_startup() {
        // O processo mudo que sai na hora ja era tratado; este e o pior caso,
        // que aceita a conexao e nunca responde. Sem prazo, a abertura da
        // sessao espera para sempre, e em headless nao ha o que interromper.
        let (_guarda, canal) = crate::fakes::mute();
        let prazos = Timeouts {
            connect: std::time::Duration::from_millis(100),
            ..Timeouts::default()
        };

        let err = failure(attach_within("mudo", canal, prazos).await);

        assert_eq!(err.server(), "mudo");
        assert!(
            matches!(err, Error::Timeout { stage, .. } if stage.contains("handshake")),
            "esperava estouro de prazo no handshake, veio {err:?}"
        );
    }

    #[tokio::test]
    async fn one_broken_server_does_not_take_the_others_down() {
        // Um servidor opcional mal configurado nao pode virar dependencia
        // obrigatoria da sessao.
        let mut servers = BTreeMap::new();
        servers.insert(
            "quebrado".to_owned(),
            config("nycode-nao-existe-mesmo", &[]),
        );
        servers.insert("tambem-quebrado".to_owned(), ServerConfig::default());

        let (sessions, tools, failures) = connect_all(&servers, Path::new(".")).await;

        assert!(sessions.is_empty());
        assert!(tools.is_empty());
        assert_eq!(failures.len(), 2, "as duas falhas precisam ser reportadas");
    }

    #[tokio::test]
    async fn no_servers_declared_is_not_a_failure() {
        let (sessions, tools, failures) = connect_all(&BTreeMap::new(), Path::new(".")).await;
        assert!(sessions.is_empty());
        assert!(tools.is_empty());
        assert!(failures.is_empty());
    }

    #[tokio::test]
    async fn the_listed_tools_arrive_qualified_by_their_server() {
        // Dois servidores podem expor `search`. Sem qualificacao o segundo
        // sobrescreve o primeiro e o modelo chama o errado em silencio.
        let canal = crate::fakes::channel(crate::fakes::Fixture {
            reply: crate::fakes::Reply::Text("ok".to_owned()),
        });
        let (_session, tools) = attach_within("docs", canal, Timeouts::default())
            .await
            .expect("o handshake em memoria");

        let names: Vec<_> = tools.iter().map(|t| t.name().to_owned()).collect();
        assert_eq!(names, vec!["docs__search", "docs__ping"]);
    }

    #[tokio::test]
    async fn a_tool_keeps_the_schema_and_description_the_server_declared() {
        // O esquema e o que o modelo usa para montar a chamada; perde-lo faria
        // toda chamada chegar com argumentos invalidos.
        let canal = crate::fakes::channel(crate::fakes::Fixture {
            reply: crate::fakes::Reply::Text("ok".to_owned()),
        });
        let (_session, tools) = attach_within("docs", canal, Timeouts::default())
            .await
            .expect("o handshake em memoria");

        let search = &tools[0];
        assert_eq!(search.description(), "Busca na documentacao");
        let schema = search.input_schema();
        assert_eq!(schema["properties"]["q"]["type"], "string");
        assert_eq!(schema["required"][0], "q");

        // Sem descricao, o catalogo recebe vazio e nao a palavra `None`.
        assert_eq!(tools[1].description(), "");
    }
}
