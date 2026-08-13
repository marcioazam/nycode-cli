#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used, clippy::panic))]

//! Binário `nycode`.
//!
//! O runtime assíncrono só é construído depois que os argumentos são resolvidos:
//! `--version` e `--help` não pagam por ele. Isso é economia real, e não o que o
//! NFR-1 mede — ele orça a sessão montada, que é o que a rota `--probe-startup`
//! expõe ao gate (ADR-0013).

mod exit;
mod image;
mod interactive;
mod output;
mod route;
mod run;
mod screen;
mod session;

use std::process::ExitCode;
use std::time::Duration;

use clap::Parser;
use nycode_ai::Config;

use route::{Route, choose};

#[derive(Debug, Parser)]
#[command(
    name = "nycode",
    version,
    about = "Agente de codificacao em terminal, apontado para um nylla-gateway",
    disable_help_subcommand = true
)]
struct Cli {
    /// Executa um unico prompt e escreve a resposta em stdout.
    #[arg(short = 'p', long = "print", value_name = "PROMPT")]
    prompt: Option<String>,

    /// URL base do gateway, incluindo o prefixo de versao.
    #[arg(long, env = "NYCODE_BASE_URL", default_value = Config::DEFAULT_BASE_URL)]
    base_url: String,

    /// Chave de API do gateway.
    ///
    /// Ausente, e resolvida do ambiente e depois do cofre do sistema.
    #[arg(long, hide_env_values = true)]
    api_key: Option<String>,

    /// Formato de wire: anthropic-messages, openai-completions ou openai-responses.
    #[arg(long, env = "NYCODE_DIALECT", default_value = "anthropic-messages")]
    dialect: String,

    /// Modelo a usar.
    #[arg(long, env = "NYCODE_MODEL", default_value = Config::DEFAULT_MODEL)]
    model: String,

    /// Teto de tokens de saida por turno.
    #[arg(long, default_value_t = Config::DEFAULT_MAX_TOKENS)]
    max_tokens: u32,

    /// Diretorio de trabalho do agente.
    #[arg(long, value_name = "DIR")]
    cwd: Option<std::path::PathBuf>,

    /// Suprime o progresso de ferramentas em stderr.
    #[arg(short, long)]
    quiet: bool,

    /// Imagem a anexar ao pedido. Pode repetir.
    ///
    /// O arquivo é lido e embutido; o backend nunca busca nada por conta
    /// própria, o que mantém quem alcança a rede sob controle do operador.
    #[arg(short = 'i', long = "image", value_name = "ARQUIVO")]
    images: Vec<std::path::PathBuf>,

    /// Formato da resposta em modo headless.
    ///
    /// `json` publica um evento por linha em stdout — sequência de ferramentas,
    /// contabilidade de tokens e motivo de parada — para quem integra o
    /// binário em vez de ler a saída.
    #[arg(long, value_enum, default_value_t = output::Format::Text)]
    output_format: output::Format,

    /// Retoma a sessao mais recente deste workspace.
    ///
    /// O campo nao pode se chamar `continue`, que e palavra reservada, entao o
    /// nome longo e declarado explicitamente: derivar do campo produziria
    /// `--continue-session`, que nao e a interface documentada.
    #[arg(short = 'c', long = "continue")]
    continue_session: bool,

    /// Retoma uma sessao pelo identificador.
    #[arg(long, value_name = "ID")]
    resume: Option<String>,

    /// Permite que o agente escreva, edite e execute comandos.
    ///
    /// Sem esta flag a sessao e somente-leitura. Em modo headless nao ha a quem
    /// perguntar, entao a permissao precisa ser dada de antemao.
    #[arg(long)]
    allow_writes: bool,

