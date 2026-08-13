//! Vocabulário canônico de eventos de stream.
//!
//! Todo dialeto de wire é projetado neste tipo antes de chegar ao agente. O
//! ponto de NFR-4 vive aqui: a projeção preserva o que o gateway emitiu em vez
//! de achatá-lo. Um `stop_reason` desconhecido vira [`StopReason::Unrecognized`]
//! carregando o literal, nunca um `EndTurn` inventado.

use std::fmt;

/// Razão pela qual um turno terminou.
///
/// O gateway normaliza cada backend para um vocabulário fechado e documenta que
/// um bloqueio de segurança nunca chega como `end_turn` — ele chega como
/// `refusal` no dialeto Anthropic e `content_filter` no OpenAI. Manter os dois
/// distintos de `EndTurn` é o que permite ao chamador diferenciar uma resposta
/// concluída de uma resposta bloqueada.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StopReason {
    /// O modelo terminou naturalmente.
    EndTurn,
    /// Bateu no teto de tokens de saída, ou a janela de contexto estourou.
    MaxTokens,
    /// Uma sequência de parada configurada foi emitida.
    StopSequence,
    /// O modelo quer executar ferramentas e aguarda os resultados.
    ToolUse,
    /// Bloqueio de segurança. Distinto de [`StopReason::EndTurn`] por contrato.
    Refusal,
    /// Turno pausado pelo backend, retomável.
    PauseTurn,
    /// Fora do vocabulário conhecido, preservada literalmente.
    ///
    /// Degradar isto para `EndTurn` faria uma falha parecer sucesso, que é
    /// exatamente o que NFR-4 proíbe.
    Unrecognized(String),
}

impl StopReason {
    /// Projeta o `stop_reason` do dialeto Anthropic Messages.
    #[must_use]
    pub fn from_anthropic(raw: &str) -> Self {
        match raw {
            "end_turn" => Self::EndTurn,
            // O gateway documenta `model_context_window_exceeded` como um
            // sinônimo de estouro de limite no dialeto Anthropic.
            "max_tokens" | "model_context_window_exceeded" => Self::MaxTokens,
            "stop_sequence" => Self::StopSequence,
            "tool_use" => Self::ToolUse,
            "refusal" => Self::Refusal,
            "pause_turn" => Self::PauseTurn,
            other => Self::Unrecognized(other.to_owned()),
        }
    }

    /// Projeta o `finish_reason` do dialeto OpenAI Chat Completions.
    #[must_use]
    pub fn from_openai(raw: &str) -> Self {
        match raw {
            "stop" => Self::EndTurn,
            "length" => Self::MaxTokens,
            "tool_calls" | "function_call" => Self::ToolUse,
            "content_filter" => Self::Refusal,
            other => Self::Unrecognized(other.to_owned()),
        }
    }

    /// Se o turno terminou porque o modelo pediu execução de ferramentas.
    #[must_use]
    pub const fn wants_tools(&self) -> bool {
        matches!(self, Self::ToolUse)
    }

    /// Se o turno terminou de forma que impede continuar sem intervenção.
    #[must_use]
    pub const fn is_terminal_failure(&self) -> bool {
        matches!(self, Self::Refusal | Self::MaxTokens)
    }
}

impl fmt::Display for StopReason {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EndTurn => f.write_str("end_turn"),
            Self::MaxTokens => f.write_str("max_tokens"),
            Self::StopSequence => f.write_str("stop_sequence"),
            Self::ToolUse => f.write_str("tool_use"),
            Self::Refusal => f.write_str("refusal"),
            Self::PauseTurn => f.write_str("pause_turn"),
            Self::Unrecognized(raw) => write!(f, "unrecognized({raw})"),
        }
    }
}

/// Contabilidade de tokens de um turno.
///
/// Serializável porque o modo de eventos JSON a publica e o harness de paridade
/// a lê de volta: sem isso a contabilidade de tokens ficaria fora da comparação.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Usage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    /// Subconjunto de `input_tokens` servido de cache. Nunca soma ao total.
    pub cache_read_tokens: u64,
    /// Tokens gravados em cache neste turno. Nunca soma ao total.
    pub cache_write_tokens: u64,
    /// Subconjunto de `output_tokens` gasto em raciocínio. Nunca soma ao total.
    pub reasoning_tokens: u64,
    /// O gateway sinaliza contagem heurística via `x-nylla-usage-estimated`.
    ///
    /// Propagar isto é o que impede um número estimado de ser apresentado como
    /// medido — o gateway usa uma heurística de caracteres divididos por quatro
    /// quando o backend não reporta usage.
    pub estimated: bool,
}

