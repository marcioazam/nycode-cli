//! Hooks de ciclo de vida como executáveis com contrato JSON (FR-16).
//!
//! O terceiro mecanismo de extensão do
//! [ADR-0002](../../../../docs/architecture/decisions/0002-tres-mecanismos-de-extensao.md),
//! e o único que pode dizer não: um `pre-tool-use` veta uma chamada antes de
//! ela rodar. É o que permite escrever política como código —
//! "nada de `git push` nesta máquina" — sem recompilar o binário
//! ([ADR-0009](../../../../docs/architecture/decisions/0009-hooks-sao-executaveis-com-contrato-json.md)).
//!
//! Vive em `policy` e não em `context` porque o veto é o que o torna
//! estruturalmente significativo: é a terceira camada de decisão, ao lado do
//! gate e do confinamento.
//!
//! **Falha aberto, de propósito.** Um hook que não roda, trava ou responde lixo
//! não bloqueia a sessão. A alternativa transformaria um script quebrado num
//! agente inutilizável, e a maioria dos hooks é observação. O risco é real e
//! está aceito no ADR: quem quer bloqueio garantido usa o gate, que é código.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};

/// Teto de tempo de um hook.
///
/// Um hook roda a cada chamada de ferramenta; um que demora meio segundo
/// dobraria o tempo de um turno com vinte chamadas.
const TIMEOUT: Duration = Duration::from_secs(5);

/// Teto de bytes guardados do stdout de um hook.
///
/// O teto de tempo não limita memória: em cinco segundos um hook escreve muito
/// mais do que cabe no orçamento de RSS, e ele dispara a cada chamada de
/// ferramenta. O que passa daqui é lido e descartado — parar de ler encheria o
/// pipe e travaria o hook, que é o oposto de falhar aberto.
const MAX_OUTPUT: usize = 64 * 1024;

/// Diretórios varridos, em ordem de precedência crescente.
const HOOK_DIRS: &[&str] = &[".claude/hooks", ".nycode/hooks"];

/// Momento do ciclo de vida em que um hook roda.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Event {
    SessionStart,
    /// O único que pode vetar.
    PreToolUse,
    PostToolUse,
    SessionEnd,
}

impl Event {
    /// Nome do arquivo que responde por este evento.
    #[must_use]
    pub const fn filename(self) -> &'static str {
        match self {
            Self::SessionStart => "session-start",
            Self::PreToolUse => "pre-tool-use",
            Self::PostToolUse => "post-tool-use",
            Self::SessionEnd => "session-end",
        }
    }
}

/// O que o hook recebe em stdin.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Payload {
    pub event: Event,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input: Option<serde_json::Value>,
    /// Saída da ferramenta, em `post-tool-use`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    pub cwd: String,
}

/// O que o hook responde em stdout.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct Response {
    /// `"deny"` veta a chamada. Qualquer outra coisa a deixa passar.
    #[serde(default)]
    pub decision: Option<String>,
    /// A razão que chega ao modelo.
    #[serde(default)]
    pub reason: Option<String>,
}

impl Response {
    #[must_use]
    pub fn is_denial(&self) -> bool {
        self.decision.as_deref() == Some("deny")
    }
}

/// Os hooks descobertos num workspace.
#[derive(Debug, Clone, Default)]
pub struct Hooks {
    /// Executável por evento. O escopo mais específico vence.
    scripts: std::collections::BTreeMap<&'static str, PathBuf>,
    root: PathBuf,
    timeout: Duration,
}

impl Hooks {
    /// Varre o workspace por executáveis de hook.
    #[must_use]
    pub fn discover(root: &Path) -> Self {
        let mut scripts = std::collections::BTreeMap::new();

        for relative in HOOK_DIRS {
            let dir = root.join(relative);
            for event in [
                Event::SessionStart,
                Event::PreToolUse,
                Event::PostToolUse,
                Event::SessionEnd,
            ] {
                let candidate = dir.join(event.filename());
                if is_executable(&candidate) {
                    scripts.insert(event.filename(), candidate);
                }
            }
        }

        Self {
            scripts,
            root: root.to_path_buf(),
            timeout: TIMEOUT,
        }
    }

