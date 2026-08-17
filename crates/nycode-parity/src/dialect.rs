//! O stream de eventos de um harness, lido no vocabulário dele.
//!
//! Separado de [`crate::runner`] porque muda por outro motivo: aquele muda
//! quando muda como um harness é executado e como o disco é fotografado, e isto
//! muda quando um dos dois harnesses muda o que publica em `stdout`.
//!
//! Traduzir aqui é o que permite comparar contrato observável em vez de formato
//! de saída — o formato divergir não é o defeito que o NFR-6 quer pegar.

use crate::transcript::{TokenAccounting, ToolInvocation};

/// Como ler o stream de eventos de um harness.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Events {
    /// Etiqueta `type`, com `tool_start` e `result`.
    Nycode,
    /// Etiqueta `type`, com `tool_execution_start` e `message_end`.
    ///
    /// O vocabulário vem do `--mode json` da referência, documentado em
    /// `packages/coding-agent/docs/json.md`, e **não** do formato de fio da
    /// Anthropic. Os dois se parecem o bastante para enganar: a Anthropic tem um
    /// bloco de conteúdo `tool_use` com `name` e `input`, e a referência tem um
    /// evento de stream `tool_execution_start` com `toolName` e `args`. Ler o
    /// primeiro contra a segunda não produz divergência de comportamento —
    /// produz duas das cinco dimensões sempre vazias, em toda execução.
    Reference,
    /// O harness não publica eventos; as duas dimensões ficam vazias.
    None,
}

/// O que o stream de eventos revelou.
#[derive(Debug, Default)]
pub struct Observed {
    pub tools: Vec<ToolInvocation>,
    pub tokens: TokenAccounting,
    pub stop_reason: Option<String>,
    pub error: Option<String>,
}

/// Lê o NDJSON de um harness no dialeto dele.
///
/// Uma linha que não é JSON é ignorada em vez de derrubar a comparação: um
/// harness pode escrever prosa em stdout antes do primeiro evento, e isso não é
/// divergência de contrato.
#[must_use]
pub fn read_events(stdout: &str, dialect: Events) -> Observed {
    let mut observed = Observed::default();
    if dialect == Events::None {
        return observed;
    }

    for line in stdout.lines() {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        let Some(kind) = value.get("type").and_then(serde_json::Value::as_str) else {
            continue;
        };

        match (dialect, kind) {
            (Events::Nycode, "tool_start") | (Events::Reference, "tool_execution_start") => {
                absorb_tool(&mut observed, dialect, &value);
            }
            // O evento de fechamento tem nome diferente em cada dialeto e o
            // mesmo conteúdo: o motivo da parada e a contabilidade do turno. Na
            // referência os dois moram dentro de `message`, e não na raiz.
            (Events::Nycode, "result") | (Events::Reference, "message_end") => {
                absorb_closing(&mut observed, dialect, &value);
            }
            (_, "error") => {
                observed.error = value
                    .get("message")
                    .or_else(|| value.get("error"))
                    .and_then(serde_json::Value::as_str)
                    .map(ToOwned::to_owned);
            }
            _ => {}
        }
    }
    observed
}

fn absorb_tool(observed: &mut Observed, dialect: Events, value: &serde_json::Value) {
    let (named, argued) = if dialect == Events::Reference {
        ("toolName", "args")
    } else {
        ("name", "input")
    };
    if let Some(name) = value.get(named).and_then(serde_json::Value::as_str) {
        let arguments = value
            .get(argued)
            .cloned()
            .unwrap_or(serde_json::Value::Null);
        observed.tools.push(ToolInvocation::new(name, &arguments));
    }
}

fn absorb_closing(observed: &mut Observed, dialect: Events, value: &serde_json::Value) {
    let carrier = if dialect == Events::Reference {
        value.get("message").unwrap_or(value)
    } else {
        value
    };
    let stop = if dialect == Events::Reference {
        "stopReason"
    } else {
        "stop_reason"
    };
    observed.stop_reason = carrier
        .get(stop)
        .and_then(serde_json::Value::as_str)
        .map(|raw| translate_stop_reason(dialect, raw));
    add_usage(
        &mut observed.tokens,
        read_usage(dialect, carrier.get("usage")),
    );
}

