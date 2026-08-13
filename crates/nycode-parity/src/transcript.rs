//! O contrato observável de uma execução, e como comparar dois deles.
//!
//! O que **não** é comparado: a prosa da resposta. Ela é não-determinística e
//! diferenças ali não significam nada. O que é comparado é o que um chamador
//! consegue depender: quais ferramentas rodaram e em que ordem, como o disco
//! ficou, quanto foi cobrado, e como o turno terminou.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// Uma ferramenta executada, sem o resultado.
///
/// Os argumentos entram normalizados como JSON canônico para que uma diferença
/// de ordem de chaves não vire uma divergência falsa.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ToolInvocation {
    pub name: String,
    pub arguments: String,
}

impl ToolInvocation {
    pub fn new(name: impl Into<String>, arguments: &serde_json::Value) -> Self {
        Self {
            name: name.into(),
            arguments: canonical_json(arguments),
        }
    }
}

/// Contabilidade de tokens de uma execução.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct TokenAccounting {
    pub input: u64,
    pub output: u64,
    pub estimated: bool,
}

/// O contrato observável de uma execução.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Transcript {
    /// Ferramentas executadas, na ordem.
    pub tools: Vec<ToolInvocation>,
    /// Caminho relativo para digest do conteúdo, após a execução.
    pub files: BTreeMap<String, String>,
    pub tokens: TokenAccounting,
    /// `stop_reason` normalizado.
    pub stop_reason: String,
    /// Envelope de erro, quando houve.
    pub error: Option<String>,
    pub exit_code: i32,
}

/// Uma divergência entre duas execuções.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Divergence {
    pub dimension: &'static str,
    pub reference: String,
    pub candidate: String,
}

impl std::fmt::Display for Divergence {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{}: referencia={} candidato={}",
            self.dimension, self.reference, self.candidate
        )
    }
}

/// Compara duas execuções nas cinco dimensões que importam.
///
/// Tolerância de tokens existe porque backends arredondam de forma diferente e
/// uma divergência de um token não é um defeito. Uma divergência de sinalização
/// de estimativa é.
#[must_use]
pub fn diff(
    reference: &Transcript,
    candidate: &Transcript,
    token_tolerance: u64,
) -> Vec<Divergence> {
    let mut found = Vec::new();

    if reference.tools != candidate.tools {
        found.push(Divergence {
            dimension: "sequencia de tool calls",
            reference: render_tools(&reference.tools),
            candidate: render_tools(&candidate.tools),
        });
    }

    for (path, digest) in &reference.files {
        match candidate.files.get(path) {
            Some(other) if other == digest => {}
            Some(other) => found.push(Divergence {
                dimension: "estado do arquivo",
                reference: format!("{path}={digest}"),
                candidate: format!("{path}={other}"),
            }),
            None => found.push(Divergence {
                dimension: "arquivo ausente",
                reference: path.clone(),
                candidate: "<ausente>".to_owned(),
            }),
        }
    }
    for path in candidate.files.keys() {
        if !reference.files.contains_key(path) {
            found.push(Divergence {
                dimension: "arquivo inesperado",
                reference: "<ausente>".to_owned(),
                candidate: path.clone(),
            });
        }
    }

    if reference.stop_reason != candidate.stop_reason {
        found.push(Divergence {
            dimension: "stop_reason",
            reference: reference.stop_reason.clone(),
            candidate: candidate.stop_reason.clone(),
        });
    }

    if reference.error != candidate.error {
        found.push(Divergence {
            dimension: "envelope de erro",
            reference: reference
                .error
                .clone()
                .unwrap_or_else(|| "<nenhum>".to_owned()),
            candidate: candidate
                .error
                .clone()
                .unwrap_or_else(|| "<nenhum>".to_owned()),
        });
    }

    if reference.exit_code != candidate.exit_code {
        found.push(Divergence {
            dimension: "codigo de saida",
            reference: reference.exit_code.to_string(),
            candidate: candidate.exit_code.to_string(),
        });
    }

    found.extend(diff_tokens(
        reference.tokens,
        candidate.tokens,
        token_tolerance,
    ));
    found
}

/// As dimensões que uma execução precisa ter exercitado.
pub const DIMENSIONS: &[&str] = &[
    "sequencia de tool calls",
    "estado do disco",
    "stop_reason",
    "contabilidade de tokens",
];

