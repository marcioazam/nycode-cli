//! Execução de um harness e extração do seu contrato observável.

use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::{Context, Result};

/// Prazo de uma execução de harness.
///
/// Generoso de propósito: um turno contra um gateway real, com arranque de
/// runtime e uma rodada de ferramenta, cabe folgado. O número existe para
/// separar "demorou" de "não vai terminar", e não para medir performance —
/// quem mede é o `perf-gate`.
const DEFAULT_DEADLINE: Duration = Duration::from_mins(2);

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
    ///
    /// **A referência não lê `ANTHROPIC_BASE_URL`.** O endpoint vem da definição
    /// de modelo em `models.json`, num diretório redirecionável por
    /// `PI_CODING_AGENT_DIR`. Verificado ao rodar: com só a variável de
    /// ambiente a referência foi à API real e voltou `401`; com o arquivo
    /// abaixo ela falou com o fixture local e devolveu `msg_fixture` /
    /// `input: 1234`. Registro em
    /// [`sources/research_pi-gateway-local.md`](../../../../sources/research_pi-gateway-local.md).
    ///
    /// O `baseUrl` do dialeto `anthropic-messages` é a origem, sem `/v1`: o
    /// SDK posta em `/v1/messages`. A URL que o fixture anuncia traz o sufixo,
    /// e passar essa string faria o SDK pedir `/v1/v1/messages`, que o fixture
    /// recusa. O `TempDir` tem de viver até o fim da execução — é o diretório
    /// que a variável aponta.
    ///
    /// [`NOTICE`]: ../../../NOTICE
    pub fn reference(
        program: impl Into<PathBuf>,
        base_url: &str,
        api_key: &str,
    ) -> Result<(Self, tempfile::TempDir)> {
        let agent_dir = tempfile::tempdir()
            .context("nao foi possivel criar o diretorio de agente da referencia")?;
        let origin = origin_from_gateway_url(base_url);
        let models = serde_json::json!({
            "providers": {
                "anthropic": {
                    "baseUrl": origin,
                    "api": "anthropic-messages",
                    "apiKey": api_key,
                }
            }
        });
        std::fs::write(agent_dir.path().join("models.json"), models.to_string())
            .context("nao foi possivel gravar models.json da referencia")?;

        let harness = Self {
            label: "referencia".to_owned(),
            program: program.into(),
            args: vec!["--mode".to_owned(), "json".to_owned(), "-p".to_owned()],
            env: vec![(
                "PI_CODING_AGENT_DIR".to_owned(),
                agent_dir.path().to_string_lossy().into_owned(),
            )],
            events: Events::Reference,
        };
        Ok((harness, agent_dir))
    }
}

/// Origem que o SDK `anthropic-messages` aceita como `baseURL`.
///
/// O fixture anuncia `http://127.0.0.1:<porta>/v1`. O cliente da Anthropic
/// trata `baseURL` como origem e posta em `/v1/messages`. Manter o sufixo
/// duplica o caminho.
fn origin_from_gateway_url(base_url: &str) -> String {
    base_url
        .trim_end_matches('/')
        .trim_end_matches("/v1")
        .to_owned()
}

/// Roda um harness num workspace e devolve o contrato observado.
///
/// O workspace é fotografado depois da execução, não antes e depois: comparar
/// dois estados finais é o que responde "as duas execuções deixaram o disco
/// igual", que é a pergunta que interessa.
pub async fn run(harness: &Harness, workspace: &Path, prompt: &str) -> Result<Transcript> {
    run_within(harness, workspace, prompt, DEFAULT_DEADLINE).await
}

