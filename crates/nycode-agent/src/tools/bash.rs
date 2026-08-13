//! Ferramenta `bash`: executa um comando na raiz do workspace.

use std::fmt::Write as _;
use std::process::Stdio;
use std::time::Duration;

use async_trait::async_trait;
use serde_json::{Value, json};

use crate::policy::sandbox::{self, Confinement};
use crate::tool::{Tool, ToolContext, ToolOutput};

/// Teto de tempo de um comando.
///
/// Sem isto, um comando que espera entrada — um `git commit` sem `-m`, um
/// instalador interativo — trava o turno para sempre.
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(90);

/// Teto de saída capturada.
///
/// A saída vai inteira para o contexto do modelo. Um `find /` despejaria a
/// janela inteira e empurraria para fora o histórico que interessa.
const MAX_OUTPUT: usize = 64 * 1024;

#[derive(Debug, Clone)]
pub struct Bash {
    timeout: Duration,
    confinement: Confinement,
}

impl Default for Bash {
    fn default() -> Self {
        Self {
            timeout: DEFAULT_TIMEOUT,
            confinement: sandbox::detect_from_path(),
        }
    }
}

impl Bash {
    #[must_use]
    pub fn with_timeout(timeout: Duration) -> Self {
        Self {
            timeout,
            ..Self::default()
        }
    }

    /// Substitui o confinamento detectado.
    #[must_use]
    pub fn with_confinement(mut self, confinement: Confinement) -> Self {
        self.confinement = confinement;
        self
    }

    /// Como os comandos desta ferramenta são confinados.
    #[must_use]
    pub const fn confinement(&self) -> &Confinement {
        &self.confinement
    }

    /// Se terminar o comando leva junto os processos que ele iniciou.
    ///
    /// Só o namespace de PID do `bubblewrap` garante isso. Sem ele o término
    /// alcança o `bash` e para o laço, mas um neto já iniciado sobrevive — e a
    /// mensagem precisa dizer isso, em vez de afirmar uma interrupção completa
    /// que não aconteceu.
    const fn ends_the_whole_tree(&self) -> bool {
        matches!(self.confinement, Confinement::Bubblewrap { .. })
    }

    /// O que dizer quando o prazo estoura.
    fn timed_out(&self) -> String {
        let secs = self.timeout.as_secs();
        if self.ends_the_whole_tree() {
            format!("comando excedeu {secs}s e foi interrompido")
        } else {
            format!(
                "comando excedeu {secs}s e foi interrompido; sem confinamento, \
                 processos que ele tenha iniciado podem seguir rodando"
            )
        }
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

        // O confinamento envolve o comando; sem ele o `argv` é o `bash -lc` de
        // sempre, e o aviso na abertura da sessão é o que diz isso ao usuário.
        let argv = sandbox::wrap(&self.confinement, ctx.root(), command);
        let Some((program, rest)) = argv.split_first() else {
            return ToolOutput::error("confinamento produziu uma linha de comando vazia");
        };

        let spawned = tokio::process::Command::new(program)
            .args(rest)
            .current_dir(ctx.root())
            // Sem isto o comando herda o terminal e pode bloquear esperando
            // entrada que nunca vem.
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            // Largar o future não mata o processo: o `Child` do tokio o
            // desanexa no drop, e o comando segue escrevendo no workspace
            // depois de a ferramenta ter dito que o interrompeu. Isto vale para
            // os dois caminhos que largam o future — o prazo aqui e o
            // cancelamento no despacho (ADR-0015).
            .kill_on_drop(true)
            .output();

        // A ligação é deliberada: o `Timeout` é largado ao fim desta instrução,
        // e é esse drop que termina o comando. Deixá-lo dentro do `match`
        // adiaria o término para depois do braço.
        let finished = tokio::time::timeout(self.timeout, spawned).await;

        let output = match finished {
            Ok(Ok(output)) => output,
            Ok(Err(err)) => return ToolOutput::error(format!("nao foi possivel executar: {err}")),
            Err(_) => return ToolOutput::error(self.timed_out()),
        };

        let code = output.status.code();
        let mut rendered = String::new();
        append_section(&mut rendered, "stdout", &output.stdout);
        append_section(&mut rendered, "stderr", &output.stderr);

        match code {
            Some(0) => {
                if rendered.is_empty() {
                    rendered.push_str("(sem saida)");
                }
                ToolOutput::ok(rendered)
            }
            // Um comando que falhou precisa chegar marcado como erro, senao o
            // modelo segue como se o teste tivesse passado.
            Some(code) => ToolOutput::error(format!("codigo de saida {code}\n{rendered}")),
            None => ToolOutput::error(format!("terminado por sinal\n{rendered}")),
        }
    }
}

