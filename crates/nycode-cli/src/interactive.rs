//! Sessão interativa (FR-1).
//!
//! Scrollback no fluxo do terminal; só o painel de baixo redesenha no lugar
//! ([ADR-0008](../../../docs/architecture/decisions/0008-a-tui-usa-o-renderizador-proprio-sobre-o-scrollback.md)).
//! Superfície e turnos entram por trait. Em modo bruto o `Ctrl+C` chega como
//! tecla, e o laço continua lendo enquanto o turno corre.

use clap::Parser as _;
use crossterm::event::Event;
use futures_util::{Stream, StreamExt};
use nycode_agent::{Cancel, Invocation, Store};
use nycode_ai::Usage;
use nycode_ai::anthropic::Message;
use nycode_tui::Key;

/// Prefixo da primeira linha do editor.
pub const PROMPT: &str = "› ";
/// Prefixo das linhas seguintes.
pub const CONTINUATION: &str = "  ";

/// Para onde o painel é desenhado e o scrollback recebe texto.
pub trait Surface {
    /// Desenha o painel, redesenhando apenas o que mudou.
    fn draw(&mut self, frame: &[String]) -> std::io::Result<()>;
    /// Acrescenta texto ao scrollback, acima do painel.
    fn emit(&mut self, text: &str) -> std::io::Result<()>;
    fn width(&self) -> usize;
    fn resize(&mut self, width: usize);
}

/// O que o laço precisa de um agente.
///
/// É uma interface pequena sobre uma implementação grande de propósito: o laço
/// não conhece backend, ferramenta nem observer.
#[async_trait::async_trait]
pub trait Turns: Send {
    /// Roda um pedido até o fim, atendendo o cancelamento.
    async fn run(&mut self, prompt: &str) -> anyhow::Result<Usage>;
    /// Mensagens acrescentadas desde a última coleta, para persistir.
    fn drain(&mut self) -> Vec<Message>;
    /// Histórico já existente, para semear o editor numa sessão retomada.
    fn history(&self) -> Vec<Message>;
    /// Substitui o histórico, ao retomar de outro ponto da árvore.
    fn replace_history(&mut self, messages: Vec<Message>);
    /// Compacta agora, devolvendo quantas mensagens saíram.
    async fn compact(&mut self) -> usize;
    /// Entra ou sai do plan mode.
    fn set_planning(&mut self, planning: bool);
    /// Troca o modelo, mantendo a conversa.
    fn switch_model(&mut self, model: &str) -> anyhow::Result<()>;
    fn set_system(&mut self, system: String);
    fn retarget_backend(&mut self, session_id: &str, model: &str) -> anyhow::Result<()>;
}

/// Em plan mode o gate já impede mutação; isto explica o porquê ao modelo.
pub const PLAN_SYSTEM: &str = "\n\nMODO DE PLANEJAMENTO: nesta fase voce nao pode \
     modificar nada — escrita, edicao e execucao de comando estao desligadas, e \
     tentar usa-las so gasta uma rodada. Investigue com as ferramentas de \
     leitura e entregue um plano: o que sera mudado, em que ordem, e o que pode \
     dar errado. O usuario sai deste modo com /plan quando aprovar.";

pub mod panel;
pub use panel::{Panel, Step, step};

/// Uma sessão interativa pronta para rodar.
///
/// Junta o que a sessão precisa e não sabe onde vai ser desenhada: a superfície
/// e o fluxo de eventos chegam em [`Session::run`]. É essa separação que deixa
/// o comportamento inteiro verificável sem um TTY.
pub struct Session {
    panel: Panel,
    turns: Box<dyn Turns>,
    cancel: Cancel,
    store: Store,
    id: String,
    root: std::path::PathBuf,
    header: Vec<String>,
    commands: Vec<nycode_agent::Command>,
    /// Fila de pedidos de aprovação, quando a sessão pergunta.
    approvals: Option<approval::Approvals>,
    /// Canal por onde o que o usuário digita durante o turno chega ao agente.
    steering: Option<tokio::sync::mpsc::Sender<String>>,
    /// Ponto do qual o próximo registro descende, depois de um `/fork`.
    branch: Option<String>,
    /// Pedido de encerramento vindo de `/quit`.
    quitting: bool,
    /// Se a sessão está em modo de planejamento.
    planning: bool,
    /// Modelos que o endpoint serve, para `/model`.
    models: Vec<String>,
    /// Tarifas por modelo, para o rodapé mostrar custo e não só volume.
    prices: std::collections::BTreeMap<String, nycode_ai::catalog::Price>,
    /// Servidores MCP vivos até o fim da sessão.
    _mcp: Vec<std::sync::Arc<nycode_mcp::Session>>,
    /// Pedidos para depois deste turno, sem injetar no turno corrente.
    later: Option<tokio::sync::mpsc::Sender<String>>,
    follow_up: Option<tokio::sync::mpsc::Receiver<String>>,
    system: Option<String>,
    append_system: Option<String>,
}

