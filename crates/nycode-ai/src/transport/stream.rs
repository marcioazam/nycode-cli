//! Projeção de um corpo SSE em eventos canônicos.

use eventsource_stream::Event as SseEvent;
use futures_util::{Stream, StreamExt};

use crate::dialect::StreamDecoder;
use crate::error::{Error, Result};
use crate::event::StreamEvent;

/// Como uma falha do transporte que cortou o corpo SSE deve ser projetada.
///
/// O erro do stream bruto é do `reqwest`, e [`decode`] é genérico sobre ele para
/// poder ser exercitado sem rede. Este trait é o que permite distinguir um
/// gateway que ficou mudo de um corpo que veio quebrado, sem amarrar a projeção
/// ao `reqwest`.
pub trait TransportFailure {
    /// Se a falha foi o gateway parar de enviar, e não o corpo vir quebrado.
    fn is_idle(&self) -> bool;
    /// Descrição para quem não é o caso de ociosidade.
    fn describe(&self) -> String;
}

/// Estado carregado entre iterações do stream.
struct State<S> {
    events: S,
    decoder: Box<dyn StreamDecoder>,
    bytes: usize,
    finished: bool,
}

/// Converte o stream SSE bruto em eventos canônicos.
///
/// O fim do corpo HTTP sem o encerramento do dialeto vira
/// [`Error::TruncatedStream`] em vez de um fim silencioso. Este é o modo de
/// falha que mais importa: a conexão cai depois de alguns deltas e um cliente
/// ingênuo entrega o texto parcial como se fosse a resposta.
///
/// O gateway que aceita a conexão e para de enviar é caso próprio,
/// [`Error::StreamIdle`], porque a causa e o que fazer a respeito são outros.
pub fn decode<S, E>(
    events: S,
    decoder: Box<dyn StreamDecoder>,
) -> impl Stream<Item = Result<StreamEvent>> + Send
where
    S: Stream<Item = std::result::Result<SseEvent, E>> + Send + Unpin,
    E: TransportFailure + Send,
{
    futures_util::stream::unfold(
        State {
            events,
            decoder,
            bytes: 0,
            finished: false,
        },
        |mut state| async move {
            loop {
                if state.finished {
                    return None;
                }
                match state.events.next().await {
                    Some(Ok(sse)) => {
                        state.bytes += sse.data.len();
                        match state.decoder.decode(&sse.data) {
                            Ok(Some(event)) => return Some((Ok(event), state)),
                            // Evento sem correspondencia observavel, como `ping`.
                            Ok(None) => {}
                            Err(err) => {
                                state.finished = true;
                                return Some((Err(err), state));
                            }
                        }
                    }
                    Some(Err(err)) => {
                        state.finished = true;
                        let failure = if err.is_idle() {
                            Error::StreamIdle { bytes: state.bytes }
                        } else {
                            Error::MalformedStream(err.describe())
                        };
                        return Some((Err(failure), state));
                    }
                    None => {
                        state.finished = true;
                        if state.decoder.completed() {
                            // O dialeto pode ter guardado um evento que só cabe
                            // depois do encerramento — no `responses`, o usage.
                            let trailing = state.decoder.trailing();
                            return trailing.map(|event| (Ok(event), state));
                        }
                        return Some((Err(Error::TruncatedStream { bytes: state.bytes }), state));
                    }
                }
            }
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::anthropic::Messages;
    use crate::dialect::Dialect;
    use crate::event::StopReason;

    fn sse(data: &str) -> SseEvent {
        SseEvent {
            event: "message".to_owned(),
            data: data.to_owned(),
            id: String::new(),
            retry: None,
        }
    }

    /// Como o corpo SSE foi interrompido.
    #[derive(Debug)]
    enum Cut {
        /// O gateway parou de enviar.
        Idle,
        Broken(&'static str),
    }

    impl TransportFailure for Cut {
        fn is_idle(&self) -> bool {
            matches!(self, Self::Idle)
        }
        fn describe(&self) -> String {
            match self {
                Self::Idle => "ocioso".to_owned(),
                Self::Broken(msg) => (*msg).to_owned(),
            }
        }
    }

    fn feed(events: Vec<SseEvent>) -> Vec<std::result::Result<SseEvent, Cut>> {
        events.into_iter().map(Ok).collect()
    }

    #[tokio::test]
    async fn a_complete_stream_ends_without_error() {
        let raw = futures_util::stream::iter(feed(vec![
            sse(r#"{"type":"message_start","message":{"id":"m"}}"#),
            sse(
                r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"oi"}}"#,
            ),
            sse(r#"{"type":"message_delta","delta":{"stop_reason":"end_turn"}}"#),
            sse(r#"{"type":"message_stop"}"#),
        ]));

        let events: Result<Vec<_>> = decode(raw, Messages.decoder())
            .collect::<Vec<_>>()
            .await
            .into_iter()
            .collect();
        let events = events.expect("stream completo nao deveria falhar");

        assert_eq!(
            events.first(),
            Some(&StreamEvent::MessageStart { id: "m".to_owned() })
        );
        assert!(events.contains(&StreamEvent::MessageEnd {
            stop_reason: StopReason::EndTurn
        }));
    }

    #[tokio::test]
    async fn a_stream_cut_short_reports_truncation_instead_of_succeeding() {
        let raw = futures_util::stream::iter(feed(vec![
            sse(r#"{"type":"message_start","message":{"id":"m"}}"#),
            sse(
                r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"parc"}}"#,
            ),
        ]));

        let events: Vec<_> = decode(raw, Messages.decoder()).collect().await;
        match events.last() {
            Some(Err(Error::TruncatedStream { bytes })) => assert!(*bytes > 0),
            other => panic!("esperado TruncatedStream, veio {other:?}"),
        }
    }

    #[tokio::test]
    async fn nothing_is_emitted_after_an_in_band_error() {
        let raw = futures_util::stream::iter(feed(vec![
            sse(r#"{"type":"message_start","message":{"id":"m"}}"#),
            sse(r#"{"type":"error","error":{"type":"overloaded_error","message":"cheio"}}"#),
            sse(
                r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"invisivel"}}"#,
            ),
        ]));

        let events: Vec<_> = decode(raw, Messages.decoder()).collect().await;
        assert_eq!(
            events.len(),
            2,
            "nada pode ser emitido depois do erro in-band"
        );
        assert!(matches!(events[1], Err(Error::Api(_))));
    }

    #[tokio::test]
    async fn a_transport_error_mid_stream_surfaces_as_malformed() {
        let raw = futures_util::stream::iter(vec![
            Ok(sse(r#"{"type":"message_start","message":{"id":"m"}}"#)),
            Err(Cut::Broken("conexao caiu")),
        ]);

        let events: Vec<_> = decode(raw, Messages.decoder()).collect().await;
        match events.last() {
            Some(Err(Error::MalformedStream(msg))) => assert!(msg.contains("conexao caiu")),
            other => panic!("esperado MalformedStream, veio {other:?}"),
        }
    }

    #[tokio::test]
    async fn the_responses_dialect_delivers_its_usage_before_the_stream_ends() {
        // Neste dialeto o usage so cabe depois do encerramento; se o laco nao o
        // drenar, a contagem do turno inteiro sai zerada.
        let raw = futures_util::stream::iter(feed(vec![sse(
            r#"{"type":"response.completed","response":{"usage":{"input_tokens":7,"output_tokens":3}}}"#,
        )]));

        let events: Result<Vec<_>> = decode(raw, crate::openai::Responses.decoder())
            .collect::<Vec<_>>()
            .await
            .into_iter()
            .collect();
        let events = events.expect("stream completo nao deveria falhar");

        let usage = events.iter().find_map(|event| match event {
            StreamEvent::Usage(usage) => Some(*usage),
            _ => None,
        });
        let usage = usage.expect("o usage precisa chegar ao consumidor");
        assert_eq!(usage.input_tokens, 7);
        assert_eq!(usage.output_tokens, 3);
    }

    #[tokio::test]
    async fn a_gateway_that_goes_silent_is_reported_as_idle_not_as_malformed() {
        // O corpo nao veio quebrado nem terminou: o gateway parou de falar.
        // Achatar isto em `MalformedStream` mandaria o usuario depurar o
        // conteudo do stream em vez da conexao.
        let raw = futures_util::stream::iter(vec![
            Ok(sse(r#"{"type":"message_start","message":{"id":"m"}}"#)),
            Err(Cut::Idle),
        ]);

        let events: Vec<_> = decode(raw, Messages.decoder()).collect().await;
        match events.last() {
            Some(Err(Error::StreamIdle { bytes })) => assert!(*bytes > 0),
            other => panic!("esperado StreamIdle, veio {other:?}"),
        }
    }

    #[tokio::test]
    async fn an_idle_stream_is_not_retried() {
        // Quando a ociosidade acontece o turno ja abriu, e ferramentas podem ter
        // rodado; repetir duplicaria efeito colateral.
        assert!(!Error::StreamIdle { bytes: 12 }.is_retryable());
    }

    #[tokio::test]
    async fn dropping_the_stream_mid_turn_is_a_clean_cancellation() {
        // Cancelamento no Rust e o drop. Se o stream guardasse estado global ou
        // exigisse encerramento explicito, abandonar um turno vazaria recurso.
        let raw = futures_util::stream::iter(feed(vec![
            sse(r#"{"type":"message_start","message":{"id":"m"}}"#),
            sse(
                r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"a"}}"#,
            ),
            sse(
                r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"b"}}"#,
            ),
        ]));

        let mut stream = Box::pin(decode(raw, Messages.decoder()));
        let first = stream.next().await;
        assert!(matches!(first, Some(Ok(StreamEvent::MessageStart { .. }))));
        drop(stream);
    }
}