    /// Monta a sessao, mantem-na ociosa por MS milissegundos e sai.
    ///
    /// O NFR-1 e o NFR-2 orcam a sessao montada, e nenhuma outra superficie
    /// para nesse ponto: o modo headless segue para o turno e o interativo toma
    /// posse do terminal. Sem esta rota o gate so alcanca `--version`, que o
    /// `clap` resolve antes do runtime, da credencial e do disco.
    ///
    /// A ociosidade e parametro porque as duas medicoes querem coisas opostas:
    /// a latencia quer sair assim que a sessao fica pronta, e o pico de memoria
    /// quer esperar o runtime e as conexoes MCP assentarem.
    #[arg(long, value_name = "MS", num_args = 0..=1, default_missing_value = "0")]
    probe_startup: Option<u64>,
}

fn main() -> ExitCode {
    let cli = Cli::parse();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_env("NYCODE_LOG")
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("warn")),
        )
        .with_writer(std::io::stderr)
        .init();

    // O runtime so e construido aqui: um `--version` nao paga por ele.
    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(err) => {
            eprintln!("nycode: nao foi possivel iniciar o runtime: {err}");
            return ExitCode::FAILURE;
        }
    };

    let has_terminal = std::io::IsTerminal::is_terminal(&std::io::stdin());
    match runtime.block_on(run(&cli, has_terminal)) {
        Ok(code) => code,
        Err(err) => {
            eprintln!("nycode: {err}");
            ExitCode::FAILURE
        }
    }
}

/// Despacha para a superfície escolhida.
///
/// `has_terminal` é parâmetro e não leitura direta de `stdin` para que os dois
/// caminhos sejam exercitáveis num teste, que roda com ou sem TTY conforme quem
/// o invocou.
async fn run(cli: &Cli, has_terminal: bool) -> anyhow::Result<ExitCode> {
    match choose(cli.probe_startup, cli.prompt.clone(), has_terminal) {
        Route::Headless(prompt) => run::headless(cli, session::prepare(cli).await?, &prompt).await,
        Route::Interactive => interactive_session(cli, session::prepare(cli).await?).await,
        Route::Probe(idle) => Ok(probe_startup(session::prepare(cli).await?, idle)),
        Route::NoTerminal => {
            eprintln!(
                "nycode: a sessao interativa precisa de um terminal; use -p \"<prompt>\" para modo headless"
            );
            Ok(ExitCode::from(exit::NO_TERMINAL))
        }
    }
}

/// Toma posse do terminal e devolve antes de sair (FR-1).
///
/// Mora ao lado de `main` porque modo bruto é estado global do processo: a
/// restauração precisa acontecer no caminho de saída, e enterrá-la num módulo
/// deixaria o dono do processo sem controle sobre ela. Tudo que a sessão faz
/// vive em [`run::drive`], que roda contra uma superfície de mentira.
async fn interactive_session(cli: &Cli, prepared: session::Prepared) -> anyhow::Result<ExitCode> {
    let (mut raw, mut surface, width) = screen::acquire()?;
    let mut events = crossterm::event::EventStream::new();

    let outcome = run::drive(cli, prepared, width, &mut surface, &mut events).await;

    raw.leave();
    println!();
    outcome
}

