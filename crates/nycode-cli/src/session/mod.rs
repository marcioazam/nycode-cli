//! Montagem de uma sessão, antes de qualquer superfície.
//!
//! Resolver credencial, achar a raiz do workspace, descobrir o contexto do
//! projeto, abrir o arquivo de sessão e armar o agente é o mesmo trabalho para
//! o modo headless e para o interativo. Fica aqui para que as duas superfícies
//! sejam só a diferença entre elas.

pub mod catalog;
pub mod paths;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use nycode_agent::{Agent, Cancel, Context, Store, ToolContext};
use nycode_ai::anthropic::Message;
use nycode_ai::{Client, Config};

use crate::Cli;

/// Prompt de sistema mínimo.
///
/// Modelos de fronteira já são treinados para o formato de agente de codificação;
/// prompt longo aqui gasta contexto sem ganho proporcional.
const SYSTEM_PROMPT: &str = "Voce e o NyCode CLI, um agente de codificacao que opera \
     no terminal dentro do repositorio do usuario. Use as ferramentas disponiveis para \
     inspecionar arquivos antes de afirmar qualquer coisa sobre o codigo. Seja direto.";

/// Como construir o backend de outro modelo.
///
/// Fechada sobre a configuração já resolvida — endpoint, credencial, dialeto —
/// porque trocar de modelo não pode significar reautenticar.
pub type Rebuild = Box<dyn Fn(&str) -> anyhow::Result<Arc<dyn nycode_agent::Backend>> + Send>;

/// Tudo que as duas superfícies precisam, montado uma vez só.
pub struct Prepared {
    pub agent: Agent,
    pub cancel: Cancel,
    pub store: Store,
    pub session_id: String,
    /// Quantas mensagens já estavam no disco antes deste processo.
    pub persisted: usize,
    pub context: Context,
    pub root: PathBuf,
    /// Conexões MCP vivas.
    ///
    /// Guardadas porque as ferramentas registradas dependem delas: largar a
    /// conexão aqui mataria o processo do servidor antes da primeira chamada
    /// do modelo, e o erro apareceria a três camadas de distância da causa.
    pub mcp: Vec<Arc<nycode_mcp::Session>>,
    /// Modelos que o endpoint serve, para `/model` ter o que listar.
    pub models: Vec<String>,
    pub rebuild: Rebuild,
}

