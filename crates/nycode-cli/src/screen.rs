//! Posse do terminal durante a sessão interativa.
//!
//! Tudo que precisa de um TTY de verdade mora aqui, para que o laço em
//! [`crate::interactive`] não precise de um. Entrar em modo bruto, traduzir o
//! fim de linha, desenhar o painel e rodar o turno contra o agente: as três
//! últimas são verificáveis com um `Vec<u8>` e um backend de mentira, e só a
//! primeira exige terminal.
//!
//! Em modo bruto o terminal para de converter `\n` em "desce e volta para a
//! coluna zero", então um texto escrito sem cuidado sai em escada.

use std::io::Write;

use std::sync::Arc;

use nycode_agent::Agent;
use nycode_ai::Usage;
use nycode_ai::anthropic::Message;
use nycode_tui::Terminal;

use crate::interactive::{Surface, Turns};
use crate::output;

mod raw;

pub use raw::{Crlf, RawMode};

/// Painel desenhado num terminal de verdade.
///
/// Genérico sobre o destino porque é o único jeito de afirmar num teste o que a
/// apresentação produz — inclusive que um quadro inalterado não escreve nada.
#[derive(Debug)]
pub struct Panel<W: Write> {
    terminal: Terminal<Crlf<W>>,
    width: usize,
}

impl<W: Write> Panel<W> {
    pub fn new(out: W, width: usize) -> Self {
        Self {
            terminal: Terminal::new(Crlf::new(out), width),
            width,
        }
    }

    /// Bytes já emitidos, para inspeção em teste.
    #[cfg(test)]
    pub fn written(&self) -> &[u8]
    where
        W: AsRef<[u8]>,
    {
        self.terminal.inner().inner().as_ref()
    }
}

impl<W: Write + Send> Surface for Panel<W> {
    fn draw(&mut self, frame: &[String]) -> std::io::Result<()> {
        self.terminal.draw(frame)?;
        Ok(())
    }

    /// Acrescenta ao scrollback, sem deixar o texto controlar o terminal.
    ///
    /// O scrollback recebe conteúdo que o harness não escreveu — o que `/tree`
    /// mostra de uma sessão, a mensagem de erro que carrega saída de comando, o
    /// que foi enfileirado. Com o escape intacto, esse texto sobe linhas e
    /// escreve por cima do que já estava ali, e o que estava ali pode ter sido a
    /// pergunta de aprovação.
    ///
    /// A limpeza é aqui e não no `draw`: o painel emite escape de propósito —
    /// posicionamento de cursor e saída sincronizada — e é o próprio harness que
    /// o compõe.
    fn emit(&mut self, text: &str) -> std::io::Result<()> {
        self.terminal.emit(&nycode_agent::sanitize::plain(text))
    }

    fn width(&self) -> usize {
        self.width
    }

    fn resize(&mut self, width: usize) {
        self.width = width;
        self.terminal.resize(width);
    }
}

/// Roda turnos contra o agente de verdade.
///
/// Guarda quantas mensagens já foram entregues para persistência: o histórico
/// do agente cresce a cada turno, e regravar o começo dele a cada volta
/// duplicaria a sessão inteira no disco.
pub struct Agentic {
    agent: Agent,
    /// Prompt de sistema sem o adendo de plan mode.
    ///
    /// Guardado porque sair do modo precisa restaurar o original, e concatenar
    /// e depois recortar por substring quebraria no dia em que o adendo mudar.
    base_system: String,
    /// Como o gate era antes de o plan mode desligá-lo.
    restore: Box<dyn Fn() -> Box<dyn nycode_agent::Gate> + Send>,
    /// Como construir um backend para outro modelo.
    ///
    /// Uma fábrica e não um cliente pronto porque o modelo só é conhecido
    /// quando o usuário pede a troca.
    rebuild: crate::session::Rebuild,
    /// Janela de contexto por modelo, como o catálogo a declarou.
    ///
    /// Fica aqui e não no painel porque quem a usa é o agente: é com ela que
    /// ele percebe que o provider truncou a entrada e respondeu assim mesmo.
    windows: std::collections::BTreeMap<String, u64>,
    drained: usize,
    quiet: bool,
}

impl std::fmt::Debug for Agentic {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Agentic")
            .field("drained", &self.drained)
            .field("quiet", &self.quiet)
            .finish_non_exhaustive()
    }
}

impl Agentic {
    pub fn new(agent: Agent, persisted: usize, quiet: bool) -> Self {
        Self {
            base_system: agent.system().unwrap_or_default().to_owned(),
            restore: Box::new(|| Box::new(nycode_agent::ReadOnly)),
            rebuild: Box::new(|model| anyhow::bail!("esta sessao nao sabe trocar para `{model}`")),
            windows: std::collections::BTreeMap::new(),
            agent,
            drained: persisted,
            quiet,
        }
    }