/// Dimensões que não carregam evidência em nenhum dos dois lados.
///
/// O [`diff`] compara por igualdade, e duas ausências são iguais. Uma sequência
/// de ferramentas vazia dos dois lados, ou uma contabilidade zerada dos dois
/// lados, passa no diff sem ter comparado nada — e o resultado é indistinguível
/// de paridade real para quem lê a saída.
///
/// Não é hipótese: o dialeto da referência já procurou o vocabulário errado, e
/// naquele estado a sequência de ferramentas teria ficado vazia e a
/// contabilidade daria `0/0` em toda execução, com o gate aprovando.
///
/// Isto é o predicado por par de execuções. Quem decide reprovar precisa
/// acumular ao longo de todos os prompts, porque um prompt sozinho pode
/// legitimamente não chamar ferramenta — o conjunto padrão tem um assim. O que
/// não é legítimo é a dimensão ficar vazia em todos.
///
/// O `README.md` semeado no workspace faz o instantâneo de arquivos nunca ser
/// legitimamente vazio, então vazio ali significa que a fotografia falhou.
#[must_use]
pub fn unattested(reference: &Transcript, candidate: &Transcript) -> Vec<&'static str> {
    let mut absent = Vec::new();

    if reference.tools.is_empty() && candidate.tools.is_empty() {
        absent.push("sequencia de tool calls");
    }
    if reference.files.is_empty() && candidate.files.is_empty() {
        absent.push("estado do disco");
    }
    if reference.stop_reason.is_empty() && candidate.stop_reason.is_empty() {
        absent.push("stop_reason");
    }
    if zeroed(reference.tokens) && zeroed(candidate.tokens) {
        absent.push("contabilidade de tokens");
    }
    absent
}

const fn zeroed(tokens: TokenAccounting) -> bool {
    tokens.input == 0 && tokens.output == 0
}

fn diff_tokens(
    reference: TokenAccounting,
    candidate: TokenAccounting,
    tolerance: u64,
) -> Vec<Divergence> {
    let mut found = Vec::new();

    // Uma contagem estimada apresentada como medida e um defeito de contrato,
    // independente do valor.
    if reference.estimated != candidate.estimated {
        found.push(Divergence {
            dimension: "sinalizacao de usage estimado",
            reference: reference.estimated.to_string(),
            candidate: candidate.estimated.to_string(),
        });
    }

    for (dimension, a, b) in [
        ("tokens de entrada", reference.input, candidate.input),
        ("tokens de saida", reference.output, candidate.output),
    ] {
        if a.abs_diff(b) > tolerance {
            found.push(Divergence {
                dimension,
                reference: a.to_string(),
                candidate: b.to_string(),
            });
        }
    }
    found
}

fn render_tools(tools: &[ToolInvocation]) -> String {
    if tools.is_empty() {
        return "<nenhuma>".to_owned();
    }
    tools
        .iter()
        .map(|t| format!("{}({})", t.name, t.arguments))
        .collect::<Vec<_>>()
        .join(" -> ")
}

