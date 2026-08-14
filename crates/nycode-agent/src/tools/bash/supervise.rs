//! Do processo no ar ao processo terminado, sem deixar nada de pé.
//!
//! Separado de [`super::launch`] porque muda por outro motivo: aquele muda
//! quando muda o que **contém** um comando — confinamento, prazo, ambiente —, e
//! isto muda quando muda como o processo é supervisionado enquanto corre.
//!
//! As três coisas que este módulo precisa acertar ao mesmo tempo, e que são a
//! razão de ele existir separado: ler os dois canos sem travar, terminar o grupo
//! no instante certo, e não deixar descendente vivo em nenhum dos caminhos de
//! saída — nem o normal, nem o prazo, nem o cancelamento.

use super::capture::{self, Finished};

/// Sobe o processo, drena os dois canais e espera o fim.
///
/// Os três acontecem juntos, e não em sequência, por duas razões independentes.
/// Esperar antes de ler trava o comando assim que ele enche o buffer do cano —
/// 64 kibibytes no Linux, menos do que um `cargo build` emite. E ler um canal
/// de cada vez trava do mesmo jeito quando o outro enche: um comando que
/// escreve muito em `stderr` enquanto quem lê está preso no `stdout` fica
/// esperando para sempre.
pub async fn collect(
    mut command: tokio::process::Command,
    cap: usize,
) -> std::io::Result<Finished> {
    let mut child = command.spawn()?;
    // A anotação é o que alcança este comando se o processo morrer por sinal:
    // ali nenhum `drop` roda, e o grupo destacado seguiria escrevendo no
    // workspace. Ela sai sozinha em todo caminho que colhe o filho.
    let _tracked = crate::policy::confinement::process::shared().track(&child);
    let missing = |canal| {
        std::io::Error::new(
            std::io::ErrorKind::BrokenPipe,
            format!("o processo subiu sem {canal}"),
        )
    };
    let mut out = child.stdout.take().ok_or_else(|| missing("stdout"))?;
    let mut err = child.stderr.take().ok_or_else(|| missing("stderr"))?;

    // Ler os dois canos junto com a espera pelo processo, e não em sequência:
    // esperar antes de ler trava o comando quando ele enche o buffer do cano, e
    // ler um canal de cada vez trava quando o outro enche.
    let reading = async {
        let (stdout, stderr) =
            tokio::join!(capture::drain(&mut out, cap), capture::drain(&mut err, cap));
        (stdout, stderr)
    };

    // Guardado enquanto existe: depois do `wait` o tokio já colheu o filho e
    // `Child::id` devolve `None`, então quem quiser sinalizar o grupo depois
    // disso precisa ter anotado o número antes.
    let group = crate::policy::confinement::process::group_of(&child);

    // Declarada depois do `child` para largar antes dele: o `drop` do `Child`
    // colhe o filho, e a guarda precisa sinalizar enquanto o PID ainda é dele.
    // É o caminho do cancelamento — largar este future mataria só o líder.
    let mut cancelled = crate::policy::confinement::process::GroupOnDrop::arm(&child);

    // Terminar o grupo **aqui**, colado no `wait`, e não depois do `join`.
    //
    // Um neto destacado herda a ponta de escrita do cano e pode segurá-la
    // aberta depois de o líder sair (pi#5303): a drenagem fica esperando um EOF
    // que só chega quando essa ponta fecha. Fazer isto depois do `join` seria
    // tarde, porque o `join` não completa enquanto a drenagem não terminar — o
    // sinal que a destravaria só sairia depois de ela ter se destravado
    // sozinha, que é justamente o que não acontece.
    //
    // O que já está no buffer do cano não se perde: fechar a ponta de escrita
    // não descarta byte escrito, e a drenagem lê o que restou antes do EOF.
    let waiting = async {
        let status = child.wait().await;
        if let Some(group) = group {
            let _ = crate::policy::confinement::process::terminate_group(group);
        }
        status
    };

    let ((stdout, stderr), status) = tokio::join!(reading, waiting);
    // O grupo já foi terminado ao lado do `wait`, e o filho já foi colhido — o
    // número deixou de ser nosso, e sinalizá-lo agora alcançaria quem o herdou.
    cancelled.disarm();
    let status = status?;

    Ok(Finished {
        status,
        stdout,
        stderr,
    })
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
mod tests {
    use super::*;
    use std::process::Stdio;

    fn piped() -> tokio::process::Command {
        let mut command = tokio::process::Command::new("sh");
        command
            .arg("-c")
            .arg("echo pronto")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        command
    }

    #[tokio::test]
    async fn a_program_that_does_not_exist_fails_at_the_spawn_and_says_so() {
        // O erro precisa sair daqui e nao virar uma saida vazia bem-sucedida:
        // um comando que nunca subiu nao e um comando que nao imprimiu nada.
        let mut command = tokio::process::Command::new("/nao/existe/este/programa");
        command
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let err = collect(command, 1024).await.unwrap_err();

        assert_eq!(err.kind(), std::io::ErrorKind::NotFound);
    }

    #[tokio::test]
    async fn a_process_without_a_readable_stdout_is_refused_instead_of_hanging() {
        // Sem o cano nao ha o que drenar, e seguir daqui daria uma saida vazia
        // que parece um comando silencioso.
        let mut command = piped();
        command.stdout(Stdio::null());

        let err = collect(command, 1024).await.unwrap_err();

        assert_eq!(err.kind(), std::io::ErrorKind::BrokenPipe);
        assert!(err.to_string().contains("stdout"), "{err}");
    }

    #[tokio::test]
    async fn a_process_without_a_readable_stderr_is_refused_naming_that_channel() {
        // Nomear o canal errado mandaria quem le a mensagem procurar no lugar
        // errado.
        let mut command = piped();
        command.stderr(Stdio::null());

        let err = collect(command, 1024).await.unwrap_err();

        assert!(err.to_string().contains("stderr"), "{err}");
    }

    #[tokio::test]
    async fn a_command_that_runs_gives_back_its_output_and_its_status() {
        let finished = collect(piped(), 1024).await.unwrap();

        assert!(finished.status.success());
        assert!(finished.stdout.text().contains("pronto"));
    }
}
