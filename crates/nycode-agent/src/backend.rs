//! Abstração do backend de modelo.
//!
//! O loop de agente depende deste trait, não do cliente HTTP concreto. É o que
//! permite testar o loop — reentrada de ferramenta, teto de iterações,
//! propagação de recusa — sem rede e sem servidor de mentira.

use async_trait::async_trait;
use futures_util::stream::BoxStream;
use nycode_ai::anthropic::{Message, ToolSpec};
use nycode_ai::{Client, StreamEvent};

/// Stream de eventos de um turno.
pub type EventStream = BoxStream<'static, nycode_ai::Result<StreamEvent>>;

#[async_trait]
pub trait Backend: Send + Sync {
    async fn stream(
        &self,
        messages: Vec<Message>,
        system: Option<String>,
        tools: Vec<ToolSpec>,
    ) -> nycode_ai::Result<EventStream>;

    /// Um pedido de uma vez só, fora da conversa.
    ///
    /// Separado de [`Backend::stream`] porque a amostragem difere: o que vai
    /// aqui não é prefixo de nada e não se repete no turno seguinte, então
    /// marcá-lo para o cache paga escrita que ninguém vai reusar. Sem
    /// ferramenta pela mesma razão — quem pede um resumo não quer que o modelo
    /// vá ler arquivo.
    ///
    /// O padrão delega ao `stream`, para que um backend de teste não precise
    /// saber da distinção.
    async fn oneshot(
        &self,
        messages: Vec<Message>,
        system: Option<String>,
    ) -> nycode_ai::Result<EventStream> {
        self.stream(messages, system, Vec::new()).await
    }
}

#[async_trait]
impl Backend for Client {
    async fn stream(
        &self,
        messages: Vec<Message>,
        system: Option<String>,
        tools: Vec<ToolSpec>,
    ) -> nycode_ai::Result<EventStream> {
        let stream = Client::stream(self, messages, system, tools).await?;
        Ok(Box::pin(stream))
    }

