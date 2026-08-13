//! Montagem de uma sessão, antes de qualquer superfície.
//!
//! Resolver credencial, achar a raiz do workspace, descobrir o contexto do
//! projeto, abrir o arquivo de sessão e armar o agente é o mesmo trabalho para
//! o modo headless e para o interativo. Fica aqui para que as duas superfícies
//! sejam só a diferença entre elas.

pub mod catalog;
mod consent;
pub mod paths;
pub mod phases;
pub mod settings;
pub mod tuning;
mod warnings;

pub use phases::Phases;

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
    /// Quanto cada etapa da montagem custou.
    pub phases: Phases,
    /// Os hooks, para o evento de fim de sessão.
    ///
    /// Guardados à parte porque o agente é dono dos seus e a superfície que
    /// encerra a sessão não é a que a montou: `session-end` precisa disparar
    /// depois de o último turno ter passado, e é fora do agente que isso se
    /// sabe.
    pub lifecycle: nycode_agent::policy::Hooks,
    pub agent: Agent,
    pub cancel: Cancel,
    pub store: Store,
    pub session_id: String,
    /// O modelo que a sessão resolveu, entre flag, arquivo e padrão.
    ///
    /// Vem daqui e não da invocação porque desde o FR-9 a flag pode estar
    /// ausente: quem lê `cli.model` vê `None` e mostraria o padrão embutido no
    /// lugar do que o arquivo escolheu.
    pub model: String,
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
    /// Tarifas por modelo, para os que o catálogo precifica.
    ///
    /// Um mapa e não um campo em `models` porque a ausência é o caso comum: a
    /// maioria dos endpoints declara identificador e janela, e não preço.
    pub prices: std::collections::BTreeMap<String, nycode_ai::catalog::Price>,
    /// Janela de contexto por modelo, para os que o catálogo dimensiona.
    ///
    /// Acompanha a troca de modelo pela mesma razão que a tarifa: comparar o
    /// usage do modelo novo contra o limite do antigo dá um número errado com
    /// a mesma cara de um certo.
    pub windows: std::collections::BTreeMap<String, u64>,
    pub rebuild: Rebuild,
}

/// Busca o catálogo do endpoint e confere que o modelo pedido existe nele.
///
/// O catálogo é do endpoint, não uma lista fixa no binário (FR-6). Conferir
/// aqui transforma um erro de digitação em mensagem útil, em vez de numa recusa
/// do gateway três camadas adiante.
async fn discover_catalog(
    client: &Arc<Client>,
    root: &std::path::Path,
    model: &str,
) -> anyhow::Result<catalog::Catalog> {
    let catalog = catalog::resolve(client, root).await;
    if let Some(warning) = catalog::warning(&catalog) {
        eprintln!("{warning}");
    }
    catalog::check(&catalog, model).map_err(|reason| anyhow::anyhow!(reason))?;
    Ok(catalog)
}

/// Descobre os hooks do repositório e retém só os que foram consentidos.
///
/// O terceiro mecanismo de extensão do ADR-0002. Um `pre-tool-use` veta antes
/// do gate: uma política que só rodasse depois não conseguiria proibir nada que
/// o gate permitisse. E pelo ADR-0016 um hook vem do repositório, roda a cada
/// chamada de ferramenta e recebe todo argumento e resultado — executá-lo sem
/// consentimento é entregar isso a quem escreveu o diretório.
async fn consented_hooks(root: &std::path::Path, interactive: bool) -> nycode_agent::policy::Hooks {
    let hooks = nycode_agent::policy::Hooks::discover(root);
    let hooks = hooks.clone().retaining(&consent::authorize(
        root,
        &hooks.declarations(),
        interactive,
    ));
    if let Some(notice) = warnings::hooks_notice(&hooks) {
        eprintln!("nycode: {notice}");
    }
    announce_start(&hooks, root).await;
    hooks
}