/// Monta a sessão, mantém-na parada e sai sem gastar um turno.
///
/// Mora ao lado de `main` pelo mesmo motivo que [`interactive_session`]: é uma
/// superfície do processo, não algo que uma sessão faz. O trabalho todo já
/// aconteceu em [`session::prepare`]; o que resta aqui é não desmontar cedo
/// demais.
fn probe_startup(prepared: session::Prepared, idle: Duration) -> ExitCode {
    // Parar a thread, e não o timer do runtime, é deliberado: o que se quer
    // medir é um processo que não tem o que fazer, e a feature `time` do tokio
    // chegaria aqui só por transitividade de outra crate.
    std::thread::sleep(idle);

    // Só depois da espera. Largar a sessão antes encerraria os processos MCP e
    // desfaria o runtime, e o pico de memória passaria a ser o de um processo
    // já desmontado — que não é a sessão ociosa que o NFR-2 orça.
    drop(prepared);
    ExitCode::SUCCESS
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
mod tests {
    use super::*;
    use clap::CommandFactory;

    #[test]
    fn cli_definition_is_valid() {
        Cli::command().debug_assert();
    }

    #[test]
    fn the_probe_flag_defaults_to_no_idle_and_still_accepts_one() {
        // `--probe-startup` sozinho e a medicao de latencia, a mais frequente.
        // Exigir valor dela transformaria o caso comum no mais verboso.
        let bare = Cli::try_parse_from(["nycode", "--probe-startup"]).unwrap();
        assert_eq!(bare.probe_startup, Some(0));

        let held = Cli::try_parse_from(["nycode", "--probe-startup", "250"]).unwrap();
        assert_eq!(held.probe_startup, Some(250));

        let absent = Cli::try_parse_from(["nycode"]).unwrap();
        assert_eq!(absent.probe_startup, None);
    }

    /// Backend que não emite nada, para exercitar o modo headless sem rede.
    #[derive(Debug)]
    struct Mute;

    #[async_trait::async_trait]
    impl nycode_agent::Backend for Mute {
        async fn stream(
            &self,
            _messages: Vec<nycode_ai::anthropic::Message>,
            _system: Option<String>,
            _tools: Vec<nycode_ai::anthropic::ToolSpec>,
        ) -> nycode_ai::Result<nycode_agent::backend::EventStream> {
            Ok(Box::pin(futures_util::stream::empty()))
        }
    }

    fn prepared(root: &std::path::Path) -> session::Prepared {
        session::Prepared {
            agent: nycode_agent::Agent::new(
                std::sync::Arc::new(Mute),
                nycode_agent::ToolContext::new(root).unwrap(),
            ),
            cancel: nycode_agent::Cancel::new(),
            store: nycode_agent::Store::open(root.join(".nycode/sessions")).unwrap(),
            session_id: "sessao-1".to_owned(),
            persisted: 0,
            context: nycode_agent::Context::default(),
            root: root.to_path_buf(),
            mcp: Vec::new(),
            models: Vec::new(),
            rebuild: Box::new(|_| anyhow::bail!("sem troca de modelo aqui")),
        }
    }

    #[tokio::test]
    async fn a_headless_turn_writes_the_session_and_reports_the_stop_reason() {
        // E o caminho de FR-2 inteiro: rodar, gravar, e traduzir o motivo de
        // parada num codigo de saida que um script consegue ramificar.
        let dir = tempfile::tempdir().unwrap();
        let cli = Cli::try_parse_from(["nycode", "-p", "oi", "--quiet"]).unwrap();
        let prepared = prepared(dir.path());
        let store = nycode_agent::Store::open(dir.path().join(".nycode/sessions")).unwrap();

        let code = run::headless(&cli, prepared, "oi").await.unwrap();

        assert_eq!(
            format!("{code:?}"),
            format!("{:?}", ExitCode::SUCCESS),
            "um turno sem stop_reason termina como end_turn"
        );
        let saved = store.load("sessao-1").unwrap();
        assert_eq!(saved.len(), 1, "o pedido do usuario precisa ficar gravado");
    }

    #[tokio::test]
    async fn asking_for_a_session_without_a_terminal_refuses_before_touching_anything() {
        // Recusar antes de resolver credencial e abrir arquivo de sessao evita
        // criar `.nycode/` num diretorio onde ninguem pediu sessao nenhuma.
        let dir = tempfile::tempdir().unwrap();
        let cli = Cli::try_parse_from([
            "nycode",
            "--cwd",
            dir.path().to_str().unwrap(),
            "--api-key",
            "irrelevante",
        ])
        .unwrap();

        let code = run(&cli, false).await.unwrap();

        assert_eq!(
            format!("{code:?}"),
            format!("{:?}", ExitCode::from(exit::NO_TERMINAL))
        );
        assert!(
            !dir.path().join(".nycode").exists(),
            "nada deveria ter sido criado"
        );
    }

    #[tokio::test]
    async fn the_startup_probe_mounts_the_session_and_leaves_without_a_turn() {
        // E o que o gate de performance mede. Se a sonda gastasse um turno, a
        // medicao passaria a depender de gateway e a incluir a latencia dele;
        // se falhasse sem gateway, nao mediria nada em CI.
        let dir = tempfile::tempdir().unwrap();
        let cli = Cli::try_parse_from([
            "nycode",
            "--probe-startup",
            "--cwd",
            dir.path().to_str().unwrap(),
            "--api-key",
            "irrelevante",
            // Porta reservada: a conexao e recusada de imediato, sem espera.
            "--base-url",
            "http://127.0.0.1:1/v1",
        ])
        .unwrap();

        let code = run(&cli, false).await.unwrap();

        assert_eq!(format!("{code:?}"), format!("{:?}", ExitCode::SUCCESS));
        let store = nycode_agent::Store::open(dir.path().join(".nycode/sessions")).unwrap();
        assert!(
            store.latest().unwrap().is_none(),
            "a sonda monta a sessao e sai; gravar turno mediria outra coisa"
        );
    }

    #[tokio::test]
    async fn the_probe_keeps_the_session_up_for_the_interval_it_was_given() {
        // O pico de memoria que o NFR-2 orca e o de uma sessao parada; uma
        // sonda que saisse na hora mediria a montagem.
        let dir = tempfile::tempdir().unwrap();
        let cli = Cli::try_parse_from([
            "nycode",
            "--probe-startup",
            "150",
            "--cwd",
            dir.path().to_str().unwrap(),
            "--api-key",
            "irrelevante",
            "--base-url",
            "http://127.0.0.1:1/v1",
        ])
        .unwrap();

        let start = std::time::Instant::now();
        let code = run(&cli, false).await.unwrap();

        assert_eq!(format!("{code:?}"), format!("{:?}", ExitCode::SUCCESS));
        assert!(
            start.elapsed() >= Duration::from_millis(150),
            "a sonda saiu antes de cumprir a ociosidade pedida"
        );
    }

    #[tokio::test]
    async fn a_prompt_takes_the_headless_path_even_without_a_terminal() {
        // Sem gateway o turno falha; o que este teste protege e que `-p` nao
        // depende de TTY, que e o caso de uso de CI.
        let dir = tempfile::tempdir().unwrap();
        let cli = Cli::try_parse_from([
            "nycode",
            "-p",
            "oi",
            "--quiet",
            "--cwd",
            dir.path().to_str().unwrap(),
            "--api-key",
            "irrelevante",
            // Porta reservada: a conexao e recusada de imediato, sem espera.
            "--base-url",
            "http://127.0.0.1:1/v1",
        ])
        .unwrap();

        assert!(
            run(&cli, false).await.is_err(),
            "sem gateway o turno precisa falhar, nao fingir sucesso"
        );
    }

    #[test]
    fn defaults_point_at_the_gateway_without_any_flags() {
        // O ponto do nycode e abrir sessao sem configurar endpoint nem catalogo.
        let cli = Cli::try_parse_from(["nycode", "-p", "oi"]).unwrap();
        assert_eq!(cli.base_url, Config::DEFAULT_BASE_URL);
        assert_eq!(cli.model, Config::DEFAULT_MODEL);
        assert_eq!(cli.prompt.as_deref(), Some("oi"));
        assert!(!cli.quiet);
    }

    #[test]
    fn flags_override_the_defaults() {
        let cli = Cli::try_parse_from([
            "nycode",
            "--base-url",
            "https://gw.example.com/v1",
            "--model",
            "nylla-grok-4.5",
            "--max-tokens",
            "512",
            "--quiet",
            "-p",
            "faca",
        ])
        .unwrap();
        assert_eq!(cli.base_url, "https://gw.example.com/v1");
        assert_eq!(cli.model, "nylla-grok-4.5");
        assert_eq!(cli.max_tokens, 512);
        assert!(cli.quiet);
    }
}
