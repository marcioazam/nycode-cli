//! Ferramenta `bash`: executa um comando na raiz do workspace.
//!
//! Aqui vive só o contrato que o modelo vê — nome, descrição, argumentos e o
//! que volta. Como o comando sobe e o que o contém é de [`launch`]; de um
//! processo terminado ao texto que chega ao modelo é de [`output`].

use std::path::Path;
use std::time::Duration;

use async_trait::async_trait;
use serde_json::{Value, json};

use crate::policy::confinement::environment::Allowlist;
use crate::policy::confinement::sandbox::Confinement;
use crate::tool::{Tool, ToolContext, ToolOutput};

mod capture;
mod launch;
mod output;
mod supervise;

use launch::Launch;

/// Prazo padrão de um comando de shell.
pub use launch::DEFAULT_TIMEOUT as DEFAULT_COMMAND_TIMEOUT;

#[derive(Debug, Clone, Default)]
pub struct Bash {
    launch: Launch,
}

impl Bash {
    #[must_use]
    pub fn with_timeout(timeout: Duration) -> Self {
        Self {
            launch: Launch::with_timeout(timeout),
        }
    }

    /// Substitui o confinamento detectado.
    #[must_use]
    pub fn with_confinement(mut self, confinement: Confinement) -> Self {
        self.launch = self.launch.with_confinement(confinement);
        self
    }

    /// Substitui a lista de variáveis que o comando recebe.
    #[must_use]
    pub fn with_environment(mut self, environment: Allowlist) -> Self {
        self.launch = self.launch.with_environment(environment);
        self
    }

    /// Como os comandos desta ferramenta são confinados.
    #[must_use]
    pub const fn confinement(&self) -> &Confinement {
        self.launch.confinement()
    }
}

#[async_trait]
#[allow(clippy::unnecessary_literal_bound)]
impl Tool for Bash {
    fn name(&self) -> &str {
        "bash"
    }

    fn description(&self) -> &str {
        "Executa um argv na raiz do workspace e devolve stdout, \
         stderr e o codigo de saida. Cada item e um argumento, nao um shell."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "argv": {
                    "type": "array",
                    "minItems": 1,
                    "items": { "type": "string" },
                    "description": "Programa e argumentos, sem interpolacao"
                },
                "timeout": {
                    "type": "integer",
                    "description": "Prazo em segundos desta chamada; omitido usa o padrao da sessao"
                }
            },
            "required": ["argv"]
        })
    }

    async fn execute(&self, input: Value, ctx: &ToolContext) -> ToolOutput {
        let argv = match argv_from(&input) {
            Ok(argv) => argv,
            Err(message) => return ToolOutput::error(message),
        };
        let launch = if let Some(value) = input.get("timeout") {
            let Some(secs) = value.as_u64().filter(|secs| *secs > 0) else {
                return ToolOutput::error("`timeout` precisa ser um inteiro positivo de segundos");
            };
            self.launch.clone().with_deadline(Duration::from_secs(secs))
        } else {
            self.launch.clone()
        };

        match launch.run(ctx.root(), &argv).await {
            Ok(output) => output::render(&output, self.confinement().strength()),
            Err(message) => ToolOutput::error(message),
        }
    }
}

fn argv_from(input: &Value) -> Result<Vec<String>, String> {
    if input.get("command").is_some() {
        return Err("campo `command` recusado; use `argv`".to_owned());
    }
    let Some(items) = input.get("argv").and_then(Value::as_array) else {
        return Err("argumento obrigatorio ausente: `argv`".to_owned());
    };
    slots_from(items)
}

fn slots_from(items: &[Value]) -> Result<Vec<String>, String> {
    if items.is_empty() {
        return Err("`argv` vazio".to_owned());
    }
    let mut argv = Vec::with_capacity(items.len());
    for item in items {
        argv.push(slot(item)?);
    }
    if argv[0].trim().is_empty() {
        return Err("programa de `argv` vazio".to_owned());
    }
    if interprets_script(&argv) {
        return Err("interpretador com `-c` recusado".to_owned());
    }
    Ok(argv)
}

fn slot(item: &Value) -> Result<String, String> {
    let Some(text) = item.as_str() else {
        return Err("cada item de `argv` precisa ser string".to_owned());
    };
    if text.contains('\0') {
        return Err("item de `argv` com NUL".to_owned());
    }
    Ok(text.to_owned())
}

fn interprets_script(argv: &[String]) -> bool {
    let Some((bin, rest)) = argv.split_first() else {
        return false;
    };
    let name = program_name(bin);
    if name == "env" {
        if rest.iter().any(|arg| {
            matches!(arg.as_str(), "-S" | "--split-string") || arg.starts_with("--split-string=")
        }) {
            return true;
        }
        return rest
            .windows(2)
            .any(|pair| interpreter_accepts_script(program_name(&pair[0]), &pair[1]));
    }
    rest.iter().any(|arg| interpreter_accepts_script(name, arg))
}

fn program_name(bin: &str) -> &str {
    Path::new(bin)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(bin)
}