/// Resolve credencial, workspace, contexto e sessão.
pub async fn prepare(cli: &Cli) -> anyhow::Result<Prepared> {
    let mut phases = Phases::start();
    let credential = nycode_auth::Resolver::new("gateway")
        .with_env_vars(&["NYCODE_API_KEY", "NYLLA_API_KEY"])
        .with_file(cli.api_key_file.clone())
        .resolve(cli.api_key.as_deref())?;
    tracing::debug!(source = ?credential.source, "credencial resolvida");

    // Do usuário, nunca do workspace: um `.nycode/settings.json` do repositório
    // esticaria o próprio prazo e o próprio teto de turnos, que são os limites
    // que existem para contê-lo, e apontaria o provider para onde quisesse.
    let settings = settings::Settings::discover();
    let provider = settings::resolve(cli, &settings.provider);
    let config = Config::new(&provider.base_url, &credential.secret)?
        .with_model(&provider.model)
        .with_max_tokens(provider.max_tokens)
        .with_dialect(nycode_ai::Kind::parse(&provider.dialect)?);

    let root = match &cli.cwd {
        Some(dir) => dir.clone(),
        None => std::env::current_dir()?,
    };
    let ctx = ToolContext::new(root)?;
    let root = ctx.root().to_path_buf();
    phases.mark("credencial");

    // As convencoes do repositorio especializam o prompt base. Um AGENTS.md
    // existente passa a valer sem nenhuma configuracao.
    let context = Context::discover(&root);
    let system = context.system_prompt(SYSTEM_PROMPT, &root);
    phases.mark("workspace");

    let store = Store::open(root.join(".nycode/sessions"))?;
    let (session_id, history) = resolve(&store, cli)?;
    let persisted = history.len();
    phases.mark("sessao");

    // A chave amarra o cache do backend a esta sessão. Vem do id da sessão, e
    // não de um valor novo por processo: retomar com `--continue` precisa cair
    // no mesmo balde, senão o prefixo é reescrito e o NFR-7 se perde
    // exatamente na sessão longa, que é a que mais tem a ganhar.
    // Guardada antes de o cliente consumi-la: a troca de modelo precisa da
    // mesma configuração, e reconstruí-la do zero significaria reautenticar.
    let template = config.clone();
    let (client, sampling) = tuning::tuned_client(cli, &session_id, config, &provider.dialect)?;

    let catalog = discover_catalog(&client, &root, &provider.model).await?;
    phases.mark("catalogo");

    let cancel = watch_for_interrupt(cli.prompt.is_some());
    // A partir daqui o cliente é só um backend: a coerção acontece uma vez, e
    // o `Task` recebe o mesmo, para o filho falar com o mesmo gateway.
    let backend: Arc<dyn nycode_agent::Backend> = client;

    // A janela é do catálogo descoberto, nunca um padrão embutido: sem número
    // declarado o agente não compara nada, e é assim que ele evita acusar
    // truncamento silencioso num endpoint que só não publica o tamanho.
    let windows = tuning::windows_of(&catalog.models);
    let mut agent = Agent::new(Arc::clone(&backend), ctx)
        .with_system(system)
        .with_cancel(cancel.clone())
        .with_tool_limit(settings.tool_limit)
        .with_keep_recent(settings.keep_recent);
    if let Some(window) = windows.get(&provider.model).copied() {
        agent = agent.with_context_window(window);
    }
    for message in history {
        agent = agent.with_message(message);
    }
    for tool in nycode_agent::tools::all_within(settings.command_timeout) {
        agent = agent.with_tool(tool);
    }

    // O subagente herda a concessão do pai: um filho que pudesse mais que quem
    // o chamou seria uma escada de privilégio (FR-15).
    let grant = crate::invocation::grant::Grant::from_flags(cli.allow_writes, cli.allow_all);
    agent = agent.with_tool(Arc::new(
        nycode_agent::tools::Task::new(backend).with_gate(move || grant.gate()),
    ));

    for warning in
        warnings::startup_warnings(warnings::bash_is_reachable(grant, cli.prompt.is_none()))
    {
        eprintln!("nycode: {warning}");
    }

    let hooks = consented_hooks(&root, cli.prompt.is_none()).await;
    let lifecycle = hooks.clone();
    agent = agent.with_hooks(hooks);

    phases.mark("agente");

    let (mcp, extra) = attach_mcp(&root, cli.prompt.is_none()).await;
    for tool in extra {
        agent = agent.with_tool(tool);
    }
    phases.mark("mcp");

    agent = agent.with_gate(grant.gate());

    Ok(Prepared {
        phases,
        lifecycle,
        agent,
        cancel,
        store,
        session_id,
        model: provider.model,
        persisted,
        context,
        root,
        mcp,
        models: catalog.ids().into_iter().map(ToOwned::to_owned).collect(),
        prices: tuning::prices_of(&catalog.models),
        windows,
        rebuild: Box::new(move |model| {
            let mut config = template.clone();
            model.clone_into(&mut config.model);
            // A amostragem acompanha a troca de modelo. Sem isto, `/model`
            // devolveria uma sessao sem raciocinio e sem chave de cache, e o
            // usuario nao teria como saber que perdeu os dois.
            Ok(
                Arc::new(Client::new(config)?.with_sampling(sampling.clone()))
                    as Arc<dyn nycode_agent::Backend>,
            )
        }),
    })
}