impl std::fmt::Debug for Session {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Sem o histórico: um `Session` num log de erro não pode vazar a
        // conversa do usuário.
        f.debug_struct("Session")
            .field("id", &self.id)
            .finish_non_exhaustive()
    }
}

impl Session {
    /// Monta a sessão a partir do que a preparação resolveu.
    pub fn open(
        prepared: crate::session::Prepared,
        model: String,
        writable: bool,
        cli: &crate::Cli,
        width: usize,
    ) -> Self {
        let crate::session::Prepared {
            agent,
            cancel,
            store,
            session_id,
            persisted,
            context,
            root,
            mcp,
            models,
            prices,
            windows,
            rebuild,
            sampling,
            // As fases interessam a quem mede o arranque, não a quem conversa.
            phases: _,
            lifecycle: _,
            // Quem abre a sessão já recebeu o modelo resolvido por parâmetro.
            model: _,
        } = prepared;

        // Com `--allow-writes` a decisão já foi tomada; senão o gate pergunta.
        let (agent, approvals) = if writable {
            (agent, None)
        } else {
            let (approver, inbox) = nycode_agent::policy::Asking::channel();
            (
                agent
                    .with_gate(Box::new(nycode_agent::policy::Ask))
                    .with_approver(std::sync::Arc::new(approver)),
                Some(inbox),
            )
        };

        let (steering, queued) = tokio::sync::mpsc::channel(4);
        let agent = agent.with_steering(queued);
        let (later, follow_up) = tokio::sync::mpsc::channel(4);

        let (files, skills) = loaded(&context, &root);
        let price = prices.get(&model).cloned();
        Self {
            panel: Panel::new(
                crate::session::paths::display_path(&root),
                session_id.clone(),
                model,
                writable,
                price,
            ),
            turns: Box::new(
                crate::screen::Agentic::new(agent, persisted, cli.quiet)
                    .rebuilding(rebuild)
                    .with_sampling(sampling)
                    .with_windows(windows)
                    .restoring(move || {
                        // `--allow-writes` devolve AllowAll; senão volta a perguntar.
                        if writable {
                            Box::new(nycode_agent::AllowAll)
                        } else {
                            Box::new(nycode_agent::policy::Ask)
                        }
                    }),
            ),
            cancel,
            store,
            id: session_id,
            root,
            header: nycode_tui::header(env!("CARGO_PKG_VERSION"), &files, &skills, width),
            commands: context.commands,
            models,
            prices,
            approvals,
            steering: Some(steering),
            later: Some(later),
            follow_up: Some(follow_up),
            branch: None,
            quitting: false,
            planning: false,
            _mcp: mcp,
            system: cli.system.clone(),
            append_system: cli.append_system.clone(),
        }
    }

    /// Monta uma sessão com um agente arbitrário.
    #[cfg(test)]
    fn with_turns(turns: Box<dyn Turns>, store: Store, id: &str) -> Self {
        Self {
            panel: Panel::new(
                "~/proj".to_owned(),
                id.to_owned(),
                "nylla-sonnet-4.5".to_owned(),
                true,
                None,
            ),
            turns,
            cancel: Cancel::new(),
            store,
            id: id.to_owned(),
            root: std::path::PathBuf::new(),
            header: vec!["nycode".to_owned()],
            commands: Vec::new(),
            models: Vec::new(),
            prices: std::collections::BTreeMap::new(),
            approvals: None,
            steering: None,
            later: None,
            follow_up: None,
            branch: None,
            quitting: false,
            planning: false,
            _mcp: Vec::new(),
            system: None,
            append_system: None,
        }
    }

