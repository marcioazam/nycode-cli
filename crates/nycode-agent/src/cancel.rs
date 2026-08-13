//! Sinal de cancelamento cooperativo.
//!
//! Cancelar no Rust assíncrono é largar o future, e para o stream de resposta
//! isso basta — o transporte não guarda estado global a limpar. O que não basta
//! é largar no meio de uma rodada de ferramentas: o backend exige que todo
//! bloco `tool_use` tenha um `tool_result` correspondente, e uma sessão gravada
//! sem esse par é rejeitada quando alguém tenta retomá-la. Por isso o
//! cancelamento é cooperativo: o loop precisa saber que foi cancelado para
//! fechar o que abriu.

use std::sync::Arc;

use tokio::sync::watch;

/// Sinal compartilhado entre quem cancela e quem observa.
///
/// Clonar dá outra ponta do mesmo sinal, não um sinal novo.
#[derive(Debug, Clone)]
pub struct Cancel {
    // O `Arc` sobre o emissor é o que garante que [`Cancel::cancelled`] só
    // resolve por cancelamento de verdade: enquanto existir um `Cancel`, existe
    // um emissor, e `wait_for` não retorna erro de canal fechado.
    tx: Arc<watch::Sender<bool>>,
    rx: watch::Receiver<bool>,
}

impl Default for Cancel {
    fn default() -> Self {
        Self::new()
    }
}

impl Cancel {
    #[must_use]
    pub fn new() -> Self {
        let (tx, rx) = watch::channel(false);
        Self {
            tx: Arc::new(tx),
            rx,
        }
    }

    /// Dispara o sinal. Idempotente.
    pub fn cancel(&self) {
        // O envio só falha se não houver receptores, e `self` é um deles.
        let _ = self.tx.send(true);
    }

    /// Devolve o sinal ao estado intacto, para o turno seguinte. Idempotente.
    ///
    /// Cancelar é do turno, não da sessão
    /// ([ADR-0015](../../../docs/architecture/decisions/0015-o-cancelamento-e-por-turno.md)).
    /// Sem rearme o sinal fica preso depois do primeiro Ctrl+C, e todo pedido
    /// seguinte é aceito, gravado no disco e descartado antes de chegar ao
    /// gateway — sem resposta e sem erro.
    ///
    /// Como todas as pontas são clones do mesmo emissor, rearmar aqui restaura
    /// a sessão e o agente de uma vez.
    pub fn rearm(&self) {
        let _ = self.tx.send(false);
    }

    #[must_use]
    pub fn is_cancelled(&self) -> bool {
        *self.rx.borrow()
    }

    /// Resolve quando o sinal dispara, imediatamente se já disparou.
    pub async fn cancelled(&self) {
        let mut rx = self.rx.clone();
        // `wait_for` confere o valor corrente antes de esperar por mudança, o
        // que fecha a janela entre checar e aguardar. Um `changed()` puro
        // perderia um cancelamento que chegasse nesse intervalo.
        let _ = rx.wait_for(|flagged| *flagged).await;
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
mod tests {
    use std::time::Duration;

    use super::*;

    #[tokio::test]
    async fn a_fresh_signal_is_not_cancelled() {
        let cancel = Cancel::new();
        assert!(!cancel.is_cancelled());

        // `cancelled()` de um sinal intacto nunca resolve; o timeout é o que
        // distingue "esperando" de "resolveu na hora".
        let waited = tokio::time::timeout(Duration::from_millis(20), cancel.cancelled()).await;
        assert!(waited.is_err(), "esperava seguir aguardando");
    }

    #[tokio::test]
    async fn cancelling_one_clone_signals_every_other() {
        let cancel = Cancel::new();
        let clone = cancel.clone();

        clone.cancel();

        assert!(cancel.is_cancelled());
        tokio::time::timeout(Duration::from_millis(20), cancel.cancelled())
            .await
            .expect("esperava resolver depois do cancelamento");
    }

    #[tokio::test]
    async fn waiting_resolves_when_the_signal_arrives_later() {
        let cancel = Cancel::new();
        let trigger = cancel.clone();

        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(5)).await;
            trigger.cancel();
        });

        tokio::time::timeout(Duration::from_millis(500), cancel.cancelled())
            .await
            .expect("esperava acordar com o sinal");
    }

    #[tokio::test]
    async fn cancelling_twice_is_harmless() {
        let cancel = Cancel::new();
        cancel.cancel();
        cancel.cancel();
        assert!(cancel.is_cancelled());
    }

    #[tokio::test]
    async fn a_signal_that_already_fired_resolves_without_waiting() {
        let cancel = Cancel::new();
        cancel.cancel();

        // Sem a checagem do valor corrente em `wait_for`, este caso ficaria
        // pendurado esperando uma mudança que já aconteceu.
        tokio::time::timeout(Duration::from_millis(20), cancel.cancelled())
            .await
            .expect("esperava resolver de imediato");
    }

    #[tokio::test]
    async fn a_rearmed_signal_is_intact_again() {
        // Sem isto o primeiro Ctrl+C valeria para a sessao inteira.
        let cancel = Cancel::new();
        cancel.cancel();
        assert!(cancel.is_cancelled());

        cancel.rearm();

        assert!(!cancel.is_cancelled());
        let waited = tokio::time::timeout(Duration::from_millis(20), cancel.cancelled()).await;
        assert!(waited.is_err(), "esperava seguir aguardando");
    }

    #[test]
    fn rearming_reaches_every_clone_of_the_signal() {
        // A sessao e o agente seguram pontas diferentes do mesmo sinal; rearmar
        // uma que nao alcancasse a outra deixaria o agente preso.
        let cancel = Cancel::new();
        let clone = cancel.clone();
        cancel.cancel();

        clone.rearm();

        assert!(!cancel.is_cancelled());
        assert!(!clone.is_cancelled());
    }

    #[test]
    fn rearming_an_intact_signal_is_harmless() {
        let cancel = Cancel::new();
        cancel.rearm();
        assert!(!cancel.is_cancelled());
    }

    #[test]
    fn the_default_signal_is_the_intact_one() {
        assert!(!Cancel::default().is_cancelled());
    }
}