    /// Encurta o teto de tempo.
    ///
    /// Existe para que o teste do estouro não gaste cinco segundos em toda
    /// execução da suíte.
    #[must_use]
    pub const fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.scripts.is_empty()
    }

    /// Nomes dos eventos com hook, para o cabeçalho da sessão.
    #[must_use]
    pub fn declared(&self) -> Vec<&'static str> {
        self.scripts.keys().copied().collect()
    }

    /// Roda o hook de um evento, se houver.
    ///
    /// Devolve `None` quando não há hook, quando ele falha, quando estoura o
    /// tempo, ou quando responde algo que não é JSON. Nenhum desses casos
    /// bloqueia: falhar aberto é a decisão do ADR-0009.
    pub async fn fire(&self, event: Event, payload: &Payload) -> Option<Response> {
        let program = self.scripts.get(event.filename())?;

        let body = serde_json::to_string(payload).ok()?;
        let run = spawn(program, &self.root, body);

        match tokio::time::timeout(self.timeout, run).await {
            Ok(Some(stdout)) => parse(&stdout, program),
            Ok(None) => None,
            Err(_) => {
                tracing::warn!(
                    hook = %program.display(),
                    "hook excedeu o tempo e foi ignorado"
                );
                None
            }
        }
    }
}

/// Executa o hook e devolve o stdout.
async fn spawn(program: &Path, cwd: &Path, body: String) -> Option<String> {
    use tokio::io::AsyncWriteExt as _;

    let mut child = start(program, cwd).await?;

    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(body.as_bytes()).await;
        // Sem o fechamento, um hook que lê stdin até o fim nunca termina.
        drop(stdin);
    }

    let mut stdout = child.stdout.take()?;
    let kept = read_capped(&mut stdout, MAX_OUTPUT).await;

    // Saída não-zero é falha do hook, e falha de hook é ruidosa (ADR-0009).
    // Descartar o status deixava um hook quebrado ser ignorado em silêncio, que
    // é o desfecho que a restrição existe para impedir: quem instalou um hook de
    // política acha que ele está protegendo.
    match child.wait().await {
        Ok(status) if !status.success() => tracing::warn!(
            hook = %program.display(),
            code = status.code(),
            "hook falhou; a chamada segue porque hook falha aberto"
        ),
        Ok(_) => {}
        Err(err) => tracing::warn!(
            hook = %program.display(),
            %err,
            "nao foi possivel esperar o hook terminar"
        ),
    }

    String::from_utf8(kept).ok()
}

/// Lê o stdout até o fim, guardando no máximo `cap` bytes.
///
/// Drena o que passa do teto em vez de parar de ler: um pipe cheio bloqueia o
/// hook na escrita, e um hook bloqueado só sai pelo prazo — falhar aberto
/// viraria falhar devagar, uma vez por chamada de ferramenta.
async fn read_capped(stdout: &mut tokio::process::ChildStdout, cap: usize) -> Vec<u8> {
    use tokio::io::AsyncReadExt as _;

    let mut kept = Vec::new();
    let mut chunk = [0u8; 8 * 1024];

    while let Ok(read) = stdout.read(&mut chunk).await {
        if read == 0 {
            break;
        }
        let room = cap.saturating_sub(kept.len());
        if room > 0 {
            kept.extend_from_slice(&chunk[..read.min(room)]);
        }
    }

    kept
}

