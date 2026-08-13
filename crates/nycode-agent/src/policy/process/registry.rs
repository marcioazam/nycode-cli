//! Quem ainda precisa morrer quando este processo morrer.
//!
//! [`super::detach`] põe o filho num grupo próprio, e o preço declarado no
//! [ADR-0021](../../../../../docs/architecture/decisions/0021-terminar-e-sinalizar-o-grupo-nao-o-lider.md)
//! é que esse grupo deixa de receber o `SIGINT` do terminal: quem termina o
//! grupo passa a ser quem larga o future. Isso cobre o estouro de prazo e o
//! cancelamento, e não cobre o caso em que o processo inteiro morre — um
//! `SIGTERM`, um terminal fechado. Ali nenhum `drop` roda, e o filho destacado
//! sobrevive ao pai escrevendo no workspace que o modelo estava inspecionando.
//!
//! Este registro é a lista do que ficaria de pé
//! ([ADR-0023](../../../../../docs/architecture/decisions/0023-o-registro-de-filhos-destacados-morre-com-o-processo.md)).
//! Ele não é um estático por conveniência: é um valor com dono, e [`shared`] é
//! só a instância que o processo usa. A varredura é exercitável sobre uma
//! instância de teste, em vez de sobre o estado do processo que roda a suíte —
//! e varrer o estado do processo dentro da suíte mataria os filhos dos testes
//! que estivessem correndo ao lado.
//!
//! **A anotação sai junto com a colheita, nunca depois dela.** Enquanto o líder
//! não é colhido, o zumbi reserva o PID — que é também o identificador do grupo
//! —, então a varredura só alcança processo que este harness subiu. Um registro
//! que continuasse a crescer guardaria número que o sistema já entregou a
//! outra pessoa, e sinalizá-lo seria matar processo de terceiro.

use std::collections::BTreeSet;
use std::sync::{Mutex, OnceLock, PoisonError};

/// Os filhos destacados que este processo subiu e ainda não colheu.
#[derive(Debug, Default)]
pub struct Registry {
    /// Identificadores de grupo, que são os PIDs dos líderes.
    ///
    /// O cadeado é o do `std` e não o do `tokio`: a varredura roda no caminho
    /// de encerramento, onde não há o que aguardar, e um cadeado assíncrono ali
    /// exigiria um runtime que o encerramento pode já não ter.
    groups: Mutex<BTreeSet<i32>>,
}

/// O registro deste processo.
pub fn shared() -> &'static Registry {
    static SHARED: OnceLock<Registry> = OnceLock::new();
    SHARED.get_or_init(Registry::default)
}

impl Registry {
    /// Anota o filho recém-subido e devolve a baixa dele.
    ///
    /// A baixa sai do registro quando é largada, e ela é largada em todo
    /// caminho que colhe o filho — inclusive no `drop` do future, que é o
    /// cancelamento. O que não larga nada é a morte do processo, e é esse o
    /// caso que o registro existe para cobrir.
    ///
    /// Um filho já colhido não tem PID a anotar, e a baixa devolvida não faz
    /// nada: anotar um número que ninguém mais reserva é o começo do defeito
    /// que este módulo evita.
    pub fn track<'a>(&'a self, child: &tokio::process::Child) -> Tracked<'a> {
        let group = child.id().and_then(|id| i32::try_from(id).ok());
        if let Some(group) = group {
            self.groups().insert(group);
        }
        Tracked {
            registry: self,
            group,
        }
    }

    /// Termina o grupo de todo filho ainda anotado, e devolve quantos foram.
    ///
    /// Chamada no encerramento do processo, e só ali. No caminho normal cada
    /// baixa já saiu por conta própria, então uma varredura que encontre algo é
    /// exatamente o caso que motivou o registro.
    pub fn sweep(&self) -> usize {
        let pending = std::mem::take(&mut *self.groups());
        pending
            .into_iter()
            .filter(|group| super::terminate_group(*group))
            .count()
    }

    /// Quantos filhos destacados este processo ainda não colheu.
    #[must_use]
    pub fn pending(&self) -> usize {
        self.groups().len()
    }

    fn groups(&self) -> std::sync::MutexGuard<'_, BTreeSet<i32>> {
        // Envenenar o cadeado é o pânico de outra thread. Recusar o registro
        // por causa disso deixaria um filho destacado fora da varredura, que é
        // o pior dos dois desfechos.
        self.groups.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// A anotação de um filho no registro, enquanto ele é deste processo.