/// Dispara o primeiro dos três eventos de hook que rodam.
///
/// Depois do consentimento e antes do primeiro turno: um `session-start` existe
/// para preparar o que a sessão vai usar, e rodá-lo depois de a sessão começar
/// seria rodá-lo tarde demais para isso. Um veto aqui não veta nada — o hook que
/// pode recusar é o de chamada de ferramenta, e o ADR-0009 é explícito de que os
/// de ciclo de vida observam.
async fn announce_start(hooks: &nycode_agent::policy::Hooks, root: &Path) {
    use nycode_agent::policy::hooks::{Event, Payload};

    hooks
        .fire(
            Event::SessionStart,
            &Payload::for_session(Event::SessionStart, root),
        )
        .await;
}

/// Conecta aos servidores MCP declarados no workspace.
///
/// Um servidor que não sobe vira aviso em `stderr`, não falha de sessão: a
/// alternativa transformaria toda extensão opcional em dependência
/// obrigatória. O aviso é obrigatório pelo mesmo motivo que o resto — uma
/// ferramenta que o usuário esperava e não apareceu precisa ter explicação.
async fn attach_mcp(
    root: &Path,
    interactive: bool,
) -> (
    Vec<Arc<nycode_mcp::Session>>,
    Vec<Arc<dyn nycode_agent::Tool>>,
) {
    let mut servers = nycode_agent::mcp::discover(root);
    if servers.is_empty() {
        return (Vec::new(), Vec::new());
    }

    // ADR-0016: o `.mcp.json` vem do repositório, e subir o que ele declara sem
    // consentimento é executar código de terceiro por ter aberto o diretório.
    let permitidos = consent::authorize(root, &consent::declarations_of(&servers), interactive);
    servers.retain(|name, _| permitidos.contains(name));
    if servers.is_empty() {
        return (Vec::new(), Vec::new());
    }

    let (sessions, tools, failures) = nycode_mcp::connect_all(&servers, root).await;
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

    #[tokio::test]
    async fn headless_refusal_leaves_the_mcp_catalog_empty_without_spawning() {
        // Sem interlocutor, uma declaração do repositório é negada e a sessão
        // segue sem ela (ADR-0016). O comando existe de propósito: usar um nome
        // inválido permitiria o teste passar porque o spawn falhou, e não
        // porque o consentimento veio antes dele.
        let root = tempfile::tempdir().unwrap();
        std::fs::write(
            root.path().join(".mcp.json"),
            r#"{"mcpServers":{"nao-confiado":{"command":"true"}}}"#,
        )
        .unwrap();

        let (sessions, tools) = attach_mcp(root.path(), false).await;

        assert!(sessions.is_empty());
        assert!(tools.is_empty());
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
    async fn a_workspace_without_servers_connects_to_nothing() {
        // O caminho comum, e o que precisa custar zero: descobrir que nao ha
        // `.mcp.json` nao pode gastar nada do orcamento de arranque.
        let dir = tempfile::tempdir().unwrap();
        let (sessions, tools) = attach_mcp(dir.path(), false).await;

        assert!(sessions.is_empty());
        assert!(tools.is_empty());
    }

    #[tokio::test]
    async fn a_declared_server_does_not_run_without_consent() {
        // ADR-0016: o `.mcp.json` vem do repositorio, e subir o que ele declara
        // sem consentimento e executar codigo de terceiro por ter aberto o
        // diretorio. Sem interlocutor a resposta e nao, e a sessao segue.
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join(".mcp.json"),
            r#"{"mcpServers":{"docs":{"command":"nao-existe-mesmo"}}}"#,
        )
        .unwrap();

        let (sessions, tools) = attach_mcp(dir.path(), false).await;

        assert!(sessions.is_empty(), "nada foi autorizado a subir");
        assert!(tools.is_empty());
    }

    #[tokio::test]
    async fn an_interactive_session_does_not_install_the_signal_handler() {
        // Em modo bruto Ctrl+C chega como tecla; um handler de sinal ali
        // deixaria dois caminhos disputando a mesma interrupcao.
        assert!(!watch_for_interrupt(false).is_cancelled());
        assert!(!watch_for_interrupt(true).is_cancelled());
    }
}
