//! Execução de um harness e extração do seu contrato observável.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

use crate::transcript::{TokenAccounting, ToolInvocation, Transcript};
use crate::workspace::snapshot;

/// Um harness executável a ser medido.
#[derive(Debug, Clone)]
pub struct Harness {
    /// Nome usado nos relatórios.
    pub label: String,
    pub program: PathBuf,
    /// Argumentos que antecedem o prompt.
    pub args: Vec<String>,
    /// Variáveis de ambiente aplicadas à execução.
    pub env: Vec<(String, String)>,
    /// Dialeto do stream de eventos que este harness publica.
    pub events: Events,
}

impl Harness {
    /// O `nycode` compilado neste workspace.
    #[must_use]
    pub fn nycode(program: impl Into<PathBuf>, base_url: &str, api_key: &str) -> Self {
        Self {
            label: "nycode".to_owned(),
            program: program.into(),
            args: vec![
                "--base-url".to_owned(),
                base_url.to_owned(),
                "--api-key".to_owned(),
                api_key.to_owned(),
                "--allow-writes".to_owned(),
                // O modo de eventos é o que torna a sequência de ferramentas e
                // a contabilidade de tokens observáveis. Sem ele duas dimensões
                // da comparação ficariam vazias dos dois lados, que é aprovação
                // falsa e não paridade.
                "--output-format".to_owned(),
                "json".to_owned(),
                "-p".to_owned(),
            ],
            env: Vec::new(),
            events: Events::Nycode,
        }
    }

    /// O harness de referência, dirigido em modo de eventos JSON.
    #[must_use]
    pub fn reference(program: impl Into<PathBuf>, base_url: &str, api_key: &str) -> Self {
        Self {
            label: "referencia".to_owned(),
            program: program.into(),
            args: vec!["--mode".to_owned(), "json".to_owned(), "-p".to_owned()],
            env: vec![
                ("ANTHROPIC_BASE_URL".to_owned(), base_url.to_owned()),
                ("ANTHROPIC_API_KEY".to_owned(), api_key.to_owned()),
            ],
            events: Events::Reference,
        }
    }
}

/// Como ler o stream de eventos de um harness.
///
/// Os dois publicam NDJSON, mas não com os mesmos nomes de campo. Traduzir aqui
/// é o que permite comparar contrato observável em vez de formato de saída — o
/// formato divergir não é o defeito que o NFR-6 quer pegar.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Events {
    /// Etiqueta `type`, com `tool_start` e `result`.
    Nycode,
    /// Etiqueta `type`, com `tool_use` e `usage` aninhado na mensagem.
    Reference,
    /// O harness não publica eventos; as duas dimensões ficam vazias.
    None,
}

/// Roda um harness num workspace e devolve o contrato observado.
///
/// O workspace é fotografado depois da execução, não antes e depois: comparar
/// dois estados finais é o que responde "as duas execuções deixaram o disco
/// igual", que é a pergunta que interessa.
pub async fn run(harness: &Harness, workspace: &Path, prompt: &str) -> Result<Transcript> {
    let output = tokio::process::Command::new(&harness.program)
        .args(&harness.args)
        .arg(prompt)
        .current_dir(workspace)
        .envs(harness.env.iter().map(|(k, v)| (k.as_str(), v.as_str())))
        .output()
        .await
        .with_context(|| format!("nao foi possivel executar {}", harness.program.display()))?;

    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let observed = read_events(&stdout, harness.events);

    Ok(Transcript {
        tools: observed.tools,
        files: snapshot(workspace)?,
        tokens: observed.tokens,
        // O `stop_reason` do stream é o que o gateway disse; o código de saída é
        // a tradução dele. Preferir o primeiro evita comparar a tradução de um
        // harness com a do outro.
        stop_reason: observed
            .stop_reason
            .unwrap_or_else(|| infer_stop_reason(output.status.code())),
        error: observed.error.or_else(|| extract_error(&stderr)),
        exit_code: output.status.code().unwrap_or(-1),
    })
}

/// O que o stream de eventos revelou.
#[derive(Debug, Default)]
struct Observed {
    tools: Vec<ToolInvocation>,
    tokens: TokenAccounting,
    stop_reason: Option<String>,
    error: Option<String>,
}