/// Sobe o processo, tentando de novo se o executável estiver sendo escrito.
///
/// `ETXTBSY` significa que alguém ainda tem o arquivo aberto para escrita — um
/// instalador, um formatador, ou o próprio editor do usuário salvando. Desistir
/// pularia em silêncio um hook que existe e está instalado, que é o pior
/// desfecho possível para uma camada de política.
async fn start(program: &Path, cwd: &Path) -> Option<tokio::process::Child> {
    /// Quanto esperar antes da segunda tentativa.
    const SETTLE: Duration = Duration::from_millis(50);

    // O hook roda sob a mesma política do comando de shell (ADR-0009,
    // ADR-0017): é política local, precisa escrever no workspace e não tem por
    // que alcançar a rede.
    let confinement = crate::policy::sandbox::detect_from_path();
    let argv = crate::policy::sandbox::prefix(
        &confinement,
        crate::policy::sandbox::Policy::WorkspaceWrite,
        cwd,
    );

    for attempt in 0..2 {
        let mut command = match argv.split_first() {
            Some((wrapper, rest)) => {
                let mut command = tokio::process::Command::new(wrapper);
                command.args(rest).arg(program);
                command
            }
            // Sem confinamento disponível o hook roda como sempre rodou, e o
            // aviso da sessão é o que diz isso ao usuário.
            None => tokio::process::Command::new(program),
        };
        command
            .current_dir(cwd)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            // Estourar o prazo larga o future, e largar o future não mata
            // processo nenhum: o `Child` do tokio o desanexa no drop. Um hook
            // dispara a cada chamada de ferramenta, então o que fica para trás
            // se acumula ao longo da sessão, ainda escrevendo no workspace.
            .kill_on_drop(true);
        clear_environment(&mut command);
        let started = command.spawn();

        match started {
            Ok(child) => return Some(child),
            Err(err) if err.raw_os_error() == Some(libc_etxtbsy()) && attempt == 0 => {
                tokio::time::sleep(SETTLE).await;
            }
            Err(err) => {
                tracing::warn!(hook = %program.display(), %err, "hook nao pode ser executado");
                return None;
            }
        }
    }
    None
}

/// Variáveis que um hook recebe mesmo com o ambiente limpo.
///
/// Sem `PATH` um hook escrito como `#!/usr/bin/env bash` não acha o próprio
/// interpretador. O que um hook precisa além disto ele lê do contrato JSON, que
/// já carrega a raiz do workspace no campo `cwd`.
const PASSTHROUGH: &[&str] = &["PATH", "HOME", "LANG", "LC_ALL", "TERM", "TMPDIR"];

/// Limpa o ambiente do hook, preservando o mínimo que o faz executar.
///
/// O ambiente do harness carrega as credenciais do usuário. Um hook vem do
/// repositório, roda a cada chamada de ferramenta e alcança a rede: herdá-las
/// faria de qualquer repositório clonado um canal de saída para a chave do
/// gateway.
fn clear_environment(command: &mut tokio::process::Command) {
    command.env_clear();
    for key in PASSTHROUGH {
        if let Some(value) = std::env::var_os(key) {
            command.env(key, value);
        }
    }
}

/// `ETXTBSY`, sem depender de uma crate de constantes de libc.
const fn libc_etxtbsy() -> i32 {
    26
}

/// Interpreta a resposta do hook.
fn parse(stdout: &str, program: &Path) -> Option<Response> {
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        // Silêncio é o caso comum: a maioria dos hooks só observa.
        return None;
    }
    match serde_json::from_str::<Response>(trimmed) {
        Ok(response) => Some(response),
        Err(err) => {
            tracing::warn!(
                hook = %program.display(),
                %err,
                "hook respondeu algo que nao e o contrato JSON, ignorado"
            );
            None
        }
    }
}

/// Se o caminho é um arquivo com bit de execução.
fn is_executable(path: &Path) -> bool {
    let Ok(metadata) = std::fs::metadata(path) else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        // Sem o bit, o arquivo é um rascunho e não um hook: executá-lo
        // produziria um erro a cada chamada de ferramenta.
        metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

#[cfg(test)]
mod hooks_test;