/// Serializa com chaves ordenadas, para que a ordem não gere falso positivo.
fn canonical_json(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Object(map) => {
            let ordered: BTreeMap<_, _> = map.iter().collect();
            let inner: Vec<_> = ordered
                .into_iter()
                .map(|(k, v)| {
                    format!(
                        "{}:{}",
                        serde_json::to_string(k).unwrap_or_default(),
                        canonical_json(v)
                    )
                })
                .collect();
            format!("{{{}}}", inner.join(","))
        }
        serde_json::Value::Array(items) => {
            let inner: Vec<_> = items.iter().map(canonical_json).collect();
            format!("[{}]", inner.join(","))
        }
        other => other.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn base() -> Transcript {
        Transcript {
            tools: vec![ToolInvocation::new("read", &json!({ "path": "a.rs" }))],
            files: BTreeMap::from([("a.rs".to_owned(), "abc123".to_owned())]),
            tokens: TokenAccounting {
                input: 100,
                output: 20,
                estimated: false,
            },
            stop_reason: "end_turn".to_owned(),
            error: None,
            exit_code: 0,
        }
    }

    #[test]
    fn identical_runs_have_no_divergence() {
        assert!(diff(&base(), &base(), 0).is_empty());
    }

    #[test]
    fn key_order_in_arguments_is_not_a_divergence() {
        // Sem canonicalizacao, {"a":1,"b":2} e {"b":2,"a":1} apareceriam como
        // divergentes e o harness viraria ruido que ninguem le.
        let a = ToolInvocation::new("t", &json!({ "a": 1, "b": 2 }));
        let b = ToolInvocation::new("t", &json!({ "b": 2, "a": 1 }));
        assert_eq!(a, b);
    }

    #[test]
    fn a_different_tool_order_is_a_divergence() {
        // Duas ferramentas onde a segunda depende da primeira mudam de resultado
        // se trocadas; a ordem e parte do contrato.
        let mut candidate = base();
        candidate.tools = vec![
            ToolInvocation::new("bash", &json!({})),
            ToolInvocation::new("read", &json!({ "path": "a.rs" })),
        ];
        let found = diff(&base(), &candidate, 0);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].dimension, "sequencia de tool calls");
    }

    #[test]
    fn a_changed_file_is_a_divergence() {
        let mut candidate = base();
        candidate
            .files
            .insert("a.rs".to_owned(), "diferente".to_owned());
        let found = diff(&base(), &candidate, 0);
        assert_eq!(found[0].dimension, "estado do arquivo");
    }

    #[test]
    fn missing_and_extra_files_are_both_reported() {
        let mut candidate = base();
        candidate.files.clear();
        candidate.files.insert("b.rs".to_owned(), "x".to_owned());

        let dims: Vec<_> = diff(&base(), &candidate, 0)
            .iter()
            .map(|d| d.dimension)
            .collect();
        assert!(dims.contains(&"arquivo ausente"));
        assert!(dims.contains(&"arquivo inesperado"));
    }

    #[test]
    fn small_token_differences_are_tolerated_but_large_ones_are_not() {
        let mut candidate = base();
        candidate.tokens.input = 102;
        assert!(
            diff(&base(), &candidate, 5).is_empty(),
            "2 tokens dentro da tolerancia de 5"
        );
        assert_eq!(
            diff(&base(), &candidate, 1).len(),
            1,
            "2 tokens fora da tolerancia de 1"
        );
    }

    #[test]
    fn an_estimated_flag_mismatch_is_never_tolerated() {
        // Apresentar contagem estimada como medida e defeito de contrato,
        // independente de quao proximo o numero esteja.
        let mut candidate = base();
        candidate.tokens.estimated = true;
        let found = diff(&base(), &candidate, u64::MAX);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].dimension, "sinalizacao de usage estimado");
    }

    #[test]
    fn stop_reason_and_error_envelope_are_compared() {
        let mut candidate = base();
        candidate.stop_reason = "refusal".to_owned();
        candidate.error = Some("bloqueado".to_owned());
        candidate.exit_code = 3;

        let dims: Vec<_> = diff(&base(), &candidate, 0)
            .iter()
            .map(|d| d.dimension)
            .collect();
        assert!(dims.contains(&"stop_reason"));
        assert!(dims.contains(&"envelope de erro"));
        assert!(dims.contains(&"codigo de saida"));
    }

    #[test]
    fn prose_is_deliberately_absent_from_the_contract() {
        // O texto da resposta e nao-deterministico. Se ele entrasse no diff, o
        // harness acusaria divergencia em toda execucao e seria desligado.
        let transcript = base();
        let encoded = serde_json::to_string(&transcript).unwrap();
        assert!(
            !encoded.contains("text"),
            "transcript nao deve carregar prosa"
        );
    }

    #[test]
    fn divergences_render_both_sides() {
        let d = Divergence {
            dimension: "stop_reason",
            reference: "end_turn".to_owned(),
            candidate: "refusal".to_owned(),
        };
        assert_eq!(
            d.to_string(),
            "stop_reason: referencia=end_turn candidato=refusal"
        );
    }

    #[test]
    fn a_dimension_empty_on_both_sides_is_reported_as_unattested() {
        // O caso que o diff nao pega: duas ausencias sao iguais, e o gate
        // imprimiria "ok" sem ter comparado nada.
        let empty = Transcript::default();
        assert!(diff(&empty, &empty, 0).is_empty(), "o diff aprova");

        let absent = unattested(&empty, &empty);
        assert!(absent.contains(&"sequencia de tool calls"));
        assert!(absent.contains(&"estado do disco"));
        assert!(absent.contains(&"stop_reason"));
        assert!(absent.contains(&"contabilidade de tokens"));
    }

    #[test]
    fn a_dimension_present_on_one_side_is_attested_because_the_diff_will_catch_it() {
        // Basta um lado carregar evidencia: se o outro nao carrega, e o diff
        // que acusa, e acusar duas vezes so dobraria o ruido.
        let mut reference = base();
        reference.tools.clear();
        assert!(!unattested(&reference, &base()).contains(&"sequencia de tool calls"));
    }

    #[test]
    fn a_complete_pair_of_runs_is_fully_attested() {
        assert!(unattested(&base(), &base()).is_empty());
    }

    #[test]
    fn tokens_count_as_attested_when_either_direction_is_nonzero() {
        // Uma resposta que so gera saida, sem entrada contabilizada, ainda
        // provou que o dialeto sabe ler usage.
        let mut only_output = Transcript::default();
        only_output.tokens.output = 1;
        assert!(
            !unattested(&only_output, &Transcript::default()).contains(&"contabilidade de tokens")
        );
    }

    #[test]
    fn nested_arguments_are_canonicalized_recursively() {
        let a = ToolInvocation::new("t", &json!({ "o": { "z": 1, "a": [2, 3] } }));
        let b = ToolInvocation::new("t", &json!({ "o": { "a": [2, 3], "z": 1 } }));
        assert_eq!(a, b);
    }
}