/// Um evento normalizado do stream de resposta.
#[derive(Debug, Clone, PartialEq)]
pub enum StreamEvent {
    /// Início da mensagem do assistente.
    MessageStart { id: String },
    /// Fragmento de texto visível.
    TextDelta(String),
    /// Fragmento de raciocínio, quando o backend o expõe em canal separado.
    ReasoningDelta(String),
    /// O modelo começou a emitir uma chamada de ferramenta.
    ToolCallStart { id: String, name: String },
    /// Fragmento dos argumentos JSON de uma chamada em andamento.
    ToolCallDelta { id: String, json_fragment: String },
    /// A chamada de ferramenta está completa.
    ToolCallEnd { id: String },
    /// Contabilidade do turno.
    Usage(Usage),
    /// Fim do turno.
    MessageEnd { stop_reason: StopReason },
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
mod tests {
    use super::*;

    #[test]
    fn anthropic_refusal_is_not_end_turn() {
        // O gateway garante que um bloqueio de seguranca nunca chega como
        // `end_turn`. Se esta projecao achatar `refusal` em `EndTurn`, o
        // chamador nao consegue distinguir resposta bloqueada de concluida.
        assert_eq!(StopReason::from_anthropic("refusal"), StopReason::Refusal);
        assert_ne!(StopReason::from_anthropic("refusal"), StopReason::EndTurn);
    }

    #[test]
    fn openai_content_filter_maps_to_refusal() {
        assert_eq!(
            StopReason::from_openai("content_filter"),
            StopReason::Refusal
        );
    }

    #[test]
    fn context_window_overflow_is_a_limit_not_a_natural_stop() {
        assert_eq!(
            StopReason::from_anthropic("model_context_window_exceeded"),
            StopReason::MaxTokens
        );
    }

    #[test]
    fn unknown_stop_reason_is_preserved_not_degraded() {
        // NFR-4: degradar para EndTurn faria uma falha parecer sucesso.
        let reason = StopReason::from_anthropic("some_future_reason");
        assert_eq!(
            reason,
            StopReason::Unrecognized("some_future_reason".to_owned())
        );
        assert_ne!(reason, StopReason::EndTurn);
        assert_eq!(reason.to_string(), "unrecognized(some_future_reason)");
    }

    #[test]
    fn unknown_openai_finish_reason_is_preserved() {
        assert_eq!(
            StopReason::from_openai("hypothetical"),
            StopReason::Unrecognized("hypothetical".to_owned())
        );
    }

    #[test]
    fn both_dialects_agree_on_the_canonical_vocabulary() {
        // Um turno que pede ferramentas precisa ser reconhecivel como tal
        // independentemente do dialeto que o entregou.
        assert_eq!(
            StopReason::from_anthropic("tool_use"),
            StopReason::from_openai("tool_calls")
        );
        assert_eq!(
            StopReason::from_anthropic("end_turn"),
            StopReason::from_openai("stop")
        );
        assert_eq!(
            StopReason::from_anthropic("max_tokens"),
            StopReason::from_openai("length")
        );
    }

    #[test]
    fn wants_tools_only_for_tool_use() {
        assert!(StopReason::ToolUse.wants_tools());
        for other in [
            StopReason::EndTurn,
            StopReason::MaxTokens,
            StopReason::StopSequence,
            StopReason::Refusal,
            StopReason::PauseTurn,
            StopReason::Unrecognized("x".to_owned()),
        ] {
            assert!(
                !other.wants_tools(),
                "{other} nao deveria pedir ferramentas"
            );
        }
    }

    #[test]
    fn terminal_failures_are_refusal_and_limit() {
        assert!(StopReason::Refusal.is_terminal_failure());
        assert!(StopReason::MaxTokens.is_terminal_failure());
        assert!(!StopReason::EndTurn.is_terminal_failure());
        assert!(!StopReason::ToolUse.is_terminal_failure());
    }

    #[test]
    fn cache_and_reasoning_are_subsets_never_added_to_totals() {
        // O gateway documenta que detalhes de cache e reasoning sao subconjuntos
        // dos totais e nunca os alteram. O tipo carrega os dois separadamente
        // justamente para que somar seja um erro visivel, nao acidental.
        let usage = Usage {
            input_tokens: 1000,
            output_tokens: 200,
            cache_read_tokens: 800,
            reasoning_tokens: 150,
            ..Usage::default()
        };
        assert_eq!(usage.input_tokens, 1000);
        assert!(usage.cache_read_tokens <= usage.input_tokens);
        assert!(usage.reasoning_tokens <= usage.output_tokens);
        assert!(!usage.estimated);
    }
}
