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
mod invocation;
mod output;
mod run;
mod screen;
mod session;

use std::process::ExitCode;
use std::time::Duration;

use clap::Parser;

use invocation::{Cli, Route, choose};

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
        Route::Headless(prompt) => {
            // Lido antes de montar a sessão: se o cano trouxer o material, ele
            // é parte do pedido, e montar antes de saber o pedido inteiro só
            // adiaria a mesma espera.
            let piped = run::piped(has_terminal, &mut std::io::stdin());
            let prompt = run::with_piped(&prompt, piped.as_deref());
            let prepared = session::prepare(cli).await?;
            let ending = Ending::of(&prepared);
            sweep_on_termination(true);
            let code = run::headless(cli, prepared, &prompt).await;
            ending.fire().await;
            code
        }
        Route::Interactive => {
            let prepared = session::prepare(cli).await?;
            let ending = Ending::of(&prepared);
            sweep_on_termination(false);
            let code = interactive_session(cli, prepared).await;
            ending.fire().await;
            code
        }
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

/// O que dispara quando a sessão acaba.
///
/// Colhido antes de a superfície consumir a sessão, e disparado depois: o
/// `session-end` existe para o hook fechar o que abriu, e fechá-lo enquanto o
/// último turno ainda corre seria fechá-lo cedo. A sonda de arranque não
/// dispara nenhum dos dois — ela mede a montagem e sai sem sessão para encerrar.
struct Ending {
    hooks: nycode_agent::policy::Hooks,
    root: std::path::PathBuf,
}

impl Ending {
    fn of(prepared: &session::Prepared) -> Self {
        Self {
            hooks: prepared.lifecycle.clone(),
            root: prepared.root.clone(),
        }
    }

    async fn fire(&self) {
        use nycode_agent::policy::hooks::{Event, Payload};
        self.hooks
            .fire(
                Event::SessionEnd,
                &Payload::for_session(Event::SessionEnd, &self.root),
            )
            .await;
    }
}

/// Termina os filhos destacados antes de o processo morrer por um sinal.
///
/// `SIGTERM` e o terminal fechando matam o processo sem rodar `drop` nenhum, e
/// um filho destacado não está no grupo de frente do terminal — o sinal não
/// chega a ele ([ADR-0021](../../../docs/architecture/decisions/0021-terminar-e-sinalizar-o-grupo-nao-o-lider.md)).
/// Sem esta varredura o comando sobrevive ao harness e segue escrevendo no
/// workspace ([ADR-0023](../../../docs/architecture/decisions/0023-o-registro-de-filhos-destacados-morre-com-o-processo.md)).
///
/// Mora ao lado de `main` pela mesma razão que o modo bruto: disposição de
/// sinal é estado global do processo, e enterrá-la num módulo deixaria o dono
/// do processo sem controle sobre ela. A sonda de arranque não chama — ela não
/// sobe filho nenhum, e observar sinal ali mediria uma sessão que a rota não
/// monta.
#[cfg(unix)]
fn sweep_on_termination(headless: bool) {
    for kind in terminating(headless) {
        let raw = kind.as_raw_value();
        match tokio::signal::unix::signal(kind) {
            Ok(mut stream) => drop(tokio::spawn(async move {
                let _ = stream.recv().await;
                std::process::exit(after_signal(nycode_agent::policy::process::shared(), raw));
            })),
            // Não conseguir observar não derruba a sessão: o efeito é o de
            // antes, com o sinal matando o processo direto.
            Err(err) => tracing::warn!(sinal = raw, %err, "sinal de termino nao observado"),
        }
    }
}

#[cfg(not(unix))]
const fn sweep_on_termination(_headless: bool) {}

/// Os sinais cuja chegada precisa varrer o registro antes de o processo morrer.
///
/// `SIGINT` fica de fora de onde alguém já o usa. Em headless quem o consome é
/// `session::watch_for_interrupt`, para cancelar o turno; numa sessão
/// interativa o terminal está em modo bruto e `Ctrl+C` chega como tecla, não
/// como sinal. Escutá-lo nos dois lugares faria a mesma interrupção cancelar o
/// turno e matar o processo.
#[cfg(unix)]
fn terminating(headless: bool) -> Vec<tokio::signal::unix::SignalKind> {
    use tokio::signal::unix::SignalKind;

    let mut kinds = vec![SignalKind::terminate(), SignalKind::hangup()];
    if !headless {
        kinds.push(SignalKind::interrupt());
    }
    kinds
}

/// Varre o registro e devolve o código de saída que a convenção dá ao sinal.
///
/// O registro é parâmetro, e não a instância do processo, porque varrer aquela
/// dentro da suíte mataria os filhos dos testes que estivessem correndo ao
/// lado. É a costura que torna esta linha exercitável.
fn after_signal(registry: &nycode_agent::policy::process::Registry, signal: i32) -> i32 {
    let ended = registry.sweep();
    if ended > 0 {
        // Terminar processo do usuário em silêncio esconderia justamente o
        // fato que o registro existe para produzir.
        eprintln!("nycode: {ended} processo(s) destacado(s) terminado(s) no encerramento");
    }
    // 128 + número do sinal, a mesma convenção de `exit::CANCELLED`.
    128 + signal
}

