//! Ferramenta `bash`: executa um comando na raiz do workspace.
//!
//! Aqui vive só o contrato que o modelo vê — nome, descrição, argumentos e o
//! que volta. Como o comando sobe e o que o contém é de [`launch`]; de um
//! processo terminado ao texto que chega ao modelo é de [`output`].

use std::time::Duration;

use async_trait::async_trait;
use serde_json::{Value, json};

use crate::policy::environment::Allowlist;
use crate::policy::sandbox::Confinement;
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
        "Executa um comando de shell na raiz do workspace e devolve stdout, \
         stderr e o codigo de saida. Comandos interativos nao funcionam: passe \
         todos os argumentos na linha de comando."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "command": { "type": "string", "description": "Comando a executar" }
            },
            "required": ["command"]
        })
    }

    async fn execute(&self, input: Value, ctx: &ToolContext) -> ToolOutput {
        let Some(command) = input.get("command").and_then(Value::as_str) else {
            return ToolOutput::error("argumento obrigatorio ausente: `command`");
        };
        if command.trim().is_empty() {
            return ToolOutput::error("`command` vazio");
        }

        match self.launch.run(ctx.root(), command).await {
            Ok(output) => output::render(&output, self.confinement().strength()),
            Err(message) => ToolOutput::error(message),
        }
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
mod tests {
    use super::*;
    use crate::policy::sandbox;

    fn workspace() -> (tempfile::TempDir, ToolContext) {
        let dir = tempfile::tempdir().unwrap();
        let ctx = ToolContext::new(dir.path()).unwrap();
        (dir, ctx)
    }

    /// A ferramenta sem confinamento e com o ambiente no mínimo.
    ///
    /// Os testes de comportamento da ferramenta — captura de saida, codigo de
    /// erro — sao sobre a ferramenta, nao sobre o sandbox nem sobre a
    /// configuracao de quem roda a suite.
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
        let out = bare().execute(json!({ "command": "echo ola" }), &ctx).await;

        assert!(!out.is_error);
        assert!(out.content.contains("ola"));
        assert!(out.content.contains("stdout"));
    }

    #[tokio::test]
    async fn a_nonzero_exit_is_marked_as_an_error() {
        // Sem a marcacao o modelo seguiria como se o teste tivesse passado.
        let (_dir, ctx) = workspace();
        let out = bare().execute(json!({ "command": "exit 3" }), &ctx).await;

        assert!(out.is_error);
        assert!(out.content.contains("codigo de saida 3"));
    }

    #[tokio::test]
    async fn stderr_is_captured_alongside_stdout() {
        let (_dir, ctx) = workspace();
        let out = bare()
            .execute(json!({ "command": "echo saida; echo erro >&2" }), &ctx)
            .await;

        assert!(out.content.contains("saida"));
        assert!(out.content.contains("erro"));
        assert!(out.content.contains("--- stderr ---"));
    }

    #[tokio::test]
    async fn the_command_runs_in_the_workspace_root() {
        let (dir, ctx) = workspace();
        std::fs::write(dir.path().join("marcador.txt"), "x").unwrap();

        let out = bare().execute(json!({ "command": "ls" }), &ctx).await;
        assert!(out.content.contains("marcador.txt"));
    }

    #[tokio::test]
    async fn a_timeout_reaches_the_model_as_a_failure() {
        // O texto da mensagem e do `launch`; o que se protege aqui e que ela
        // chega marcada como erro, e nao como saida normal de um comando.
        let (_dir, ctx) = workspace();
        let bash = Bash::with_timeout(Duration::from_millis(200))
            .with_confinement(Confinement::Unavailable {
                reason: "teste".to_owned(),
            })
            .with_environment(Allowlist::default());

        let out = bash.execute(json!({ "command": "sleep 30" }), &ctx).await;

        assert!(out.is_error);
        assert!(out.content.contains("excedeu"), "{}", out.content);
    }

    #[tokio::test]
    async fn oversized_output_is_truncated_and_says_so() {
        let (_dir, ctx) = workspace();
        let out = bare()
            .execute(
                json!({ "command": "head -c 200000 /dev/zero | tr '\\0' 'x'" }),
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
                .execute(json!({ "command": "   " }), &ctx)
                .await
                .is_error
        );
    }

    #[tokio::test]
    async fn a_silent_successful_command_says_it_produced_nothing() {
        // String vazia faria o modelo achar que a ferramenta falhou. O `bare()`
        // roda sem confinamento, entao a resposta tambem carrega esse fato —
        // que e o que a ADR-0005 exige e o que o `output` monta.
        let (_dir, ctx) = workspace();
        let out = bare().execute(json!({ "command": "true" }), &ctx).await;

        assert!(!out.is_error);
        assert!(out.content.ends_with("(sem saida)"), "{}", out.content);
    }

    #[tokio::test]
    async fn an_unconfined_command_carries_the_fact_into_the_model_answer() {
        // A outra metade do nao negociavel da ADR-0005: o aviso em `stderr`
        // fala com o usuario, isto fala com o modelo.
        let (_dir, ctx) = workspace();
        let out = bare().execute(json!({ "command": "echo oi" }), &ctx).await;

        assert!(
            out.content.starts_with(output::UNCONFINED),
            "{}",
            out.content
        );
    }

    #[tokio::test]
    async fn a_write_outside_the_workspace_is_stopped_by_the_operating_system() {
        // E o criterio de aceite do FR-11: barrado pelo sistema, nao pela
        // politica do harness — que um `cd ..` contornaria.
        //
        // O alvo precisa ser um lugar onde o usuario normalmente escreve, senao
        // a permissao do proprio sistema de arquivos barraria de qualquer jeito
        // e o teste nao distinguiria nada. `/tmp` nao serve: a politica o monta
        // gravavel de proposito, porque todo build precisa dele.
        let Some(home) = std::env::var_os("HOME").map(std::path::PathBuf::from) else {
            return;
        };
        let alvo = home.join(format!(".nycode-sonda-{}.tmp", std::process::id()));
        let _ = std::fs::remove_file(&alvo);

        let (_dir, ctx) = workspace();
        let command = format!("echo invadi > {}", alvo.display());

        let confinement = sandbox::detect_from_path();
        if !confinement.is_enforced() {
            // Sem confinamento o teste ainda afirma algo: que o usuario foi
            // avisado. Pular deixaria o comportamento sem protecao justamente
            // na maquina que nao o tem.
            assert!(confinement.warning().is_some());
            return;
        }

        let out = Bash::default()
            .execute(json!({ "command": command }), &ctx)
            .await;
        let escaped = alvo.exists();
        let _ = std::fs::remove_file(&alvo);

        assert!(
            !escaped,
            "a escrita fora da raiz precisa ser barrada pelo sistema: {}",
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
        // Um comando que baixa codigo sai do que o usuario revisou. E a
        // dimensao mais limpa de verificar: nao depende de permissao de
        // arquivo nenhuma.
        let (_dir, ctx) = workspace();
        if !matches!(sandbox::detect_from_path(), Confinement::Bubblewrap { .. }) {
            return;
        }

        let out = Bash::default()
            // `/dev/tcp` e do proprio bash: nao exige curl instalado.
            .execute(json!({ "command": "exec 3<>/dev/tcp/1.1.1.1/80" }), &ctx)
            .await;

        assert!(
            out.is_error,
            "a rede precisa estar fora de alcance: {}",
            out.content
        );
    }

    #[tokio::test]
    async fn a_write_inside_the_workspace_still_works_under_confinement() {
        // Confinar nao pode significar impedir o trabalho: a raiz e escrevivel.
        let (dir, ctx) = workspace();
        let confinement = sandbox::detect_from_path();
        if !confinement.is_enforced() {
            return;
        }

        let out = Bash::default()
            .execute(json!({ "command": "echo dentro > criado.txt" }), &ctx)
            .await;

        assert!(!out.is_error, "{}", out.content);
        assert!(dir.path().join("criado.txt").exists());
    }

    #[test]
    fn the_schema_requires_a_command() {
        assert_eq!(Bash::default().input_schema()["required"][0], "command");
        assert_eq!(Bash::default().name(), "bash");
    }
}
