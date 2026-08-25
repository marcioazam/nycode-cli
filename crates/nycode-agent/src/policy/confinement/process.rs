//! Um processo filho que, quando termina, leva junto o que iniciou.
//!
//! A razão de este módulo existir é um defeito que a suíte de testes provou
//! depois de medir: `kill_on_drop` mata o processo direto, e só ele. Sob
//! `bubblewrap --unshare-pid` isso deixa um órfão — o `bwrap` externo morre e o
//! processo dentro do namespace de PID, que lá dentro é PID 1, segue vivo, com
//! escrita no workspace, depois de o harness ter dito que o interrompeu. Um
//! hook roda a cada chamada de ferramenta, então o que escapa se acumula ao
//! longo da sessão.
//!
//! A resposta é o que a referência já fazia: o filho nasce líder de um grupo
//! próprio, e terminar é sinalizar o **grupo**, não o líder. É a mesma
//! propriedade que o namespace de PID dá sob bubblewrap, aplicada sem o
//! confinamento — e que sob ele cobre a janela que o `kill_on_drop` abria.
//!
//! Isso cobre quem larga o future. Quem não larga nada é o processo que morre
//! por sinal, e para esse caso existe o [`registry`]: a lista dos filhos
//! destacados que este processo ainda não colheu, varrida no encerramento.

mod registry;

pub use registry::{Registry, Tracked, shared};

use std::io;

/// Põe o filho num grupo de processo próprio, para que ele possa ser terminado
/// junto com o que iniciar.
///
/// Em Unix, `process_group(0)` chama `setpgid(0, 0)` no filho, entre o `fork` e
/// o `exec`: o filho vira líder de um grupo cujo identificador é o PID dele, e
/// o que ele iniciar fica no mesmo grupo. Fora de Unix é o comportamento de
/// sempre.
///
/// Uma consequência que quem chama precisa saber: o grupo não recebe mais o
/// `SIGINT` do terminal — `Ctrl+C` chega ao grupo de frente do processo, e este
/// filho não está nele. É a forma que o cancelamento por turno toma aqui, e por
/// isso quem larga o future precisa chamar [`kill`] em vez de confiar no
/// `kill_on_drop`.
pub fn detach(command: &mut tokio::process::Command) {
    #[cfg(unix)]
    command.process_group(0);
    let _ = command;
}

/// Termina o grupo de processos que [`detach`] criou.
///
/// `kill_on_drop` mata o líder; isto mata o líder e o que ele iniciou. Um
/// processo que já terminou produz `ESRCH`, que não é erro para quem chama:
/// terminar o que já terminou é não fazer nada.
///
/// Fora de Unix não há grupo que cubra o filho, e a resposta é matar o filho e
/// só ele — é menos, e não há como ser mais sem outra primitiva de SO.
pub fn kill(child: &mut tokio::process::Child) {
    if let Some(group) = group_of(child) {
        let _ = terminate_group(group);
    }
    // `Child::kill()` é assíncrono: criar o future e descartá-lo não envia
    // sinal nenhum. `start_kill` faz a parte síncrona agora; quem precisa da
    // garantia de colheita chama `wait().await` em seguida.
    if let Err(err) = child.start_kill()
        && err.kind() != io::ErrorKind::InvalidInput
    {
        tracing::debug!(%err, "nao foi possivel terminar o processo lider");
    }
}

/// Termina um grupo cujo identificador foi guardado antes da colheita, dizendo
/// se alcançou alguém.
///
/// Existe separado de [`kill`] porque [`kill`] parte do `Child`, e um `Child`
/// já colhido não tem mais número: `Child::id` devolve `None` depois do `wait`.
/// Quem precisa terminar o grupo **depois** de o líder ter saído — a drenagem
/// do cano em `tools::bash`, a varredura do [`Registry`] — guarda o
/// identificador enquanto ele existe e o passa aqui.
///
/// `ESRCH` é o grupo que já acabou, e não é erro: terminar o que já terminou é
/// não fazer nada.
///
/// O `false` que isso produz é o caso **ordinário**, não uma falha — um comando
/// que não deixou nada de pé tem o grupo vazio no momento do sinal. Só a
/// varredura do [`Registry`] usa o valor, porque para ela um `true` é o defeito
/// que ela existe para contar; quem termina no caminho normal o descarta.
#[cfg(unix)]
#[must_use]
pub fn terminate_group(group: i32) -> bool {
    let Some(pid) = rustix::process::Pid::from_raw(group) else {
        return false;
    };
    rustix::process::kill_process_group(pid, rustix::process::Signal::KILL).is_ok()
}

#[cfg(not(unix))]
#[must_use]
pub fn terminate_group(_group: i32) -> bool {
    false
}