/// Lê o NDJSON de um harness no dialeto dele.
///
/// Uma linha que não é JSON é ignorada em vez de derrubar a comparação: um
/// harness pode escrever prosa em stdout antes do primeiro evento, e isso não é
/// divergência de contrato.
fn read_events(stdout: &str, dialect: Events) -> Observed {
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
            (Events::Nycode, "tool_start") | (Events::Reference, "tool_use") => {
                if let Some(name) = value.get("name").and_then(serde_json::Value::as_str) {
                    let arguments = value
                        .get("input")
                        .or_else(|| value.get("arguments"))
                        .cloned()
                        .unwrap_or(serde_json::Value::Null);
                    observed.tools.push(ToolInvocation::new(name, &arguments));
                }
            }
            // O evento de fechamento tem nome diferente em cada dialeto, e o
            // mesmo conteúdo: `stop_reason` e a contabilidade do turno.
            (Events::Nycode, "result") | (Events::Reference, "message") => {
                observed.stop_reason = value
                    .get("stop_reason")
                    .and_then(serde_json::Value::as_str)
                    .map(ToOwned::to_owned);
                observed.tokens = read_usage(value.get("usage"));
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

/// Projeta a contabilidade de tokens de um evento.
fn read_usage(usage: Option<&serde_json::Value>) -> TokenAccounting {
    let Some(usage) = usage else {
        return TokenAccounting::default();
    };
    let number = |name: &str| usage.get(name).and_then(serde_json::Value::as_u64);

    TokenAccounting {
        input: number("input_tokens").unwrap_or(0),
        output: number("output_tokens").unwrap_or(0),
        estimated: usage
            .get("estimated")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false),
    }
}

/// Deduz o motivo de parada a partir do código de saída.
///
/// Os códigos do `nycode` são definidos em `exit_code_for`; um harness que não
/// os compartilha só é comparável na dimensão sucesso/falha.
fn infer_stop_reason(code: Option<i32>) -> String {
    match code {
        Some(0) => "end_turn",
        Some(3) => "refusal",
        Some(4) => "max_tokens",
        Some(5) => "pause_turn",
        Some(6) => "unrecognized",
        Some(_) => "error",
        None => "signal",
    }
    .to_owned()
}

/// Extrai a linha de erro do stderr.
///
/// Só a primeira linha relevante: rastros longos diferem entre harnesses por
/// razões que não são divergência de contrato.
fn extract_error(stderr: &str) -> Option<String> {
    stderr
        .lines()
        .find(|line| line.starts_with("nycode:") || line.to_ascii_lowercase().contains("error"))
        .map(|line| line.trim().to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exit_codes_map_onto_the_stop_reason_vocabulary() {
        assert_eq!(infer_stop_reason(Some(0)), "end_turn");
        assert_eq!(infer_stop_reason(Some(3)), "refusal");
        assert_eq!(infer_stop_reason(Some(4)), "max_tokens");
        assert_eq!(infer_stop_reason(Some(6)), "unrecognized");
        assert_eq!(infer_stop_reason(Some(1)), "error");
        assert_eq!(
            infer_stop_reason(None),
            "signal",
            "morte por sinal nao e end_turn"
        );
    }

    #[test]
    fn extracts_the_error_line_and_ignores_progress_noise() {
        let stderr = "  \u{2022} read(path=a.rs)\nnycode: prompt is too long\n";
        assert_eq!(
            extract_error(stderr).as_deref(),
            Some("nycode: prompt is too long")
        );
    }

    #[test]
    fn a_clean_run_has_no_error_line() {
        assert_eq!(extract_error("  \u{2022} read(path=a.rs)\n"), None);
        assert_eq!(extract_error(""), None);
    }

    #[tokio::test]
    async fn runs_a_program_and_snapshots_the_workspace() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("existente.txt"), "antes").unwrap();

        // `true` ignora os argumentos e sai com zero: exercita o caminho de
        // execucao sem depender de um harness real estar instalado.
        let harness = Harness {
            label: "stub".to_owned(),
            program: PathBuf::from("/usr/bin/true"),
            args: Vec::new(),
            env: Vec::new(),
            events: Events::None,
        };

        let transcript = run(&harness, dir.path(), "qualquer coisa").await.unwrap();
        assert_eq!(transcript.exit_code, 0);
        assert_eq!(transcript.stop_reason, "end_turn");
        assert!(transcript.files.contains_key("existente.txt"));
    }

    #[tokio::test]
    async fn a_failing_program_is_reported_as_an_error_not_a_clean_run() {
        let dir = tempfile::tempdir().unwrap();
        let harness = Harness {
            label: "stub".to_owned(),
            program: PathBuf::from("/usr/bin/false"),
            args: Vec::new(),
            env: Vec::new(),
            events: Events::None,
        };

        let transcript = run(&harness, dir.path(), "x").await.unwrap();
        assert_eq!(transcript.exit_code, 1);
        assert_eq!(transcript.stop_reason, "error");
    }

    #[tokio::test]
    async fn a_missing_program_fails_loudly() {
        let dir = tempfile::tempdir().unwrap();
        let harness = Harness {
            label: "ausente".to_owned(),
            program: PathBuf::from("/nao/existe/harness"),
            args: Vec::new(),
            env: Vec::new(),
            events: Events::None,
        };

        let err = run(&harness, dir.path(), "x").await.unwrap_err();
        assert!(err.to_string().contains("nao foi possivel executar"));
    }

    #[test]
    fn the_reference_harness_is_pointed_at_the_gateway_by_environment() {
        // O harness de referencia so aceita gateway por ANTHROPIC_BASE_URL;
        // passar por flag nao funcionaria e a comparacao rodaria contra o
        // backend errado sem ninguem notar.
        let harness = Harness::reference("/usr/bin/pi", "http://gw/v1", "k");
        assert!(
            harness
                .env
                .iter()
                .any(|(k, v)| k == "ANTHROPIC_BASE_URL" && v == "http://gw/v1")
        );
        assert!(harness.env.iter().any(|(k, _)| k == "ANTHROPIC_API_KEY"));
    }

    #[test]
    fn both_harnesses_are_driven_in_their_json_event_mode() {
        // Sem o modo de eventos, a sequencia de ferramentas e a contabilidade
        // de tokens ficam vazias dos dois lados: aprovacao falsa, nao paridade.
        let nycode = Harness::nycode("/bin/nycode", "http://gw/v1", "k");
        assert_eq!(nycode.events, Events::Nycode);
        assert!(nycode.args.contains(&"json".to_owned()));
        assert_eq!(
            nycode.args.last().unwrap(),
            "-p",
            "o prompt e anexado depois dos argumentos"
        );

        let reference = Harness::reference("/usr/bin/pi", "http://gw/v1", "k");
        assert_eq!(reference.events, Events::Reference);
        assert!(reference.args.contains(&"json".to_owned()));
        assert_eq!(reference.args.last().unwrap(), "-p");
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
        assert_eq!(observed.tokens.input, 120);
        assert_eq!(observed.tokens.output, 30);
        assert_eq!(observed.stop_reason.as_deref(), Some("end_turn"));
    }

    #[test]
    fn the_reference_dialect_is_translated_rather_than_compared_verbatim() {
        // O formato divergir nao e o defeito que o NFR-6 quer pegar; o
        // contrato observavel divergir e.
        let stdout = concat!(
            r#"{"type":"tool_use","name":"read","arguments":{"path":"a.rs"}}"#,
            "\n",
            r#"{"type":"message","stop_reason":"end_turn","usage":{"input_tokens":120,"output_tokens":30}}"#,
            "\n",
        );

        let observed = read_events(stdout, Events::Reference);
        assert_eq!(observed.tools.len(), 1);
        assert_eq!(observed.tools[0].name, "read");
        assert_eq!(observed.tokens.input, 120);
        assert_eq!(observed.stop_reason.as_deref(), Some("end_turn"));
    }

    #[test]
    fn the_same_call_written_two_ways_is_not_a_divergence() {
        // Ordem de chaves difere entre serializadores; sem normalizacao toda
        // execucao acusaria divergencia falsa.
        let ny = read_events(
            r#"{"type":"tool_start","name":"write","input":{"path":"a","content":"b"}}"#,
            Events::Nycode,
        );
        let re = read_events(
            r#"{"type":"tool_use","name":"write","arguments":{"content":"b","path":"a"}}"#,
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
    fn an_error_event_becomes_the_error_envelope() {
        let observed = read_events(
            r#"{"type":"error","message":"prompt is too long"}"#,
            Events::Nycode,
        );
        assert_eq!(observed.error.as_deref(), Some("prompt is too long"));
    }

    #[test]
    fn a_line_that_is_not_an_event_is_skipped_instead_of_failing() {
        // Um harness pode escrever prosa antes do primeiro evento; isso nao e
        // divergencia de contrato.
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
    fn a_harness_without_an_event_mode_reports_nothing_rather_than_guessing() {
        let stdout = r#"{"type":"tool_start","name":"read","input":{}}"#;
        let observed = read_events(stdout, Events::None);
        assert!(observed.tools.is_empty());
        assert_eq!(observed.tokens, TokenAccounting::default());
    }

    #[test]
    fn a_stream_without_a_final_event_falls_back_to_the_exit_code() {
        // Um harness morto no meio nao publica `result`; deduzir do codigo de
        // saida e melhor que declarar `end_turn`.
        let observed = read_events(r#"{"type":"text","text":"parcial"}"#, Events::Nycode);
        assert_eq!(observed.stop_reason, None);
    }

    #[test]
    fn a_result_without_usage_reports_zero_rather_than_failing() {
        let observed = read_events(
            r#"{"type":"result","stop_reason":"end_turn"}"#,
            Events::Nycode,
        );
        assert_eq!(observed.tokens, TokenAccounting::default());
    }
}