    async fn oneshot(
        &self,
        messages: Vec<Message>,
        system: Option<String>,
    ) -> nycode_ai::Result<EventStream> {
        // O cache desligado é o ponto: um resumo é conteúdo de uso único, e
        // marcá-lo cobraria escrita de cache sobre um prefixo que o próximo
        // turno não vai reencontrar.
        let solo = self.sampling().clone().without_cache();
        let stream = Client::stream_with(self, messages, system, Vec::new(), solo).await?;
        Ok(Box::pin(stream))
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
pub(crate) mod fake {
    use std::sync::Mutex;

    use super::{Backend, EventStream, Message, ToolSpec};
    use async_trait::async_trait;
    use nycode_ai::StreamEvent;

    /// Backend que devolve turnos pré-programados, um por chamada.
    ///
    /// Guarda as mensagens recebidas para que os testes possam afirmar sobre o
    /// que o loop realmente mandou de volta ao modelo.
    pub struct FakeBackend {
        turns: Mutex<Vec<Vec<StreamEvent>>>,
        pub seen: Mutex<Vec<Vec<Message>>>,
        /// Prompt de sistema e catálogo da última chamada.
        ///
        /// Gravados porque um subagente se distingue do pai justamente por
        /// eles: mesma conversa, outro sistema e outro conjunto de ferramentas.
        context: Mutex<(Option<String>, Vec<ToolSpec>)>,
        failure: Mutex<Option<nycode_ai::Error>>,
        /// O que um pedido de uma vez só responde.
        ///
        /// Fila própria, e não a dos turnos: o resumo da compactação é uma
        /// chamada a mais, e servi-lo da mesma fila deslocaria os turnos que o
        /// teste programou para o laço. Vazio significa "não respondeu", que é
        /// o caminho de degradação que a compactação já trata.
        oneshot: Mutex<Option<String>>,
    }

    impl FakeBackend {
        pub fn new(turns: Vec<Vec<StreamEvent>>) -> Self {
            Self {
                turns: Mutex::new(turns.into_iter().rev().collect()),
                seen: Mutex::new(Vec::new()),
                context: Mutex::new((None, Vec::new())),
                failure: Mutex::new(None),
                oneshot: Mutex::new(None),
            }
        }

        pub fn failing(err: nycode_ai::Error) -> Self {
            Self {
                turns: Mutex::new(Vec::new()),
                seen: Mutex::new(Vec::new()),
                context: Mutex::new((None, Vec::new())),
                failure: Mutex::new(Some(err)),
                oneshot: Mutex::new(None),
            }
        }

        /// Falha na primeira chamada e serve os turnos a partir da segunda.
        ///
        /// É a forma de exercitar recuperação: um backend que só falha não
        /// distingue "tratou o erro" de "morreu no erro".
        pub fn failing_once(err: nycode_ai::Error, turns: Vec<Vec<StreamEvent>>) -> Self {
            Self {
                turns: Mutex::new(turns.into_iter().rev().collect()),
                seen: Mutex::new(Vec::new()),
                context: Mutex::new((None, Vec::new())),
                failure: Mutex::new(Some(err)),
                oneshot: Mutex::new(None),
            }
        }

        /// O que um pedido de uma vez só passa a responder.
        #[must_use]
        pub fn answering_oneshot(self, text: &str) -> Self {
            *self.oneshot.lock().unwrap() = Some(text.to_owned());
            self
        }

        /// Quantos turnos ainda não foram consumidos.
        pub fn remaining(&self) -> usize {
            self.turns.lock().unwrap().len()
        }

        pub fn call_count(&self) -> usize {
            self.seen.lock().unwrap().len()
        }

        /// Mensagens da última chamada.
        pub fn last_messages(&self) -> Vec<Message> {
            self.seen
                .lock()
                .unwrap()
                .last()
                .cloned()
                .unwrap_or_default()
        }

        /// Prompt de sistema da última chamada.
        pub fn last_system(&self) -> Option<String> {
            self.context.lock().unwrap().0.clone()
        }

        /// Ferramentas oferecidas na última chamada.
        pub fn last_tools(&self) -> Vec<String> {
            self.context
                .lock()
                .unwrap()
                .1
                .iter()
                .map(|spec| spec.name.clone())
                .collect()
        }
    }

    #[async_trait]
    impl Backend for FakeBackend {
        async fn stream(
            &self,
            messages: Vec<Message>,
            system: Option<String>,
            tools: Vec<ToolSpec>,
        ) -> nycode_ai::Result<EventStream> {
            self.seen.lock().unwrap().push(messages);
            *self.context.lock().unwrap() = (system, tools);

            if let Some(err) = self.failure.lock().unwrap().take() {
                return Err(err);
            }

            let turn = self.turns.lock().unwrap().pop().unwrap_or_default();
            Ok(Box::pin(futures_util::stream::iter(
                turn.into_iter().map(Ok),
            )))
        }

        /// Responde da fila própria, sem tocar na dos turnos.
        ///
        /// Servir o pedido de uma vez só da fila do laço deslocaria os turnos
        /// que o teste programou, e o teste passaria a medir a ordem em vez do
        /// que ele diz medir.
        async fn oneshot(
            &self,
            _messages: Vec<Message>,
            _system: Option<String>,
        ) -> nycode_ai::Result<EventStream> {
            let text = self.oneshot.lock().unwrap().clone();
            let eventos = text
                .map(|text| vec![StreamEvent::TextDelta(text)])
                .unwrap_or_default();
            Ok(Box::pin(futures_util::stream::iter(
                eventos.into_iter().map(Ok),
            )))
        }
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
mod tests {
    use super::fake::FakeBackend;
    use super::*;
    use futures_util::StreamExt;
    use nycode_ai::StopReason;

    #[tokio::test]
    async fn the_fake_serves_turns_in_order_and_records_calls() {
        let backend = FakeBackend::new(vec![
            vec![StreamEvent::TextDelta("primeiro".into())],
            vec![StreamEvent::MessageEnd {
                stop_reason: StopReason::EndTurn,
            }],
        ]);

        let first: Vec<_> = backend
            .stream(vec![Message::user("a")], None, vec![])
            .await
            .unwrap()
            .collect()
            .await;
        assert_eq!(first.len(), 1);
        assert_eq!(backend.remaining(), 1);

        let second: Vec<_> = backend
            .stream(vec![Message::user("b")], None, vec![])
            .await
            .unwrap()
            .collect()
            .await;
        assert!(matches!(
            second[0],
            Ok(StreamEvent::MessageEnd {
                stop_reason: StopReason::EndTurn
            })
        ));
        assert_eq!(backend.call_count(), 2);
        assert_eq!(backend.last_messages(), vec![Message::user("b")]);
    }

    #[tokio::test]
    async fn the_fake_can_reproduce_a_transport_failure() {
        let backend = FakeBackend::failing(nycode_ai::Error::TruncatedStream { bytes: 3 });
        // `expect_err` exigiria `Debug` no lado Ok, e um `BoxStream` nao tem.
        match backend.stream(vec![], None, vec![]).await {
            Err(nycode_ai::Error::TruncatedStream { bytes }) => assert_eq!(bytes, 3),
            Err(other) => panic!("erro inesperado: {other:?}"),
            Ok(_) => panic!("deveria falhar"),
        }
    }
}