    /// As janelas de contexto que o catálogo declarou, por modelo.
    ///
    /// Sem elas a troca de modelo deixaria o agente comparando o usage do novo
    /// contra o limite do antigo.
    #[must_use]
    pub fn with_windows(mut self, windows: std::collections::BTreeMap<String, u64>) -> Self {
        self.windows = windows;
        self
    }

    /// A janela que o agente carrega agora, para conferência em teste.
    #[cfg(test)]
    pub const fn context_window(&self) -> Option<u64> {
        self.agent.context_window()
    }

    /// Como construir o backend de outro modelo.
    #[must_use]
    pub fn rebuilding(
        mut self,
        rebuild: impl Fn(&str) -> anyhow::Result<Arc<dyn nycode_agent::Backend>> + Send + 'static,
    ) -> Self {
        self.rebuild = Box::new(rebuild);
        self
    }

    /// Como o gate deve voltar ao sair do plan mode.
    #[must_use]
    pub fn restoring(
        mut self,
        restore: impl Fn() -> Box<dyn nycode_agent::Gate> + Send + 'static,
    ) -> Self {
        self.restore = Box::new(restore);
        self
    }
}

#[async_trait::async_trait]
impl Turns for Agentic {
    async fn run(&mut self, prompt: &str) -> anyhow::Result<Usage> {
        let mut sink = output::text::Stdout::with_writers(
            Crlf::new(std::io::stdout()),
            Crlf::new(std::io::stderr()),
            self.quiet,
        );
        let result = self.agent.run(prompt, &mut sink).await;
        sink.finish();

        match result {
            Ok(outcome) => Ok(outcome.usage),
            // Cancelar não é erro a reportar: o usuário sabe que cancelou, e o
            // que rodou antes já está no histórico esperando para ser gravado.
            Err(nycode_agent::Error::Cancelled) => Ok(Usage::default()),
            Err(err) => Err(err.into()),
        }
    }

    fn drain(&mut self) -> Vec<Message> {
        let history = self.agent.history();
        let new = history[self.drained.min(history.len())..].to_vec();
        self.drained = history.len();
        new
    }

    fn history(&self) -> Vec<Message> {
        self.agent.history().to_vec()
    }

    fn replace_history(&mut self, messages: Vec<Message>) {
        // Tudo que está no novo histórico já veio do disco; marcar como
        // drenado impede que o `/fork` regrave o caminho inteiro.
        self.drained = messages.len();
        self.agent.set_history(messages);
    }

    fn set_planning(&mut self, planning: bool) {
        // O gate é a contenção de verdade; a instrução só explica ao modelo
        // por que a ferramenta não está lá.
        self.agent.set_gate(if planning {
            Box::new(nycode_agent::ReadOnly)
        } else {
            (self.restore)()
        });

        let base = self.base_system.clone();
        self.agent.set_system(Some(if planning {
            format!("{base}{}", crate::interactive::PLAN_SYSTEM)
        } else {
            base
        }));
    }

    fn switch_model(&mut self, model: &str) -> anyhow::Result<()> {
        // O histórico fica: continuar a mesma conversa com outro modelo é o
        // ponto — recomeçar já dava para fazer abrindo outra sessão.
        self.agent.set_backend((self.rebuild)(model)?);
        // A janela acompanha o modelo. Deixar a do anterior compararia o usage
        // do novo contra o limite do antigo — e um modelo maior seria acusado
        // de truncar o que coube, um menor truncaria sem ninguém notar.
        self.agent
            .set_context_window(self.windows.get(model).copied());
        Ok(())
    }

    async fn compact(&mut self) -> usize {
        let removed = self.agent.compact_now().await;
        // O histórico encolheu; sem reancorar, o próximo `drain` fatiaria além
        // do fim e devolveria vazio para sempre.
        self.drained = self.drained.min(self.agent.history().len());
        removed
    }
}

/// Detecta a largura do terminal, com um padrão razoável quando não há um.
#[must_use]
pub fn detect_width() -> usize {
    Terminal::<Vec<u8>>::detect_width()
}

/// Toma posse do terminal para uma sessão interativa.
///
/// As únicas linhas do binário que exigem um TTY de verdade, reunidas aqui para
/// que o resto do caminho interativo continue verificável sem um.
pub fn acquire() -> std::io::Result<(RawMode, Panel<std::io::Stdout>, usize)> {
    let raw = RawMode::enter()?;
    let width = detect_width();
    Ok((raw, Panel::new(std::io::stdout(), width), width))
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
#[path = "screen/screen_test.rs"]
mod screen_test;
