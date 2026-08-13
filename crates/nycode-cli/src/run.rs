//! As duas formas de rodar uma sessão.
//!
//! Separadas do ponto de entrada porque mudam por outro motivo: a linha de
//! comando muda quando uma flag entra, isto muda quando o que uma sessão faz
//! muda. As duas montam a mesma preparação e diferem só no destino da resposta.

use std::process::ExitCode;

use crate::{Cli, exit, interactive, output, session};

/// Um prompt, uma resposta em stdout (FR-2).
pub async fn headless(
    cli: &Cli,
    prepared: session::Prepared,
    prompt: &str,
) -> anyhow::Result<ExitCode> {
    let session::Prepared {
        mut agent,
        store,
        session_id,
        persisted,
        ..
    } = prepared;

    // Recusar aqui é o ponto: um arquivo ilegível descoberto depois do turno
    // teria custado uma ida ao gateway para nada.
    let attachments = cli
        .images
        .iter()
        .map(|path| crate::image::attach(path))
        .collect::<anyhow::Result<Vec<_>>>()?;

    let mut sink = output::Sink::new(cli.output_format, cli.quiet);
    let outcome = agent.run_with(prompt, attachments, &mut sink).await;
    sink.finish(&outcome);

    // Persistido depois do turno: gravar antes registraria uma conversa que
    // nunca aconteceu se o backend recusar o pedido. Um cancelamento, porém,
    // conta como acontecido — as ferramentas que rodaram mudaram o disco, e uma
    // sessão que não registra isso descreve um repositório que não existe.
    if session::produced_history(&outcome) {
        for message in &agent.history()[persisted..] {
            store.append(&session_id, message)?;
        }
    }

    match outcome {
        Ok(outcome) => Ok(exit::code_for(&outcome.stop_reason)),
        Err(nycode_agent::Error::Cancelled) => {
            eprintln!("nycode: cancelado; a sessao `{session_id}` guarda o turno parcial");
            Ok(ExitCode::from(exit::CANCELLED))
        }
        Err(err) => Err(err.into()),
    }
}

/// Monta a sessão e a roda contra a superfície recebida (FR-1).
///
/// Recebe a superfície e o fluxo de eventos por parâmetro, e por isso é
/// exercitado sem TTY. Quem toma posse do terminal é `main`, que é onde a
/// restauração precisa acontecer antes de o processo sair.
pub async fn drive<S, E>(
    cli: &Cli,
    prepared: session::Prepared,
    width: usize,
    surface: &mut S,
    events: &mut E,
) -> anyhow::Result<ExitCode>
where
    S: interactive::Surface,
    E: futures_util::Stream<Item = std::io::Result<crossterm::event::Event>> + Unpin,
{
    interactive::Session::open(
        prepared,
        cli.model.clone(),
        cli.allow_writes,
        cli.quiet,
        width,
    )
    .run(surface, events)
    .await
    .map(|()| ExitCode::SUCCESS)
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
mod tests {
    use super::*;
    use clap::Parser as _;

    #[tokio::test]
    async fn a_cancelled_headless_turn_exits_with_its_own_code() {
        // Um script que encadeia `nycode` precisa distinguir cancelamento de
        // sucesso sem parsear a saida.
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_path_buf();
        let cli = Cli::parse_from(["nycode", "--api-key", "k", "-p", "oi"]);

        let cancel = nycode_agent::Cancel::new();
        cancel.cancel();
        let prepared = session::Prepared {
            agent: nycode_agent::Agent::new(
                std::sync::Arc::new(crate::interactive::fakes::Mute),
                nycode_agent::ToolContext::new(&root).unwrap(),
            )
            .with_cancel(cancel),
            cancel: nycode_agent::Cancel::new(),
            store: nycode_agent::Store::open(root.join(".nycode/sessions")).unwrap(),
            session_id: "sessao-1".to_owned(),
            persisted: 0,
            context: nycode_agent::Context::discover(&root),
            root,
            mcp: Vec::new(),
            models: Vec::new(),
            rebuild: Box::new(|_| anyhow::bail!("sem troca de modelo aqui")),
        };

        let code = headless(&cli, prepared, "oi").await.unwrap();
        assert_eq!(
            format!("{code:?}"),
            format!("{:?}", ExitCode::from(exit::CANCELLED))
        );
    }

    #[tokio::test]
    async fn an_interactive_session_opens_and_closes_cleanly() {
        // Cobre tudo que `interactive_session` faz menos as quatro linhas que
        // exigem um TTY, e que nenhuma maquina de CI tem.
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_path_buf();
        let cli = Cli::parse_from(["nycode", "--api-key", "k"]);

        let prepared = session::Prepared {
            agent: nycode_agent::Agent::new(
                std::sync::Arc::new(crate::interactive::fakes::Mute),
                nycode_agent::ToolContext::new(&root).unwrap(),
            ),
            cancel: nycode_agent::Cancel::new(),
            store: nycode_agent::Store::open(root.join(".nycode/sessions")).unwrap(),
            session_id: "sessao-1".to_owned(),
            persisted: 0,
            context: nycode_agent::Context::discover(&root),
            root,
            mcp: Vec::new(),
            models: Vec::new(),
            rebuild: Box::new(|_| anyhow::bail!("sem troca de modelo aqui")),
        };

        let mut surface = crate::interactive::fakes::Recording::new();
        let mut events = futures_util::stream::iter(Vec::new());
        let code = drive(&cli, prepared, 80, &mut surface, &mut events)
            .await
            .unwrap();

        assert_eq!(format!("{code:?}"), format!("{:?}", ExitCode::SUCCESS));
        assert!(
            surface.scrollback.contains("nycode"),
            "o cabecalho precisa aparecer: {}",
            surface.scrollback
        );
    }
}