fn append_section(out: &mut String, label: &str, bytes: &[u8]) {
    if bytes.is_empty() {
        return;
    }
    let truncated = bytes.len() > MAX_OUTPUT;
    let slice = if truncated {
        &bytes[..MAX_OUTPUT]
    } else {
        bytes
    };
    let text = String::from_utf8_lossy(slice);

    let _ = write!(out, "--- {label} ---\n{text}");
    if !text.ends_with('\n') {
        out.push('\n');
    }
    if truncated {
        let _ = writeln!(out, "[truncado; {label} tem {} bytes]", bytes.len());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn workspace() -> (tempfile::TempDir, ToolContext) {
        let dir = tempfile::tempdir().unwrap();
        let ctx = ToolContext::new(dir.path()).unwrap();
        (dir, ctx)
    }

    /// A ferramenta sem confinamento.
    ///
    /// Os testes de comportamento da ferramenta — captura de saida, codigo de
    /// erro, timeout — sao sobre a ferramenta, nao sobre o sandbox, e nao podem
    /// depender de `bwrap` estar instalado na maquina de quem roda.
    fn bare() -> Bash {
        Bash::default().with_confinement(Confinement::Unavailable {
            reason: "teste".to_owned(),
        })
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
    async fn a_hanging_command_is_interrupted_by_the_timeout() {
        // Sem o teto, um comando que espera entrada trava o turno para sempre.
        let (_dir, ctx) = workspace();
        let bash = Bash::with_timeout(Duration::from_millis(200)).with_confinement(
            Confinement::Unavailable {
                reason: "teste".to_owned(),
            },
        );
        let out = bash.execute(json!({ "command": "sleep 30" }), &ctx).await;

        assert!(out.is_error);
        assert!(out.content.contains("excedeu"));
    }

    #[tokio::test]
    async fn dropping_a_running_command_ends_it_instead_of_orphaning_it() {
        // Largar o future e o que acontece nos dois caminhos que interrompem um
        // comando: o estouro de prazo aqui e o cancelamento no despacho. Sem
        // matar o processo ele segue escrevendo no workspace que o modelo esta
        // inspecionando, e a ferramenta afirma uma interrupcao que nao houve.
        let (_dir, ctx) = workspace();
        let sentinela = ctx.root().join("sentinela.txt");
        let size = || std::fs::metadata(&sentinela).map_or(0, |m| m.len());

        // Teto alto de proposito: quem termina o comando neste teste e o drop, e
        // nao o prazo. Amarrar o teste ao prazo o faria correr com o arranque do
        // `bash -lc`, que e um shell de login e demora sob carga.
        let bash =
            Bash::with_timeout(Duration::from_mins(1)).with_confinement(Confinement::Unavailable {
                reason: "teste".to_owned(),
            });
        // `Box::pin`, e nao `tokio::pin!`: o segundo produz um `Pin<&mut F>`, e
        // largar a referencia nao larga o future nem o processo que ele segura.
        let mut running = Box::pin(bash.execute(
            json!({ "command": "while true; do echo . >> sentinela.txt; sleep 0.02; done" }),
            &ctx,
        ));

        // Esperar o primeiro sinal de vida e o que remove a corrida: so faz
        // sentido largar um comando que ja comecou a escrever.
        let alive = async {
            let deadline = std::time::Instant::now() + Duration::from_secs(30);
            while size() == 0 && std::time::Instant::now() < deadline {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        };
        tokio::select! {
            _ = &mut running => {}
            () = alive => {}
        }
        drop(running);

        tokio::time::sleep(Duration::from_millis(150)).await;
        let logo_depois = size();
        assert!(
            logo_depois > 0,
            "o comando precisa ter escrito algo, senao o teste passa a toa"
        );
        tokio::time::sleep(Duration::from_millis(500)).await;

        assert_eq!(
            logo_depois,
            size(),
            "o comando continuou escrevendo depois de largado"
        );
    }

    #[test]
    fn the_timeout_message_admits_what_it_cannot_guarantee() {
        // Afirmar interrupcao completa onde ela nao e garantida repetiria, com
        // texto novo, o defeito que o termino corrige.
        let sem_confinamento = Bash::default().with_confinement(Confinement::Unavailable {
            reason: "teste".to_owned(),
        });
        assert!(
            sem_confinamento
                .timed_out()
                .contains("podem seguir rodando"),
            "{}",
            sem_confinamento.timed_out()
        );

        let confinado = Bash::default().with_confinement(Confinement::Bubblewrap {
            program: "bwrap".to_owned(),
        });
        assert!(confinado.timed_out().contains("interrompido"));
        assert!(
            !confinado.timed_out().contains("podem seguir rodando"),
            "sob namespace de PID a interrupcao e completa: {}",
            confinado.timed_out()
        );
    }

    #[tokio::test]
    async fn stdin_is_closed_so_interactive_commands_do_not_block() {
        let (_dir, ctx) = workspace();
        let bash =
            Bash::with_timeout(Duration::from_secs(5)).with_confinement(Confinement::Unavailable {
                reason: "teste".to_owned(),
            });
        // `cat` sem argumento leria stdin para sempre se ele nao estivesse fechado.
        let out = bash.execute(json!({ "command": "cat" }), &ctx).await;

        assert!(
            !out.is_error,
            "stdin fechado deveria encerrar o cat: {}",
            out.content
        );
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
        // String vazia faria o modelo achar que a ferramenta falhou.
        let (_dir, ctx) = workspace();
        let out = bare().execute(json!({ "command": "true" }), &ctx).await;

        assert!(!out.is_error);
        assert_eq!(out.content, "(sem saida)");
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