fn interpreter_accepts_script(program: &str, arg: &str) -> bool {
    match program {
        "bash" | "sh" | "dash" | "zsh" | "ksh" | "fish" | "python" | "python3" | "python2" => {
            arg == "-c" || arg == "-lc"
        }
        "node" | "nodejs" => arg == "-e" || arg == "--eval",
        "perl" | "ruby" | "lua" => arg == "-e",
        "php" => arg == "-r",
        _ => false,
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
mod tests {
    use super::*;
    use crate::policy::confinement::sandbox;
    fn workspace() -> (tempfile::TempDir, ToolContext) {
        let dir = tempfile::tempdir().unwrap();
        let ctx = ToolContext::new(dir.path()).unwrap();
        (dir, ctx)
    }
    fn call(parts: &[&str]) -> Value {
        json!({ "argv": parts })
    }
    fn script(dir: &tempfile::TempDir, body: &str) -> Value {
        std::fs::write(dir.path().join("t.sh"), body).unwrap();
        json!({ "argv": ["bash", "t.sh"] })
    }
    fn bare() -> Bash {
        Bash::default()
            .with_confinement(Confinement::Unavailable {
                reason: "teste".to_owned(),
            })
            .with_environment(Allowlist::default())
    }
    #[tokio::test]
    async fn captures_stdout_of_a_successful_command() {
        let (_dir, ctx) = workspace();
        let out = bare().execute(call(&["echo", "ola"]), &ctx).await;
        assert!(!out.is_error);
        assert!(out.content.contains("ola"));
        assert!(out.content.contains("stdout"));
    }
    #[tokio::test]
    async fn a_nonzero_exit_is_marked_as_an_error() {
        let (dir, ctx) = workspace();
        let out = bare().execute(script(&dir, "exit 3"), &ctx).await;
        assert!(out.is_error);
        assert!(out.content.contains("codigo de saida 3"));
    }
    #[tokio::test]
    async fn stderr_is_captured_alongside_stdout() {
        let (dir, ctx) = workspace();
        let out = bare()
            .execute(script(&dir, "echo saida; echo erro >&2"), &ctx)
            .await;
        assert!(out.content.contains("saida"));
        assert!(out.content.contains("erro"));
        assert!(out.content.contains("--- stderr ---"));
    }
    #[tokio::test]
    async fn the_command_runs_in_the_workspace_root() {
        let (dir, ctx) = workspace();
        std::fs::write(dir.path().join("marcador.txt"), "x").unwrap();
        let out = bare().execute(call(&["ls"]), &ctx).await;
        assert!(out.content.contains("marcador.txt"));
    }
    #[tokio::test]
    async fn a_timeout_reaches_the_model_as_a_failure() {
        let (_dir, ctx) = workspace();
        let bash = Bash::with_timeout(Duration::from_millis(200))
            .with_confinement(Confinement::Unavailable {
                reason: "teste".to_owned(),
            })
            .with_environment(Allowlist::default());
        let out = bash.execute(call(&["sleep", "30"]), &ctx).await;
        assert!(out.is_error);
        assert!(out.content.contains("excedeu"), "{}", out.content);
    }
    #[tokio::test]
    async fn a_per_call_timeout_overrides_the_construction_deadline() {
        let (_dir, ctx) = workspace();
        let bash = Bash::with_timeout(Duration::from_secs(30))
            .with_confinement(Confinement::Unavailable {
                reason: "teste".to_owned(),
            })
            .with_environment(Allowlist::default());
        let out = bash
            .execute(json!({ "argv": ["sleep", "30"], "timeout": 1 }), &ctx)
            .await;
        assert!(out.is_error, "{}", out.content);
        assert!(out.content.contains("1s"), "{}", out.content);
    }
    #[tokio::test]
    async fn a_zero_timeout_is_refused_before_running() {
        let (_dir, ctx) = workspace();
        let out = bare()
            .execute(json!({ "argv": ["true"], "timeout": 0 }), &ctx)
            .await;
        assert!(out.is_error);
        assert!(out.content.contains("timeout"), "{}", out.content);
    }
    #[tokio::test]
    async fn oversized_output_is_truncated_and_says_so() {
        let (dir, ctx) = workspace();
        let out = bare()
            .execute(
                script(&dir, "head -c 200000 /dev/zero | tr '\\0' 'x'"),
                &ctx,
            )
            .await;
        assert!(out.content.contains("[truncado"));
    }
    #[tokio::test]
    async fn an_empty_or_missing_command_is_reported() {
        let (_dir, ctx) = workspace();
        assert!(bare().execute(json!({}), &ctx).await.is_error);
        assert!(
            bare()
                .execute(json!({ "argv": ["   "] }), &ctx)
                .await
                .is_error
        );
    }
    #[tokio::test]
    async fn a_silent_successful_command_says_it_produced_nothing() {
        let (_dir, ctx) = workspace();
        let out = bare().execute(call(&["true"]), &ctx).await;
        assert!(!out.is_error);
        assert!(out.content.ends_with("(sem saida)"), "{}", out.content);
    }
    #[tokio::test]
    async fn an_unconfined_command_carries_the_fact_into_the_model_answer() {
        let (_dir, ctx) = workspace();
        let out = bare().execute(call(&["echo", "oi"]), &ctx).await;
        assert!(
            out.content.starts_with(output::UNCONFINED),
            "{}",
            out.content
        );
    }
    #[tokio::test]
    async fn a_write_outside_the_workspace_is_stopped_by_the_operating_system() {
        let Some(home) = std::env::var_os("HOME").map(std::path::PathBuf::from) else {
            return;
        };
        let alvo = home.join(format!(".nycode-sonda-{}.tmp", std::process::id()));
        let _ = std::fs::remove_file(&alvo);
        let (dir, ctx) = workspace();
        let confinement = sandbox::detect_from_path();
        if !confinement.is_enforced() {
            assert!(confinement.warning().is_some());
            return;
        }
        let out = Bash::default()
            .execute(
                script(&dir, &format!("echo invadi > {}", alvo.display())),
                &ctx,
            )
            .await;
        let escaped = alvo.exists();
        let _ = std::fs::remove_file(&alvo);
        assert!(
            !escaped,
            "a escrita fora da raiz precisa ser barrada: {}",
            out.content
        );
        assert!(
            out.is_error,
            "o comando barrado precisa falhar: {}",
            out.content
        );
    }
    #[tokio::test]
    async fn the_network_is_out_of_reach_under_confinement() {
        let (dir, ctx) = workspace();
        if !matches!(sandbox::detect_from_path(), Confinement::Bubblewrap { .. }) {
            return;
        }
        let out = Bash::default()
            .execute(script(&dir, "exec 3<>/dev/tcp/1.1.1.1/80"), &ctx)
            .await;
        assert!(
            out.is_error,
            "a rede precisa estar fora de alcance: {}",
            out.content
        );
    }
    #[tokio::test]
    async fn a_write_inside_the_workspace_still_works_under_confinement() {
        let (dir, ctx) = workspace();
        if !sandbox::detect_from_path().is_enforced() {
            return;
        }
        let out = Bash::default()
            .execute(script(&dir, "echo dentro > criado.txt"), &ctx)
            .await;
        assert!(!out.is_error, "{}", out.content);
        assert!(dir.path().join("criado.txt").exists());
    }
    #[test]
    fn the_schema_requires_argv_and_preserves_empty_slots() {
        assert_eq!(Bash::default().input_schema()["required"][0], "argv");
        assert_eq!(Bash::default().name(), "bash");
        assert!(Bash::default().description().contains("argv"));
        assert_eq!(
            argv_from(&json!({ "argv": ["printf", "", "x"] })).unwrap(),
            ["printf", "", "x"]
        );
    }
    #[test]
    fn supported_interpreter_flags_are_rejected_and_other_arguments_are_allowed() {
        for (program, flag) in [
            ("bash", "-c"),
            ("sh", "-lc"),
            ("node", "--eval"),
            ("perl", "-e"),
            ("ruby", "-e"),
            ("lua", "-e"),
            ("php", "-r"),
        ] {
            assert!(
                interpreter_accepts_script(program, flag),
                "{program} {flag}"
            );
        }
        for (program, argument) in [
            ("bash", "--version"),
            ("node", "--version"),
            ("perl", "--version"),
            ("ruby", "--version"),
            ("lua", "--version"),
            ("php", "--version"),
        ] {
            assert!(
                !interpreter_accepts_script(program, argument),
                "{program} {argument}"
            );
        }
    }
    #[test]
    fn env_split_string_forms_are_rejected() {
        assert!(interprets_script(&[
            "env".to_owned(),
            "--split-string".to_owned(),
            "bash -c".to_owned()
        ]));
        assert!(interprets_script(&[
            "env".to_owned(),
            "--split-string=bash -c".to_owned()
        ]));
    }
    #[tokio::test]
    async fn a_command_string_is_rejected_and_metacharacters_are_data() {
        let (_dir, ctx) = workspace();
        let refused = bare()
            .execute(json!({ "command": "echo spawned" }), &ctx)
            .await;
        assert!(refused.is_error);
        assert!(refused.content.contains("command"), "{}", refused.content);
        assert!(!refused.content.contains("spawned"), "{}", refused.content);
        let out = bare().execute(call(&["echo", "$(whoami)"]), &ctx).await;
        assert!(!out.is_error, "{}", out.content);
        assert!(out.content.contains("$(whoami)"), "{}", out.content);
    }
    #[tokio::test]
    async fn interpreter_script_flags_are_refused() {
        let (_dir, ctx) = workspace();
        for input in [
            json!({ "argv": ["bash", "-c", "echo spawned"] }),
            json!({ "argv": ["env", "bash", "-c", "echo spawned"] }),
            json!({ "argv": ["node", "-e", "console.log('spawned')"] }),
            json!({ "argv": ["env", "-S", "sh -c", "echo spawned"] }),
        ] {
            let out = bare().execute(input, &ctx).await;
            assert!(out.is_error, "{}", out.content);
            assert!(!out.content.contains("spawned"), "{}", out.content);
        }
    }
}
