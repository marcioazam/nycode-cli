//! Execução de um harness e extração do seu contrato observável.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

use crate::dialect::{Events, read_events};
use crate::transcript::Transcript;
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
}