/// O mesmo, com o prazo dito.
///
/// O prazo existe porque um harness que pendura pendura o gate, e num CI isso
/// queima o job inteiro sem diagnóstico nenhum — que é pior que reprovar. É um
/// caso observado, não hipotético: a referência ficou esperando contra o
/// gateway de fixture e a execução só terminou quando alguém foi olhar.
///
/// Estourar o prazo é erro nomeado, e não transcrição vazia: uma execução que
/// não terminou não tem contrato observável para comparar, e trata-la como
/// "sem evidência" aprovaria sobre ausência — o que o NFR-6 proíbe.
pub async fn run_within(
    harness: &Harness,
    workspace: &Path,
    prompt: &str,
    deadline: Duration,
) -> Result<Transcript> {
    let child = tokio::process::Command::new(&harness.program)
        .args(&harness.args)
        .arg(prompt)
        .current_dir(workspace)
        .envs(harness.env.iter().map(|(k, v)| (k.as_str(), v.as_str())))
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        // SIMPLIFICACAO: mata o lider, nao o grupo. O ADR-0021 mostra por que o
        // grupo e o alvo certo no caminho de ferramenta; aqui o filho e um
        // harness de linha de comando e o custo de uma dependencia a mais nao
        // se paga. Um neto sobrevivente aparece como processo orfao, nao como
        // gate pendurado.
        .kill_on_drop(true)
        .spawn()
        .with_context(|| format!("nao foi possivel executar {}", harness.program.display()))?;

    let output = tokio::time::timeout(deadline, child.wait_with_output())
        .await
        .map_err(|_| {
            anyhow::anyhow!(
                "o harness `{}` nao terminou em {}ms; execucao interrompida",
                harness.label,
                deadline.as_millis()
            )
        })?
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
    async fn a_harness_that_hangs_is_cut_off_and_named() {
        // Sem prazo, uma referencia que pendura pendura o gate — e num CI isso
        // queima o job inteiro sem diagnostico nenhum, que e pior que reprovar.
        // Aconteceu de verdade: o `pi` ficou esperando contra o gateway de
        // fixture, e a execucao so terminou quando alguem foi olhar.
        let dir = tempfile::tempdir().unwrap();
        // Por `sh -c` e nao por `sleep` direto: o prompt vai como ultimo
        // argumento, e `sleep 30 <prompt>` erra na hora em vez de pendurar.
        let harness = Harness {
            label: "pendurado".to_owned(),
            program: PathBuf::from("/bin/sh"),
            args: vec!["-c".to_owned(), "sleep 30".to_owned()],
            env: Vec::new(),
            events: Events::None,
        };

        let err = run_within(&harness, dir.path(), "x", Duration::from_millis(150))
            .await
            .unwrap_err();

        let mensagem = err.to_string();
        assert!(mensagem.contains("pendurado"), "{mensagem}");
        assert!(mensagem.contains("150"), "{mensagem}");
    }

    #[tokio::test]
    async fn a_program_that_finishes_within_the_deadline_is_not_cut_off() {
        let dir = tempfile::tempdir().unwrap();
        let harness = Harness {
            label: "rapido".to_owned(),
            program: PathBuf::from("/usr/bin/true"),
            args: Vec::new(),
            env: Vec::new(),
            events: Events::None,
        };

        let transcript = run_within(&harness, dir.path(), "x", Duration::from_secs(30))
            .await
            .unwrap();
        assert_eq!(transcript.exit_code, 0);
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
    fn origin_from_gateway_url_strips_the_v1_suffix_the_sdk_would_duplicate() {
        assert_eq!(
            origin_from_gateway_url("http://127.0.0.1:9/v1"),
            "http://127.0.0.1:9"
        );
        assert_eq!(
            origin_from_gateway_url("http://127.0.0.1:9/v1/"),
            "http://127.0.0.1:9"
        );
        assert_eq!(
            origin_from_gateway_url("http://127.0.0.1:9"),
            "http://127.0.0.1:9"
        );
    }

    #[test]
    fn the_reference_harness_points_at_the_gateway_via_a_model_definition() {
        let (harness, agent_dir) = Harness::reference("/usr/bin/pi", "http://gw/v1", "k").unwrap();
        let dir = harness
            .env
            .iter()
            .find(|(key, _)| key == "PI_CODING_AGENT_DIR")
            .map(|(_, value)| value.as_str())
            .expect("o diretorio de agente e o vetor que a referencia le");
        assert_eq!(dir, agent_dir.path().to_string_lossy());
        assert!(
            !harness
                .env
                .iter()
                .any(|(key, _)| key == "ANTHROPIC_BASE_URL"),
            "a variavel que a referencia ignora nao e o apontamento"
        );

        let models: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(agent_dir.path().join("models.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(
            models["providers"]["anthropic"]["baseUrl"].as_str(),
            Some("http://gw")
        );
        assert_eq!(
            models["providers"]["anthropic"]["api"].as_str(),
            Some("anthropic-messages")
        );
        assert_eq!(
            models["providers"]["anthropic"]["apiKey"].as_str(),
            Some("k")
        );
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

        let (reference, _agent_dir) =
            Harness::reference("/usr/bin/pi", "http://gw/v1", "k").unwrap();
        assert_eq!(reference.events, Events::Reference);
        assert!(reference.args.contains(&"json".to_owned()));
        assert_eq!(reference.args.last().unwrap(), "-p");
    }
}