/// Termina o grupo se for largada antes de o filho ser colhido.
///
/// O `kill_on_drop` do tokio manda `SIGKILL` ao **líder** quando o `Child` é
/// largado, e só a ele — que é o mesmo defeito que o
/// [ADR-0021](../../../../docs/architecture/decisions/0021-terminar-e-sinalizar-o-grupo-nao-o-lider.md)
/// fechou no caminho do prazo e deixou aberto no do cancelamento. Largar o
/// future do turno matava o `bash` e deixava de pé o que ele tinha iniciado.
///
/// A guarda dispara enquanto o filho ainda **não** foi colhido, que é o que
/// torna o número seguro de sinalizar: o zumbi reserva o PID, que é também o
/// identificador do grupo, então ninguém mais pode tê-lo recebido. Depois da
/// colheita ela é desarmada por [`Self::disarm`], porque aí o número deixou de
/// ser nosso.
#[derive(Debug)]
pub struct GroupOnDrop {
    group: Option<i32>,
}

impl GroupOnDrop {
    /// Arma a guarda para o grupo deste filho.
    #[must_use]
    pub fn arm(child: &tokio::process::Child) -> Self {
        Self {
            group: group_of(child),
        }
    }

    /// Desarma, porque o caminho normal já terminou o grupo.
    pub const fn disarm(&mut self) {
        self.group = None;
    }
}

impl Drop for GroupOnDrop {
    fn drop(&mut self) {
        if let Some(group) = self.group {
            let _ = terminate_group(group);
        }
    }
}

/// O identificador do grupo do filho, enquanto ele ainda tem um.
///
/// Depois da colheita não há o que devolver, e é por isso que quem vai precisar
/// dele mais tarde chama isto antes de esperar.
#[must_use]
pub fn group_of(child: &tokio::process::Child) -> Option<i32> {
    child.id().and_then(|id| i32::try_from(id).ok())
}

#[cfg(all(test, unix))]
#[allow(clippy::unwrap_used, clippy::panic)]
mod tests {
    use super::*;
    use std::process::Stdio;
    use tokio::io::AsyncBufReadExt as _;

    fn shell(command_line: &str) -> tokio::process::Child {
        let mut command = tokio::process::Command::new("sh");
        command
            .arg("-c")
            .arg(command_line)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        detach(&mut command);
        command.spawn().unwrap()
    }

    fn lives(id: u32) -> bool {
        rustix::process::kill_process(
            rustix::process::Pid::from_raw(id.cast_signed()).unwrap(),
            rustix::process::Signal::CONT,
        )
        .is_ok()
    }

    #[tokio::test]
    async fn a_detached_child_leads_a_group_of_its_own() {
        let mut child = shell("sleep 30");
        let id = child.id().unwrap();

        // O filho virou lider de um grupo cujo identificador e o PID dele: e o
        // que `setpgid(0, 0)` define, e e o que permite sinalizar o grupo sem
        // tocar no grupo do chamador.
        let grupo = rustix::process::getpgid(Some(
            rustix::process::Pid::from_raw(id.cast_signed()).unwrap(),
        ))
        .unwrap();
        let caller = rustix::process::getpgrp();

        kill(&mut child);
        assert_eq!(
            rustix::process::Pid::as_raw(Some(grupo)),
            id.cast_signed(),
            "o filho nao lidera o proprio grupo"
        );
        assert_ne!(
            rustix::process::Pid::as_raw(Some(caller)),
            rustix::process::Pid::as_raw(Some(grupo)),
            "o filho ficou no grupo do chamador"
        );
    }

    #[tokio::test]
    async fn terminating_kills_the_descendant_the_leader_started() {
        // O ponto do modulo. O lider morre e o que ele iniciou vai junto; sem o
        // grupo, o neto sobrevive escrevendo no workspace.
        let mut command = tokio::process::Command::new("sh");
        command
            .arg("-c")
            .arg("sleep 30 & echo $!; wait")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        detach(&mut command);
        let mut child = command.spawn().unwrap();

        // O neto e lido pela saida do lider antes de ele morrer.
        let mut stdout = tokio::io::BufReader::new(child.stdout.take().unwrap());
        let mut linha = String::new();
        tokio::time::timeout(
            std::time::Duration::from_secs(5),
            stdout.read_line(&mut linha),
        )
        .await
        .unwrap()
        .unwrap();
        let neto: u32 = linha.trim().parse().unwrap();

        kill(&mut child);

        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        assert!(!lives(neto), "o neto {neto} sobreviveu ao termino do grupo");
    }

    #[tokio::test]
    async fn killing_what_already_ended_is_not_an_error() {
        let mut child = shell("true");
        child.wait().await.unwrap();
        kill(&mut child);
        kill(&mut child);
    }
}