#[derive(Debug)]
pub struct Tracked<'a> {
    registry: &'a Registry,
    group: Option<i32>,
}

impl Drop for Tracked<'_> {
    fn drop(&mut self) {
        if let Some(group) = self.group {
            self.registry.groups().remove(&group);
        }
    }
}

#[cfg(all(test, unix))]
#[allow(clippy::unwrap_used, clippy::panic)]
mod tests {
    use super::*;
    use std::process::Stdio;
    use std::time::Duration;
    use tokio::io::AsyncBufReadExt as _;

    fn lives(id: u32) -> bool {
        rustix::process::kill_process(
            rustix::process::Pid::from_raw(id.cast_signed()).unwrap(),
            rustix::process::Signal::CONT,
        )
        .is_ok()
    }

    /// Sobe um líder destacado que inicia um neto e anuncia o PID dele.
    async fn leader_with_grandchild() -> (tokio::process::Child, u32) {
        let mut command = tokio::process::Command::new("sh");
        command
            .arg("-c")
            .arg("sleep 30 & echo $!; wait")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        super::super::detach(&mut command);
        let mut child = command.spawn().unwrap();

        let mut stdout = tokio::io::BufReader::new(child.stdout.take().unwrap());
        let mut linha = String::new();
        tokio::time::timeout(Duration::from_secs(5), stdout.read_line(&mut linha))
            .await
            .unwrap()
            .unwrap();
        let neto = linha.trim().parse().unwrap();
        (child, neto)
    }

    #[tokio::test]
    async fn the_sweep_kills_the_descendant_of_a_child_that_was_never_reaped() {
        // O caso inteiro. Quando o processo morre por sinal nenhum `drop` roda,
        // e o filho destacado nao esta no grupo de frente do terminal: o sinal
        // nao chega a ele. Provar que o registro foi chamado nao prova nada —
        // quem precisa parar de escrever no workspace e o neto.
        let registry = Registry::default();
        // O líder fica vivo de propósito: quem precisa terminar o grupo aqui é
        // a varredura, e não o `drop` dele.
        let (child, neto) = leader_with_grandchild().await;
        let _tracked = registry.track(&child);

        assert_eq!(registry.pending(), 1);
        assert_eq!(
            registry.sweep(),
            1,
            "a varredura precisa ter alcancado o grupo"
        );

        tokio::time::sleep(Duration::from_millis(200)).await;
        assert!(!lives(neto), "o neto {neto} sobreviveu a varredura");
    }

    #[tokio::test]
    async fn a_child_that_was_reaped_leaves_no_number_behind_to_be_killed() {
        // Um registro que so cresce guarda PID que o sistema ja reciclou, e
        // terminar um PID reciclado e terminar processo inocente de outra
        // pessoa. A baixa sai junto com a colheita, e e isso que a impede.
        let registry = Registry::default();
        let (mut child, _neto) = leader_with_grandchild().await;
        let tracked = registry.track(&child);
        assert_eq!(registry.pending(), 1);

        super::super::kill(&mut child);
        child.wait().await.unwrap();
        drop(tracked);

        assert_eq!(registry.pending(), 0, "o colhido continuou anotado");
        assert_eq!(registry.sweep(), 0);
    }

    #[tokio::test]
    async fn a_sweep_with_nothing_pending_signals_nobody() {
        // O caminho normal: cada baixa ja saiu sozinha, e a varredura do
        // encerramento nao tem o que fazer.
        assert_eq!(Registry::default().sweep(), 0);
    }

    #[tokio::test]
    async fn a_child_already_reaped_is_never_written_into_the_registry() {
        // `Child::id` devolve `None` depois da colheita. Anotar `None` como se
        // fosse um grupo poria no registro um numero que nao e de ninguem.
        let registry = Registry::default();
        let mut command = tokio::process::Command::new("true");
        command.stdin(Stdio::null()).stdout(Stdio::null());
        let mut child = command.spawn().unwrap();
        child.wait().await.unwrap();

        let _tracked = registry.track(&child);

        assert_eq!(registry.pending(), 0);
    }
}