/// Monta a sessão, mantém-na parada e sai sem gastar um turno.
///
/// Mora ao lado de `main` pelo mesmo motivo que [`interactive_session`]: é uma
/// superfície do processo, não algo que uma sessão faz. O trabalho todo já
/// aconteceu em [`session::prepare`]; o que resta aqui é não desmontar cedo
/// demais.
fn probe_startup(prepared: session::Prepared, idle: Duration) -> ExitCode {
    // Em `stderr`, e antes da espera. O gate mede o processo por fora e o que
    // ele lê é um número só, que diz que regrediu sem dizer onde; a repartição
    // por etapa é o que transforma "o arranque piorou 2 ms" em uma ação.
    eprintln!("nycode: fases {}", prepared.phases.report());

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
            phases: crate::session::Phases::default(),
            lifecycle: nycode_agent::policy::Hooks::default(),
            agent: nycode_agent::Agent::new(
                std::sync::Arc::new(Mute),
                nycode_agent::ToolContext::new(root).unwrap(),
            ),
            cancel: nycode_agent::Cancel::new(),
            store: nycode_agent::Store::open(root.join(".nycode/sessions")).unwrap(),
            session_id: "sessao-1".to_owned(),
            model: "modelo-de-teste".to_owned(),
            persisted: 0,
            context: nycode_agent::Context::default(),
            root: root.to_path_buf(),
            mcp: Vec::new(),
            models: Vec::new(),
            prices: std::collections::BTreeMap::new(),
            windows: std::collections::BTreeMap::new(),
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

        // O backend nao emitiu motivo de parada nenhum. Traduzir isso em
        // sucesso faria um turno mudo passar por concluido, e o script que
        // encadeia `nycode` seguiria adiante sobre uma resposta que nunca veio.
        // Qual e o codigo exato e assunto de `exit::code_for`, que tem os
        // proprios testes; aqui o que se protege e que nao seja zero.
        assert_ne!(
            format!("{code:?}"),
            format!("{:?}", ExitCode::SUCCESS),
            "um turno que nao disse como terminou nao e sucesso"
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
    async fn a_detached_child_left_over_is_terminated_when_a_signal_ends_the_process() {
        // O registro so vale se a varredura do encerramento de fato o esvaziar:
        // um filho destacado que sobra ao harness segue escrevendo no workspace
        // que o modelo estava inspecionando (ADR-0023).
        let registry = nycode_agent::policy::process::Registry::default();
        let mut command = tokio::process::Command::new("sleep");
        command
            .arg("30")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .kill_on_drop(true);
        // Destacado como os filhos de verdade: sem o grupo proprio a varredura
        // nao teria o que sinalizar, e o teste passaria sem exercitar nada.
        nycode_agent::policy::process::detach(&mut command);
        let mut child = command.spawn().unwrap();
        let tracked = registry.track(&child);
        assert_eq!(registry.pending(), 1);

        let code = after_signal(&registry, 15);

        assert_eq!(code, 143, "128 + SIGTERM, a convencao que o shell espera");
        assert_eq!(registry.pending(), 0, "a varredura precisa esvaziar");
        drop(tracked);
        // A varredura mandou `SIGKILL` ao grupo; o filho precisa ter morrido
        // por sinal, e nao seguir vivo ate o `drop` do proprio teste.
        let status = child.wait().await.unwrap();
        assert!(
            !status.success(),
            "o filho sobreviveu a varredura: {status}"
        );
    }

    #[test]
    fn the_interrupt_is_only_watched_where_nothing_else_already_uses_it() {
        // Em headless o `Ctrl+C` cancela o turno, e numa sessao interativa ele
        // chega como tecla. Escuta-lo nos dois lugares faria a mesma
        // interrupcao cancelar o turno e matar o processo.
        use tokio::signal::unix::SignalKind;

        assert!(!terminating(true).contains(&SignalKind::interrupt()));
        assert!(terminating(false).contains(&SignalKind::interrupt()));
        for headless in [true, false] {
            let kinds = terminating(headless);
            assert!(kinds.contains(&SignalKind::terminate()), "{headless}");
            assert!(kinds.contains(&SignalKind::hangup()), "{headless}");
        }
    }

    #[test]
    fn a_process_that_left_nothing_behind_still_exits_by_the_signal_it_got() {
        // O caminho normal: cada baixa ja saiu sozinha. O codigo de saida
        // continua sendo o do sinal, senao um script nao distingue "terminado"
        // de "falhou".
        let registry = nycode_agent::policy::process::Registry::default();
        assert_eq!(after_signal(&registry, 2), 130);
        assert_eq!(after_signal(&registry, 1), 129);
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
}
