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

mod contract;

pub use contract::{Event, Payload, Response};

use std::path::{Path, PathBuf};
use std::time::Duration;

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

/// Os eventos que de fato disparam.
///
/// São os quatro que o ADR-0009 desenhou. A lista continua existindo, e a
/// descoberta continua consultando-a em vez de aceitar qualquer nome de
/// arquivo, porque é ela que impede um evento de aparecer no cabeçalho da
/// sessão como ativo sem rodar: quem o instalasse pararia de procurar, e um
/// controle anunciado e inexistente é pior que a ausência dele.
const FIRED: &[Event] = &[
    Event::SessionStart,
    Event::PreToolUse,
    Event::PostToolUse,
    Event::SessionEnd,
];

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
            for event in FIRED {
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

    /// Se algum executável responde por este evento.
    ///
    /// Quem dispara consulta antes de montar o payload. O de `post-tool-use`
    /// carrega uma cópia da saída da ferramenta, e num workspace sem hook
    /// nenhum essa cópia seria paga a cada chamada para ser descartada logo em
    /// seguida.
    #[must_use]
    pub fn has(&self, event: Event) -> bool {
        self.scripts.contains_key(event.filename())
    }

    /// Nomes dos eventos com hook, para o cabeçalho da sessão.
    #[must_use]
    pub fn declared(&self) -> Vec<&'static str> {
        self.scripts.keys().copied().collect()
    }

    /// Como cada hook se apresenta ao pedido de consentimento (ADR-0016).
    ///
    /// A impressão digital cobre o conteúdo do executável e não o caminho:
    /// reescrever o script sob um nome já confiado é a forma que o rug pull
    /// toma aqui. Um script ilegível vira conteúdo vazio, o que muda a
    /// impressão e faz o consentimento ser pedido de novo — que é o desfecho
    /// seguro.
    #[must_use]
    pub fn declarations(&self) -> Vec<crate::policy::trust::Declaration> {
        self.scripts
            .iter()
            .map(|(event, path)| {
                let content = std::fs::read(path).unwrap_or_default();
                crate::policy::trust::Declaration::covering(
                    *event,
                    path.display().to_string(),
                    String::from_utf8_lossy(&content),
                )
            })
            .collect()
    }

    /// Mantém apenas os hooks cujos nomes foram autorizados.
    #[must_use]
    pub fn retaining(mut self, allowed: &std::collections::BTreeSet<String>) -> Self {
        self.scripts.retain(|event, _| allowed.contains(*event));
        self
    }

    /// Roda o hook de um evento, se houver.
    ///
    /// Devolve `None` quando não há hook, quando ele falha, quando estoura o
    /// tempo, ou quando responde algo que não é JSON. Nenhum desses casos
    /// bloqueia: falhar aberto é a decisão do ADR-0009.
    pub async fn fire(&self, event: Event, payload: &Payload) -> Option<Response> {
        let program = self.scripts.get(event.filename())?;

        let body = serde_json::to_string(payload).ok()?;
        let stdout = spawn(program, &self.root, body, self.timeout).await?;
        parse(&stdout, program)
    }
}

/// Executa o hook e devolve o stdout, cortando no prazo.
///
/// O prazo é aplicado aqui dentro e não em volta da chamada porque quem estoura
/// precisa poder matar o processo e **esperar** que ele morra. Largar o future
/// conta com o `kill_on_drop`, que envia o sinal e segue em frente: o `bwrap`
/// morre, o script confinado ainda tem a janela até o namespace cair, e sob
/// carga essa janela chega a durar mais que o teste que a mede.
async fn spawn(program: &Path, cwd: &Path, body: String, limit: Duration) -> Option<String> {
    let mut child = start(program, cwd).await?;
    // A anotação é o que alcança este hook se o processo morrer por sinal: ali
    // nenhum `drop` roda, e o grupo destacado ficaria de pé. Ela sai sozinha em
    // todo caminho que colhe o filho, inclusive no `drop` deste future.
    let _tracked = crate::policy::confinement::process::shared().track(&child);

    let stdin = child.stdin.take();
    let mut stdout = child.stdout.take()?;

    // A escrita fica **dentro** do prazo, junto com a leitura. O payload de
    // `post-tool-use` carrega saída de ferramenta e passa do buffer do cano, e
    // ali `write_all` espera o hook ler: fora do prazo, um hook que não lê o
    // stdin penduraria a chamada de ferramenta sem teto nenhum.
    let piped = async move {
        use tokio::io::AsyncWriteExt as _;

        // O hook le o contrato do `stdin` inteiro, sem linha de controle a
        // frente: qualquer byte a mais seria lido pelo script como payload.
        if let Some(mut stdin) = stdin {
            let _ = stdin.write_all(body.as_bytes()).await;
            // Largar o `stdin` aqui é o que o fecha, e sem o fechamento um hook
            // que lê até o fim nunca termina.
        }
        read_capped(&mut stdout, MAX_OUTPUT).await
    };

    let Ok(kept) = tokio::time::timeout(limit, piped).await else {
        tracing::warn!(
            hook = %program.display(),
            "hook excedeu o tempo e foi interrompido"
        );
        // Matar o grupo cobre o neto; matar so o lider o deixava orfao, e
        // sob confinamento isso significava um processo escrevendo no
        // workspace depois de o harness ter dito que o interrompeu.
        crate::policy::confinement::process::kill(&mut child);
        let _ = child.wait().await;
        return None;
    };

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
    start_with(
        program,
        cwd,
        &crate::policy::confinement::sandbox::detect_from_path(),
    )
    .await
}

/// O mesmo, com o confinamento escolhido.
///
/// A escolha é parâmetro porque o ramo sem wrapper e os erros de `exec` são
/// comportamento de segurança que precisa ser exercitável numa máquina que
/// tenha `bwrap` instalado.
async fn start_with(
    program: &Path,
    cwd: &Path,
    confinement: &crate::policy::confinement::sandbox::Confinement,
) -> Option<tokio::process::Child> {
    /// Quanto esperar antes da segunda tentativa.
    const SETTLE: Duration = Duration::from_millis(50);

    // O hook roda sob a mesma política do comando de shell (ADR-0009,
    // ADR-0017): é política local, precisa escrever no workspace e não tem por
    // que alcançar a rede.
    let argv = crate::policy::confinement::sandbox::prefix(
        confinement,
        crate::policy::confinement::sandbox::Policy::WorkspaceWrite,
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
        // Um hook vem do repositório e alcança a rede: herdar o ambiente do
        // harness faria de qualquer clone um canal de saída para a credencial.
        crate::policy::confinement::environment::clear(&mut command);
        // Líder de um grupo próprio: terminar é sinalizar o grupo e o líder.
        // O processo lançado pelo `bwrap` herda o grupo mesmo dentro do novo
        // namespace de PID; o teste da sentinela prova a propriedade que
        // importa, em vez de inferi-la da topologia dos namespaces.
        crate::policy::confinement::process::detach(&mut command);
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
