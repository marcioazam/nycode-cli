//! As duas formas de rodar uma sessão.
//!
//! Separadas do ponto de entrada porque mudam por outro motivo: a linha de
//! comando muda quando uma flag entra, isto muda quando o que uma sessão faz
//! muda. As duas montam a mesma preparação e diferem só no destino da resposta.

use std::process::ExitCode;

use crate::{Cli, exit, interactive, output, session};

/// Teto do que um `stdin` canalizado acrescenta ao prompt.
///
/// `cat enorme.log | nycode -p "resuma"` não pode virar uma mensagem maior que
/// a janela — e nem um `String` do tamanho do arquivo antes disso.
const MAX_PIPED: usize = 256 * 1024;

/// Junta ao prompt o que veio por `stdin`, se veio algo.
///
/// `cat README.md | nycode -p "resuma isto"` é a convenção de todo utilitário
/// Unix, e sem ela o binário não entra num pipeline sem passar por `$(cat ...)`
/// e pela briga de escape do shell que isso traz.
///
/// O texto canalizado vai **depois** do prompt: o que o usuário digitou é a
/// instrução, e o que veio pelo cano é o material sobre o qual ela age. Invertido,
/// um arquivo longo empurraria a instrução para o fim de uma mensagem enorme.
#[must_use]
pub fn with_piped(prompt: &str, piped: Option<&str>) -> String {
    let Some(piped) = piped.map(str::trim).filter(|p| !p.is_empty()) else {
        return prompt.to_owned();
    };
    if prompt.trim().is_empty() {
        return piped.to_owned();
    }
    format!("{prompt}\n\n{piped}")
}

/// Lê o que foi canalizado para `stdin`, se houver cano.
///
/// `has_terminal` é parâmetro pela mesma razão que em `main`: ler o descritor
/// aqui tornaria os dois caminhos dependentes de quem invocou a suíte.
pub fn piped(has_terminal: bool, source: &mut impl std::io::Read) -> Option<String> {
    use std::io::Read as _;

    if has_terminal {
        return None;
    }
    let mut buffer = String::new();
    // Um cano que não termina prenderia o arranque; o teto também é o que
    // impede que um arquivo de gigabytes vire uma `String` antes de qualquer
    // decisão sobre ele.
    source
        .take(MAX_PIPED as u64)
        .read_to_string(&mut buffer)
        .ok()?;
    (!buffer.trim().is_empty()).then_some(buffer)
}

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
    // O agente diz o que este pedido acrescentou. Fatiar `history()` a partir
    // do que veio do disco parecia equivalente e não é: a compactação
    // automática reescreve o histórico no meio do turno, e o índice passa a
    // apontar para outra mensagem — ou para além do fim, derrubando o processo
    // depois de as ferramentas já terem mudado o disco.
    if session::produced_history(&outcome) {
        for message in agent.produced() {
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
    // Só a concessão total dispensa a pergunta. Com `--allow-writes` ainda há
    // decisão a tomar sobre `bash`, e numa sessão interativa há a quem
    // perguntar — negá-lo de antemão seria decidir por quem está ali.
    let decided = crate::invocation::grant::Grant::from_flags(cli.allow_writes, cli.allow_all)
        .decides_everything();

    let model = prepared.model.clone();
    interactive::Session::open(prepared, model, decided, cli.quiet, width)
        .run(surface, events)
        .await
        .map(|()| ExitCode::SUCCESS)
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
mod tests {
    use super::*;
    use clap::Parser as _;

    #[test]
    fn piped_input_lands_after_the_instruction_and_not_before_it() {
        // O que o usuario digitou e a instrucao; o que veio pelo cano e o
        // material sobre o qual ela age. Invertido, um arquivo longo empurraria
        // a instrucao para o fim de uma mensagem enorme.
        let juntado = with_piped("resuma isto", Some("linha um\nlinha dois"));

        assert_eq!(juntado, "resuma isto\n\nlinha um\nlinha dois");
    }

    #[test]
    fn a_prompt_without_a_pipe_is_left_alone() {
        assert_eq!(with_piped("so o prompt", None), "so o prompt");
        assert_eq!(with_piped("so o prompt", Some("   \n ")), "so o prompt");
    }

    #[test]
    fn a_pipe_without_a_prompt_becomes_the_prompt() {
        // `cat pedido.txt | nycode -p ""` nao pode virar uma mensagem que comeca
        // com duas linhas em branco.
        assert_eq!(with_piped("", Some("faca isto")), "faca isto");
    }

    #[test]
    fn nothing_is_read_from_stdin_when_there_is_a_terminal() {
        // Ler o descritor numa sessao interativa consumiria o que o usuario
        // fosse digitar, e travaria o arranque esperando um EOF que nao vem.
        let mut fonte = std::io::Cursor::new(b"nao deveria ser lido".to_vec());

        assert_eq!(piped(true, &mut fonte), None);
    }

    #[test]
    fn a_pipe_is_read_when_there_is_no_terminal() {
        let mut fonte = std::io::Cursor::new(b"conteudo do arquivo".to_vec());

        assert_eq!(
            piped(false, &mut fonte).as_deref(),
            Some("conteudo do arquivo")
        );
    }

    #[test]
    fn an_empty_pipe_is_the_same_as_no_pipe() {
        // `nycode -p "oi" < /dev/null` precisa se comportar como sem cano.
        let mut fonte = std::io::Cursor::new(Vec::new());

        assert_eq!(piped(false, &mut fonte), None);
    }

    #[test]
    fn a_pipe_larger_than_the_ceiling_is_cut_instead_of_swallowed_whole() {
        // Sem o teto, `cat enorme.log | nycode` viraria uma `String` do tamanho
        // do arquivo antes de qualquer decisao sobre ele.
        let mut fonte = std::io::Cursor::new(vec![b'x'; MAX_PIPED * 2]);

        let lido = piped(false, &mut fonte).unwrap();

        assert_eq!(lido.len(), MAX_PIPED);
    }

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
            phases: crate::session::Phases::default(),
            lifecycle: nycode_agent::policy::Hooks::default(),
            agent: nycode_agent::Agent::new(
                std::sync::Arc::new(crate::interactive::fakes::Mute),
                nycode_agent::ToolContext::new(&root).unwrap(),
            )
            .with_cancel(cancel),
            cancel: nycode_agent::Cancel::new(),
            store: nycode_agent::Store::open(root.join(".nycode/sessions")).unwrap(),
            session_id: "sessao-1".to_owned(),
            model: "modelo-de-teste".to_owned(),
            persisted: 0,
            context: nycode_agent::Context::discover(&root),
            root,
            mcp: Vec::new(),
            models: Vec::new(),
            prices: std::collections::BTreeMap::new(),
            windows: std::collections::BTreeMap::new(),
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
            phases: crate::session::Phases::default(),
            lifecycle: nycode_agent::policy::Hooks::default(),
            agent: nycode_agent::Agent::new(
                std::sync::Arc::new(crate::interactive::fakes::Mute),
                nycode_agent::ToolContext::new(&root).unwrap(),
            ),
            cancel: nycode_agent::Cancel::new(),
            store: nycode_agent::Store::open(root.join(".nycode/sessions")).unwrap(),
            session_id: "sessao-1".to_owned(),
            model: "modelo-de-teste".to_owned(),
            persisted: 0,
            context: nycode_agent::Context::discover(&root),
            root,
            mcp: Vec::new(),
            models: Vec::new(),
            prices: std::collections::BTreeMap::new(),
            windows: std::collections::BTreeMap::new(),
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
