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
#[path = "bash_tests.rs"]
mod tests;