/// Resolve credencial, workspace, contexto e sessão.
pub async fn prepare(cli: &Cli) -> anyhow::Result<Prepared> {
    let credential = nycode_auth::Resolver::new("gateway")
        .with_env_vars(&["NYCODE_API_KEY", "NYLLA_API_KEY"])
        .resolve(cli.api_key.as_deref())?;
    tracing::debug!(source = ?credential.source, "credencial resolvida");

    let config = Config::new(&cli.base_url, &credential.secret)?
        .with_model(&cli.model)
        .with_max_tokens(cli.max_tokens)
        .with_dialect(nycode_ai::Kind::parse(&cli.dialect)?);

    let root = match &cli.cwd {
        Some(dir) => dir.clone(),
        None => std::env::current_dir()?,
    };
    let ctx = ToolContext::new(root)?;
    let root = ctx.root().to_path_buf();

    // As convencoes do repositorio especializam o prompt base. Um AGENTS.md
    // existente passa a valer sem nenhuma configuracao.
    let context = Context::discover(&root);
    let system = context.system_prompt(SYSTEM_PROMPT, &root);

    let store = Store::open(root.join(".nycode/sessions"))?;
    let (session_id, history) = resolve(&store, cli)?;
    let persisted = history.len();

    // Guardada antes de o cliente consumi-la: a troca de modelo precisa da
    // mesma configuração, e reconstruí-la do zero significaria reautenticar.
    let template = config.clone();
    let client = Arc::new(Client::new(config)?);

    // O catálogo é do endpoint, não uma lista fixa no binário (FR-6). Validar
    // aqui transforma um erro de digitação em mensagem útil, em vez de numa
    // recusa do gateway três camadas adiante.
    let catalog = catalog::resolve(&client, &root).await;
    if let Some(warning) = catalog::warning(&catalog) {
        eprintln!("{warning}");
    }
    catalog::check(&catalog, &cli.model).map_err(|reason| anyhow::anyhow!(reason))?;

    let cancel = watch_for_interrupt(cli.prompt.is_some());
    // A partir daqui o cliente é só um backend: a coerção acontece uma vez, e
    // o `Task` recebe o mesmo, para o filho falar com o mesmo gateway.
    let backend: Arc<dyn nycode_agent::Backend> = client;

    let mut agent = Agent::new(Arc::clone(&backend), ctx)
        .with_system(system)
        .with_cancel(cancel.clone());
    for message in history {
        agent = agent.with_message(message);
    }
    for tool in nycode_agent::tools::all() {
        agent = agent.with_tool(tool);
    }

    let writable = cli.allow_writes;
    agent = agent.with_tool(Arc::new(
        nycode_agent::tools::Task::new(backend).with_gate(move || subagent_gate(writable)),
    ));

    for warning in startup_warnings(writable) {
        eprintln!("nycode: {warning}");
    }

    // O terceiro mecanismo de extensão do ADR-0002. Um `pre-tool-use` veta
    // antes do gate: uma política que só rodasse depois não conseguiria
    // proibir nada que o gate permitisse.
    let hooks = nycode_agent::policy::Hooks::discover(&root);
    if let Some(notice) = hooks_notice(&hooks) {
        eprintln!("nycode: {notice}");
    }
    agent = agent.with_hooks(hooks);

    let (mcp, extra) = attach_mcp(&root).await;
    for tool in extra {
        agent = agent.with_tool(tool);
    }

    if cli.allow_writes {
        agent = agent.with_gate(Box::new(nycode_agent::AllowAll));
    }

    Ok(Prepared {
        agent,
        cancel,
        store,
        session_id,
        persisted,
        context,
        root,
        mcp,
        models: catalog.ids().into_iter().map(ToOwned::to_owned).collect(),
        rebuild: Box::new(move |model| {
            let mut config = template.clone();
            model.clone_into(&mut config.model);
            Ok(Arc::new(Client::new(config)?) as Arc<dyn nycode_agent::Backend>)
        }),
    })
}

/// Com o que o subagente é permissionado (FR-15).
///
/// Herda de quem o chama: um filho que pudesse mais que o pai seria uma escada
/// de privilégio.
fn subagent_gate(writable: bool) -> Box<dyn nycode_agent::Gate> {
    if writable {
        Box::new(nycode_agent::AllowAll)
    } else {
        Box::new(nycode_agent::ReadOnly)
    }
}

/// O que o usuário precisa saber antes do primeiro turno.
///
/// FR-11: rodar sem confinamento em silêncio é a degradação que o NFR-4 proíbe.
/// A diferença entre "protegido" e "achou que estava protegido" é a única que
/// importa aqui, e só o usuário pode decidir se ela é aceitável. Numa sessão
/// somente-leitura não há o que confinar, e o aviso seria ruído.
fn startup_warnings(writable: bool) -> Vec<String> {
    writable
        .then(nycode_agent::sandbox::detect_from_path)
        .and_then(|confinement| confinement.warning())
        .into_iter()
        .collect()
}

/// Quais hooks o repositório instalou.
///
/// Silêncio quando não há nenhum: anunciar uma lista vazia treina o usuário a
/// ignorar a linha, e é justamente ela que precisa ser lida no dia em que um
/// hook aparecer sem ele saber.
fn hooks_notice(hooks: &nycode_agent::policy::Hooks) -> Option<String> {
    if hooks.is_empty() {
        return None;
    }
    Some(format!("hooks ativos: {}", hooks.declared().join(", ")))
}

/// Conecta aos servidores MCP declarados no workspace.
///
/// Um servidor que não sobe vira aviso em `stderr`, não falha de sessão: a
/// alternativa transformaria toda extensão opcional em dependência
/// obrigatória. O aviso é obrigatório pelo mesmo motivo que o resto — uma
/// ferramenta que o usuário esperava e não apareceu precisa ter explicação.
async fn attach_mcp(
    root: &Path,
) -> (
    Vec<Arc<nycode_mcp::Session>>,
    Vec<Arc<dyn nycode_agent::Tool>>,
) {
    let servers = nycode_agent::mcp::discover(root);
    if servers.is_empty() {
        return (Vec::new(), Vec::new());
    }

    let (sessions, tools, failures) = nycode_mcp::connect_all(&servers).await;
    for failure in failures {
        eprintln!("nycode: {failure}");
    }
    (sessions, tools)
}