    /// Semeia os comandos disponíveis.
    #[cfg(test)]
    fn with_commands(mut self, commands: Vec<nycode_agent::Command>) -> Self {
        self.commands = commands;
        self
    }

    /// Compartilha o sinal de cancelamento com o agente, como a preparação faz.
    #[cfg(test)]
    fn with_cancel(mut self, cancel: Cancel) -> Self {
        self.cancel = cancel;
        self
    }

    #[cfg(test)]
    fn pending_follow_up(mut self, text: &str) -> Self {
        let (tx, rx) = tokio::sync::mpsc::channel(1);
        let _ = tx.try_send(text.to_owned());
        self.follow_up = Some(rx);
        self
    }

    /// Roda até o usuário sair ou os eventos acabarem.
    pub async fn run<S, E>(&mut self, surface: &mut S, events: &mut E) -> anyhow::Result<()>
    where
        S: Surface,
        E: Stream<Item = std::io::Result<Event>> + Unpin,
    {
        for line in &self.header {
            surface.emit(&format!("{line}\n"))?;
        }
        surface.emit("\n")?;

        // O histórico do editor vem da sessão retomada: quem usa `--continue`
        // espera a seta para cima devolver o que já pediu.
        self.panel
            .editor_mut()
            .seed_history(previous_prompts(&self.turns.history()));

        surface.draw(&self.panel.frame(surface.width()))?;

        while let Some(event) = events.next().await {
            let event = event?;
            if let Event::Resize(cols, _) = event {
                surface.resize(cols as usize);
            }

            match step(&event, self.panel.editor_mut()) {
                Step::Idle => {}
                Step::Redraw => surface.draw(&self.panel.frame(surface.width()))?,
                Step::Quit => break,
                Step::Submit(typed) => {
                    self.take_turn(surface, events, typed).await?;
                    while !self.quitting {
                        let Some(next) = self.next_follow_up() else {
                            break;
                        };
                        self.take_turn(surface, events, next).await?;
                    }
                    if self.quitting {
                        break;
                    }
                }
            }
        }
        Ok(())
    }

    /// Trata um pedido do usuário, do eco ao redesenho do painel.
    async fn take_turn<S, E>(
        &mut self,
        surface: &mut S,
        events: &mut E,
        typed: String,
    ) -> anyhow::Result<()>
    where
        S: Surface,
        E: Stream<Item = std::io::Result<Event>> + Unpin,
    {
        surface.emit(&format!("\n{PROMPT}{typed}\n\n"))?;
        self.apply_if_session_op(&typed, surface.width())?;

        let names: Vec<String> = self.commands.iter().map(|c| c.name.clone()).collect();
        let available = builtin::Available {
            commands: &names,
            models: &self.models,
        };
        match builtin::resolve(&typed, &self.store, &self.id, &available) {
            builtin::Effect::Passthrough => {}
            builtin::Effect::Show(text) => {
                surface.emit(&text)?;
                surface.draw(&self.panel.frame(surface.width()))?;
                return Ok(());
            }
            builtin::Effect::Quit => {
                self.quitting = true;
                return Ok(());
            }
            builtin::Effect::Fork { record_id, shown } => {
                self.resume_from(record_id)?;
                surface.emit(&shown)?;
                surface.draw(&self.panel.frame(surface.width()))?;
                return Ok(());
            }
            builtin::Effect::TogglePlan => {
                self.planning = !self.planning;
                self.turns.set_planning(self.planning);
                surface.emit(if self.planning {
                    "\nmodo de planejamento: nada sera modificado ate voce sair com /plan\n\n"
                } else {
                    "\nmodo de planejamento desligado\n\n"
                })?;
                surface.draw(&self.panel.frame(surface.width()))?;
                return Ok(());
            }
            builtin::Effect::SwitchModel(model) => {
                self.turns.switch_model(&model)?;
                let price = self.prices.get(&model).cloned();
                self.panel.set_model(model.clone(), price);
                surface.emit(&format!("\nmodelo agora: {model}\n\n"))?;
                surface.draw(&self.panel.frame(surface.width()))?;
                return Ok(());
            }
            builtin::Effect::Compact => {
                let removed = self.turns.compact().await;
                self.panel.compacted();
                surface.emit(&format!(
                    "\n{removed} mensagens antigas foram compactadas\n\n"
                ))?;
                surface.draw(&self.panel.frame(surface.width()))?;
                return Ok(());
            }
        }

        let prompt = match nycode_agent::context::commands::resolve(&typed, &self.commands) {
            Invocation::NotACommand => typed,
            Invocation::Expanded(prompt) => prompt,
            Invocation::Unknown { name, available } => {
                surface.emit(&unknown_command(&name, &available))?;
                surface.draw(&self.panel.frame(surface.width()))?;
                return Ok(());
            }
        };

        self.cancel.rearm();

        let outcome = approval::run_turn(
            self.turns.as_mut(),
            events,
            surface,
            &self.cancel,
            self.approvals.as_mut(),
            self.steering.as_ref(),
            self.later.as_ref(),
            &prompt,
        )
        .await;

        for message in self.turns.drain() {
            match self.branch.take() {
                Some(parent) => {
                    self.branch =
                        Some(self.store.append_child(&self.id, Some(&parent), &message)?);
                }
                None => self.store.append(&self.id, &message)?,
            }
        }
        self.branch = None;

        match outcome {
            Ok(usage) => self.panel.absorb(usage),
            Err(err) => surface.emit(&format!("\nerro: {err}\n"))?,
        }
        surface.emit("\n")?;
        surface.draw(&self.panel.frame(surface.width()))?;
        Ok(())
    }