fn add_usage(into: &mut TokenAccounting, add: TokenAccounting) {
    into.input = into.input.saturating_add(add.input);
    into.output = into.output.saturating_add(add.output);
    into.estimated |= add.estimated;
}

/// Traduz o motivo da parada para o vocabulário desta comparação.
///
/// A referência tem cinco valores e nós temos outros; comparar as duas grafias
/// verbatim marcaria divergência em toda execução bem-sucedida, que é comparar
/// formato e não contrato.
///
/// Um valor fora do vocabulário conhecido passa inteiro em vez de virar
/// `end_turn`. Achatá-lo esconderia exatamente a mudança de comportamento que
/// esta comparação existe para pegar, e é a mesma regra que o nosso próprio
/// stream já segue com `StopReason::Unrecognized`.
#[must_use]
pub fn translate_stop_reason(dialect: Events, raw: &str) -> String {
    if dialect != Events::Reference {
        return raw.to_owned();
    }
    match raw {
        "stop" => "end_turn",
        "length" => "max_tokens",
        "toolUse" => "tool_use",
        "aborted" => "refusal",
        other => other,
    }
    .to_owned()
}

/// Projeta a contabilidade de tokens de um evento.
///
/// Os nomes divergem: `input_tokens` e `output_tokens` do nosso lado, `input` e
/// `output` do lado da referência.
fn read_usage(dialect: Events, usage: Option<&serde_json::Value>) -> TokenAccounting {
    let Some(usage) = usage else {
        return TokenAccounting::default();
    };
    let number = |name: &str| usage.get(name).and_then(serde_json::Value::as_u64);
    let (input, output) = if dialect == Events::Reference {
        ("input", "output")
    } else {
        ("input_tokens", "output_tokens")
    };

    TokenAccounting {
        input: number(input).unwrap_or(0),
        output: number(output).unwrap_or(0),
        estimated: usage
            .get("estimated")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false),
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
mod tests {
    use super::*;

    /// Uma execução da referência, no formato que ela documenta.
    ///
    /// As linhas vêm de `packages/coding-agent/docs/json.md` e
    /// `packages/coding-agent/docs/session-format.md` da referência, e não de um
    /// formato inventado aqui. É a diferença que importa: o dialeto anterior
    /// tinha dezoito testes internamente consistentes com um vocabulário que a
    /// referência nunca emitiu, e nenhum deles podia perceber isso.
    const REFERENCE_TRANSCRIPT: &str = concat!(
        r#"{"type":"agent_start"}"#,
        "\n",
        r#"{"type":"message_start","message":{"role":"assistant","content":[]}}"#,
        "\n",
        r#"{"type":"tool_execution_start","toolCallId":"tc_1","toolName":"read","args":{"path":"a.txt"}}"#,
        "\n",
        r#"{"type":"tool_execution_end","toolCallId":"tc_1","toolName":"read","result":"ok","isError":false}"#,
        "\n",
        r#"{"type":"message_end","message":{"role":"assistant","content":[],"provider":"anthropic","model":"m","usage":{"input":120,"output":34,"cacheRead":0,"cacheWrite":0},"stopReason":"stop"}}"#,
        "\n",
    );

    #[test]
    fn the_reference_tool_call_is_read_from_the_event_the_reference_actually_emits() {
        // O defeito que este teste fecha: o dialeto lia `tool_use` com `name` e
        // `input`, que e o bloco de conteudo da Anthropic, contra um harness que
        // emite `tool_execution_start` com `toolName` e `args`. A dimensao de
        // sequencia de ferramentas ficava vazia em toda execucao.
        let observed = read_events(REFERENCE_TRANSCRIPT, Events::Reference);

        assert_eq!(observed.tools.len(), 1, "{:?}", observed.tools);
        assert_eq!(observed.tools[0].name, "read");
    }

    #[test]
    fn the_reference_token_accounting_is_read_from_inside_the_message() {
        // `usage` mora dentro de `message` e usa `input`/`output`, nao
        // `input_tokens`/`output_tokens` na raiz. Lido errado, a dimensao dava
        // 0/0 e divergia por motivo estrutural em toda execucao.
        let observed = read_events(REFERENCE_TRANSCRIPT, Events::Reference);

        assert_eq!(observed.tokens.input, 120);
        assert_eq!(observed.tokens.output, 34);
        assert!(!observed.tokens.estimated);
    }

    #[test]
    fn the_reference_usage_is_summed_across_assistant_turns() {
        // A referência publica um `message_end` por resposta do assistente, com
        // o usage daquela rodada. O candidato publica um `result` com a soma do
        // turno. Comparar o último evento dela com o acumulado dele acusava
        // 1234 contra 2468 em todo turno de ferramenta — formato, não contrato.
        let stdout = concat!(
            r#"{"type":"message_end","message":{"stopReason":"toolUse","usage":{"input":1234,"output":56}}}"#,
            "\n",
            r#"{"type":"message_end","message":{"stopReason":"stop","usage":{"input":1234,"output":56}}}"#,
            "\n",
        );
        let observed = read_events(stdout, Events::Reference);
        assert_eq!(observed.tokens.input, 2468);
        assert_eq!(observed.tokens.output, 112);
        assert_eq!(observed.stop_reason.as_deref(), Some("end_turn"));
    }

    #[test]
    fn the_reference_stop_reason_is_translated_instead_of_compared_verbatim() {
        // A referencia diz `stop` onde nos dizemos `end_turn`. Comparar as duas
        // grafias marcaria divergencia em toda execucao bem-sucedida, que e
        // comparar formato e nao contrato.
        let observed = read_events(REFERENCE_TRANSCRIPT, Events::Reference);

        assert_eq!(observed.stop_reason.as_deref(), Some("end_turn"));
    }

    #[test]
    fn every_stop_reason_the_reference_declares_has_a_translation() {
        // O vocabulario esta em `docs/session-format.md` da referencia. Um valor
        // novo dela nao pode virar `end_turn` em silencio.
        for (referencia, nosso) in [
            ("stop", "end_turn"),
            ("length", "max_tokens"),
            ("toolUse", "tool_use"),
            ("error", "error"),
            ("aborted", "refusal"),
        ] {
            assert_eq!(translate_stop_reason(Events::Reference, referencia), nosso);
        }
    }

    #[test]
    fn a_stop_reason_outside_the_vocabulary_survives_instead_of_being_flattened() {
        // Achatar para `end_turn` faria uma parada nova da referencia parecer um
        // turno normal, escondendo a mudanca que a comparacao existe para pegar.
        assert_eq!(
            translate_stop_reason(Events::Reference, "motivo_novo"),
            "motivo_novo"
        );
    }

    #[test]
    fn our_own_stop_reason_is_never_translated() {
        // A tabela e do lado da referencia. Aplica-la ao nosso lado reescreveria
        // o vocabulario que o nosso stream ja publica.
        assert_eq!(translate_stop_reason(Events::Nycode, "stop"), "stop");
    }

    #[test]
    fn our_own_dialect_still_reads_its_own_events() {
        // A correcao do lado da referencia nao pode ter mexido no nosso.
        let linhas = concat!(
            r#"{"type":"tool_start","name":"grep","input":{"pattern":"fn"}}"#,
            "\n",
            r#"{"type":"result","stop_reason":"end_turn","usage":{"input_tokens":7,"output_tokens":2}}"#,
            "\n",
        );

        let observed = read_events(linhas, Events::Nycode);

        assert_eq!(observed.tools.len(), 1);
        assert_eq!(observed.tools[0].name, "grep");
        assert_eq!(observed.tokens.input, 7);
        assert_eq!(observed.stop_reason.as_deref(), Some("end_turn"));
    }

    #[test]
    fn a_harness_without_a_stream_reveals_nothing_rather_than_guessing() {
        let observed = read_events(REFERENCE_TRANSCRIPT, Events::None);

        assert!(observed.tools.is_empty());
        assert_eq!(observed.stop_reason, None);
    }

    #[test]
    fn prose_before_the_first_event_is_not_a_divergence() {
        let linhas = concat!(
            "carregando o workspace...\n",
            r#"{"type":"tool_execution_start","toolCallId":"t","toolName":"ls","args":{}}"#,
            "\n",
        );

        let observed = read_events(linhas, Events::Reference);

        assert_eq!(observed.tools.len(), 1);
    }

    #[test]
    fn an_error_event_is_read_in_either_dialect() {
        let linha = r#"{"type":"error","message":"credencial ausente"}"#;

        for dialeto in [Events::Nycode, Events::Reference] {
            assert_eq!(
                read_events(linha, dialeto).error.as_deref(),
                Some("credencial ausente")
            );
        }
    }

    #[test]
    fn a_closing_event_without_usage_reports_zero_rather_than_failing() {
        let linha = r#"{"type":"message_end","message":{"stopReason":"stop"}}"#;

        let observed = read_events(linha, Events::Reference);

        assert_eq!(observed.tokens, TokenAccounting::default());
        assert_eq!(observed.stop_reason.as_deref(), Some("end_turn"));
    }

    #[test]
    fn the_nycode_stream_yields_the_tool_sequence_in_order() {
        let stdout = concat!(
            r#"{"type":"text","text":"vou ler"}"#,
            "\n",
            r#"{"type":"tool_start","name":"read","input":{"path":"a.rs"}}"#,
            "\n",
            r#"{"type":"tool_end","name":"read","is_error":false,"output":"x"}"#,
            "\n",
            r#"{"type":"tool_start","name":"bash","input":{"command":"ls"}}"#,
            "\n",
            r#"{"type":"result","stop_reason":"end_turn","usage":{"input_tokens":120,"output_tokens":30},"tool_rounds":2}"#,
            "\n",
        );

        let observed = read_events(stdout, Events::Nycode);

        let names: Vec<_> = observed.tools.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(names, vec!["read", "bash"]);
    }

    #[test]
    fn the_same_call_written_two_ways_is_not_a_divergence() {
        // Ordem de chaves difere entre serializadores, e os dois lados nomeiam o
        // campo de argumentos de forma diferente. Sem normalizar, toda execucao
        // acusaria divergencia falsa.
        let ny = read_events(
            r#"{"type":"tool_start","name":"write","input":{"path":"a","content":"b"}}"#,
            Events::Nycode,
        );
        let re = read_events(
            r#"{"type":"tool_execution_start","toolCallId":"t","toolName":"write","args":{"content":"b","path":"a"}}"#,
            Events::Reference,
        );

        assert_eq!(ny.tools, re.tools);
    }

    #[test]
    fn an_estimated_usage_survives_the_translation() {
        // Comparar um numero medido com um estimado como se fossem iguais e
        // exatamente o que o NFR-4 proibe.
        let observed = read_events(
            r#"{"type":"result","stop_reason":"end_turn","usage":{"input_tokens":10,"output_tokens":2,"estimated":true}}"#,
            Events::Nycode,
        );

        assert!(observed.tokens.estimated);
    }

    #[test]
    fn a_line_that_is_not_an_event_is_skipped_instead_of_failing() {
        let stdout = concat!(
            "carregando...\n",
            "{isto nao e json\n",
            r#"{"sem":"etiqueta"}"#,
            "\n",
            r#"{"type":"tool_start","name":"read","input":{}}"#,
            "\n",
        );

        let observed = read_events(stdout, Events::Nycode);

        assert_eq!(observed.tools.len(), 1);
    }

    #[test]
    fn a_stream_without_a_final_event_reports_no_stop_reason() {
        // Um harness morto no meio nao publica evento de fechamento. Quem deduz
        // do codigo de saida e o `runner`; aqui a ausencia precisa aparecer como
        // ausencia, e nao como `end_turn`.
        let observed = read_events(r#"{"type":"text","text":"parcial"}"#, Events::Nycode);

        assert_eq!(observed.stop_reason, None);
    }

    #[test]
    fn our_own_result_without_usage_reports_zero_rather_than_failing() {
        let observed = read_events(
            r#"{"type":"result","stop_reason":"end_turn"}"#,
            Events::Nycode,
        );

        assert_eq!(observed.tokens, TokenAccounting::default());
    }

    #[test]
    fn a_closing_event_without_the_message_wrapper_is_read_from_the_root() {
        // Tolerancia deliberada: se a referencia achatar o evento, ler a raiz e
        // melhor que devolver vazio e culpar o comportamento.
        let linha = r#"{"type":"message_end","stopReason":"length"}"#;

        let observed = read_events(linha, Events::Reference);

        assert_eq!(observed.stop_reason.as_deref(), Some("max_tokens"));
    }
}