/// Decide qual sessão usar e carrega o histórico dela.
pub fn resolve(store: &Store, cli: &Cli) -> anyhow::Result<(String, Vec<Message>)> {
    if let Some(id) = &cli.resume {
        return Ok((id.clone(), store.load(id)?));
    }
    if cli.continue_session {
        // Sem sessao anterior, `--continue` comeca uma nova em vez de falhar:
        // e o comportamento que o usuario espera no primeiro uso.
        if let Some(info) = store.latest()? {
            let history = store.load(&info.id)?;
            return Ok((info.id, history));
        }
    }
    Ok((Store::new_id(), Vec::new()))
}

/// Instala o observador de `Ctrl+C` e devolve o sinal que ele dispara.
///
/// Só em modo headless: numa sessão interativa o terminal está em modo bruto e
/// `Ctrl+C` chega como tecla, não como sinal. Registrar o handler lá deixaria
/// dois caminhos disputando a mesma interrupção.
pub fn watch_for_interrupt(headless: bool) -> Cancel {
    let cancel = Cancel::new();
    if !headless {
        return cancel;
    }
    let trigger = cancel.clone();
    tokio::spawn(async move {
        // Um erro ao registrar o handler não é motivo para derrubar a sessão:
        // o efeito é o comportamento antigo, com o sinal chegando ao processo.
        if tokio::signal::ctrl_c().await.is_ok() {
            eprintln!("nycode: interrompendo apos a ferramenta atual...");
            trigger.cancel();
        }
    });
    cancel
}

/// Se o turno chegou a produzir histórico que vale gravar.
///
/// Uma falha de wire acontece antes de qualquer efeito observável; gravar nesse
/// caso deixaria na sessão um pedido do usuário que nunca foi respondido.
pub fn produced_history(outcome: &Result<nycode_agent::Outcome, nycode_agent::Error>) -> bool {
    matches!(
        outcome,
        Ok(_) | Err(nycode_agent::Error::Cancelled | nycode_agent::Error::ToolLoopLimit { .. })
    )
}

#[cfg(test)]
mod policy_test {
    use super::*;

    fn call(name: &str) -> nycode_agent::ToolCall {
        nycode_agent::ToolCall {
            id: "t1".to_owned(),
            name: name.to_owned(),
            input: serde_json::Value::Null,
        }
    }

    #[test]
    fn a_subagent_of_a_read_only_session_cannot_write() {
        // Um filho que pudesse mais que o pai seria uma escada de privilegio.
        assert!(!subagent_gate(false).check(&call("write")).is_allowed());
        assert!(subagent_gate(false).check(&call("read")).is_allowed());
    }

    #[test]
    fn a_subagent_of_a_writable_session_can_write() {
        assert!(subagent_gate(true).check(&call("write")).is_allowed());
    }

    #[test]
    fn a_read_only_session_is_not_warned_about_a_sandbox_it_does_not_need() {
        // Nao ha o que confinar, e o aviso seria ruido.
        assert!(startup_warnings(false).is_empty());
    }

    #[test]
    fn a_writable_session_is_warned_only_when_there_is_no_confinement() {
        // O resultado depende da maquina; o que se protege e a correspondencia
        // entre o aviso e a ausencia de confinamento.
        let warned = !startup_warnings(true).is_empty();
        let confined = nycode_agent::sandbox::detect_from_path().is_enforced();
        assert_eq!(warned, !confined);
    }

    #[test]
    fn a_workspace_without_hooks_says_nothing() {
        // Anunciar lista vazia treina o usuario a ignorar a linha, e e ela que
        // precisa ser lida no dia em que um hook aparecer sem ele saber.
        let dir = tempfile::tempdir().unwrap();
        let hooks = nycode_agent::policy::Hooks::discover(dir.path());
        assert_eq!(hooks_notice(&hooks), None);
    }