    fn next_follow_up(&mut self) -> Option<String> {
        self.follow_up.as_mut()?.try_recv().ok()
    }

    fn apply_if_session_op(&mut self, typed: &str, width: usize) -> anyhow::Result<()> {
        let name = typed.trim().strip_prefix('/').map(|rest| {
            rest.split_once(char::is_whitespace)
                .map_or(rest, |(n, _)| n)
        });
        match name {
            Some("new") => {
                self.id = Store::new_id();
                self.branch = None;
                self.turns.replace_history(Vec::new());
                self.panel.retarget(self.id.clone());
                self.panel.editor_mut().clear_history();
                let model = self.panel.model().to_owned();
                self.turns.retarget_backend(&self.id, &model)?;
            }
            Some("reload") => self.reload_resources(width)?,
            _ => {}
        }
        Ok(())
    }

    fn resume_from(&mut self, record_id: String) -> anyhow::Result<()> {
        let next = self.store.path_to(&self.id, &record_id)?;
        let note = nycode_agent::session::compaction::notice(
            nycode_agent::session::compaction::abandoned(&self.turns.history(), &next),
        );
        let (history, branch) = match note {
            Some(note) => {
                let id =
                    self.store
                        .append_child(&self.id, Some(&record_id), &Message::user(note))?;
                (self.store.path_to(&self.id, &id)?, id)
            }
            None => (next, record_id),
        };
        self.turns.replace_history(history);
        self.branch = Some(branch);
        Ok(())
    }

    fn reload_resources(&mut self, width: usize) -> anyhow::Result<()> {
        let context = nycode_agent::Context::discover(&self.root);
        let mut cli =
            crate::Cli::try_parse_from(["nycode"]).map_err(|err| anyhow::anyhow!("{err}"))?;
        cli.system.clone_from(&self.system);
        cli.append_system.clone_from(&self.append_system);
        let system = context.system_prompt(
            &crate::invocation::prompt::resolve(&cli, &self.root)?,
            &self.root,
            cli.trust_workspace_instructions,
        );
        self.turns.set_system(system);
        if self.planning {
            self.turns.set_planning(true);
        }
        let (files, skills) = loaded(&context, &self.root);
        self.commands = context.commands;
        self.header = nycode_tui::header(env!("CARGO_PKG_VERSION"), &files, &skills, width);
        Ok(())
    }
}

/// Se o evento é o pedido de interrupção.
pub fn interrupts(event: &Event) -> bool {
    matches!(event, Event::Key(key) if nycode_tui::translate(*key) == Key::Interrupt)
}

mod text;
use text::unknown_command;
pub use text::{loaded, previous_prompts};

pub mod approval;
pub mod builtin;

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
pub(crate) mod fakes;
#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
mod session_ops_test;
#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
mod tests;