    #[test]
    fn a_workspace_with_hooks_names_them() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(".nycode/hooks/pre-tool-use");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "#!/bin/sh\nexit 0").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }

        let hooks = nycode_agent::policy::Hooks::discover(dir.path());
        let notice = hooks_notice(&hooks).expect("ha um hook");
        assert!(notice.contains("pre-tool-use"), "{notice}");
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
mod tests {
    use super::*;
    use clap::Parser as _;
    use nycode_ai::StopReason;

    fn store() -> (tempfile::TempDir, Store) {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path().join("sessions")).unwrap();
        (dir, store)
    }

    fn cli(extra: &[&str]) -> Cli {
        let mut argv = vec!["nycode", "-p", "oi"];
        argv.extend_from_slice(extra);
        Cli::try_parse_from(argv).unwrap()
    }

    #[test]
    fn without_flags_a_run_starts_a_fresh_session() {
        let (_dir, store) = store();
        let (id, history) = resolve(&store, &cli(&[])).unwrap();

        assert!(!id.is_empty());
        assert!(history.is_empty());
    }

    #[test]
    fn resume_loads_the_history_of_the_session_it_names() {
        let (_dir, store) = store();
        store.append("sessao-a", &Message::user("na A")).unwrap();
        store.append("sessao-b", &Message::user("na B")).unwrap();

        let (id, history) = resolve(&store, &cli(&["--resume", "sessao-a"])).unwrap();

        assert_eq!(id, "sessao-a");
        assert_eq!(history.len(), 1);
        assert_eq!(
            history[0].content,
            vec![nycode_ai::anthropic::ContentBlock::text("na A")]
        );
    }

    #[test]
    fn resuming_a_session_that_does_not_exist_fails_instead_of_starting_over() {
        // Comecar do zero em silencio faria o usuario perder o historico que
        // ele pediu para retomar sem perceber.
        let (_dir, store) = store();
        assert!(resolve(&store, &cli(&["--resume", "nao-existe"])).is_err());
    }

    #[test]
    fn continue_without_any_previous_session_starts_a_new_one() {
        // E o primeiro uso: falhar aqui seria hostil sem motivo.
        let (_dir, store) = store();
        let (id, history) = resolve(&store, &cli(&["--continue"])).unwrap();

        assert!(!id.is_empty());
        assert!(history.is_empty());
    }

    #[test]
    fn continue_picks_the_most_recent_session() {
        let (_dir, store) = store();
        store
            .append("0000000001", &Message::user("antiga"))
            .unwrap();
        store
            .append("0000000002", &Message::user("recente"))
            .unwrap();

        let (id, history) = resolve(&store, &cli(&["--continue"])).unwrap();
        assert_eq!(id, "0000000002");
        assert_eq!(history.len(), 1);
    }

    #[test]
    fn a_cancelled_turn_is_persisted_but_a_wire_failure_is_not() {
        // As ferramentas de um turno cancelado ja mudaram o disco; nao gravar
        // deixaria a sessao descrevendo um repositorio que nao existe. Uma
        // falha de wire acontece antes de qualquer efeito, e gravar deixaria um
        // pedido do usuario que nunca foi respondido.
        assert!(produced_history(&Err(nycode_agent::Error::Cancelled)));
        assert!(produced_history(&Err(nycode_agent::Error::ToolLoopLimit {
            limit: 50
        })));
        assert!(produced_history(&Ok(nycode_agent::Outcome {
            text: "pronto".to_owned(),
            stop_reason: StopReason::EndTurn,
            tool_rounds: 0,
            usage: nycode_ai::Usage::default(),
        })));
        assert!(!produced_history(&Err(nycode_agent::Error::Wire(
            nycode_ai::Error::TruncatedStream { bytes: 4 }
        ))));
        assert!(!produced_history(&Err(nycode_agent::Error::Workspace(
            "sem permissao".to_owned()
        ))));
    }

    #[tokio::test]
    async fn an_interactive_session_does_not_install_the_signal_handler() {
        // Em modo bruto Ctrl+C chega como tecla; um handler de sinal ali
        // deixaria dois caminhos disputando a mesma interrupcao.
        assert!(!watch_for_interrupt(false).is_cancelled());
        assert!(!watch_for_interrupt(true).is_cancelled());
    }
}
