//! Sessão interativa (FR-1).
//!
//! O modelo é o do scrollback: a conversa é escrita no fluxo do terminal como a
//! de qualquer programa de linha de comando, e só o painel de baixo — editor e
//! rodapé — é redesenhado no lugar. Rolagem, busca e cópia continuam sendo do
//! emulador ([ADR-0008](../../../docs/architecture/decisions/0008-a-tui-usa-o-renderizador-proprio-sobre-o-scrollback.md)).
//!
//! Este módulo é o laço, não o terminal. As duas dependências que o tornariam
//! intestável — para onde desenhar e o que roda um turno — entram por trait, e
//! a ligação com o terminal de verdade vive em [`crate::screen`]. Em modo bruto
//! o `Ctrl+C` não vira `SIGINT`: chega como tecla, e por isso o laço continua
//! lendo eventos enquanto o turno corre.

use crossterm::event::Event;
use futures_util::{Stream, StreamExt};
use nycode_agent::{Cancel, Context, Invocation, Store};
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
}

/// Instrução acrescentada ao sistema em plan mode.
///
/// O gate somente-leitura já impede a mutação; isto diz ao modelo *por que* ela
/// não está disponível. Sem a explicação ele tentaria escrever, receberia
/// recusa, e gastaria rodadas descobrindo o que já era para saber.
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
    /// Conexões MCP vivas, seguradas até o fim da sessão.
    ///
    /// Sem isto o processo do servidor morreria assim que a preparação saísse
    /// de escopo, e a primeira chamada do modelo falharia longe da causa.
    _mcp: Vec<std::sync::Arc<nycode_mcp::Session>>,
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
        quiet: bool,
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
            // As fases interessam a quem mede o arranque, não a quem conversa.
            phases: _,
            lifecycle: _,
            // Quem abre a sessão já recebeu o modelo resolvido por parâmetro.
            model: _,
        } = prepared;

        // Numa sessão interativa há a quem perguntar, então o gate pergunta em
        // vez de decidir de antemão — decidir obrigaria a escolher entre sessão
        // inútil e cheque em branco. Com `--allow-writes` a decisão já foi
        // tomada e não há o que perguntar.
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

        // A fila é pequena de propósito: acumular dez correções para despejar
        // de uma vez confundiria mais que ajudaria.
        let (steering, queued) = tokio::sync::mpsc::channel(4);
        let agent = agent.with_steering(queued);

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
                crate::screen::Agentic::new(agent, persisted, quiet)
                    .rebuilding(rebuild)
                    .with_windows(windows)
                    .restoring(move || {
                        // Sair do plan mode devolve o gate que a sessão tinha, e
                        // não um padrão: com `--allow-writes` ele permitia tudo, e
                        // voltar a perguntar seria mudar a sessão pelas costas.
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
            header: nycode_tui::header(env!("CARGO_PKG_VERSION"), &files, &skills, width),
            commands: context.commands,
            models,
            prices,
            approvals,
            steering: Some(steering),
            branch: None,
            quitting: false,
            planning: false,
            _mcp: mcp,
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
            header: vec!["nycode".to_owned()],
            commands: Vec::new(),
            models: Vec::new(),
            prices: std::collections::BTreeMap::new(),
            approvals: None,
            steering: None,
            branch: None,
            quitting: false,
            planning: false,
            _mcp: Vec::new(),
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
        // O painel sai do caminho: o turno escreve no scrollback, e o painel
        // volta por cima do que ficou.
        surface.emit(&format!("\n{PROMPT}{typed}\n\n"))?;

        // Embutidos primeiro: um `/tree.md` no repositório não pode sequestrar
        // a navegação da sessão.
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
                // Gravar a partir de outro ponto é o que ramifica; o histórico
                // do agente passa a ser o caminho até lá.
                let history = self.store.path_to(&self.id, &record_id)?;
                self.turns.replace_history(history);
                self.branch = Some(record_id);
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
                // O preço acompanha o modelo: cobrar os turnos novos à tarifa
                // do modelo antigo daria um número errado com a mesma cara de
                // um certo.
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

        // Um slash command é expandido aqui e vira um pedido comum. O modelo
        // não sabe que existiu um comando, o que mantém o vocabulário de wire
        // intacto.
        let prompt = match nycode_agent::context::commands::resolve(&typed, &self.commands) {
            Invocation::NotACommand => typed,
            Invocation::Expanded(prompt) => prompt,
            Invocation::Unknown { name, available } => {
                // Mandar `/revisr` ao modelo gastaria um turno para descobrir
                // o erro de digitação.
                surface.emit(&unknown_command(&name, &available))?;
                surface.draw(&self.panel.frame(surface.width()))?;
                return Ok(());
            }
        };

        // Cada turno começa com o sinal intacto. Um Ctrl+C interrompe o turno
        // em que chegou, e não a sessão (ADR-0015).
        self.cancel.rearm();

        let outcome = approval::run_turn(
            self.turns.as_mut(),
            events,
            surface,
            &self.cancel,
            self.approvals.as_mut(),
            self.steering.as_ref(),
            &prompt,
        )
        .await;

        // Persistido antes de reportar erro: as ferramentas que rodaram já
        // mudaram o disco.
        for message in self.turns.drain() {
            // Depois de um `/fork`, o primeiro registro pendura no ponto
            // escolhido; os seguintes seguem a ponta normalmente.
            match self.branch.take() {
                Some(parent) => {
                    self.branch =
                        Some(self.store.append_child(&self.id, Some(&parent), &message)?);
                }
                None => self.store.append(&self.id, &message)?,
            }
        }
        // A partir daqui a ponta do arquivo é o caminho ativo de novo.
        self.branch = None;

        match outcome {
            Ok(usage) => self.panel.absorb(usage),
            Err(err) => surface.emit(&format!("\nerro: {err}\n"))?,
        }
        surface.emit("\n")?;
        surface.draw(&self.panel.frame(surface.width()))?;
        Ok(())
    }
}

/// Mensagem para um comando que não existe.
fn unknown_command(name: &str, available: &[String]) -> String {
    if available.is_empty() {
        return format!("\n/{name} nao existe, e este workspace nao declara nenhum comando.\n\n");
    }
    format!(
        "\n/{name} nao existe. Disponiveis: {}\n\n",
        available
            .iter()
            .map(|c| format!("/{c}"))
            .collect::<Vec<_>>()
            .join(", ")
    )
}

/// Se o evento é o pedido de interrupção.
pub fn interrupts(event: &Event) -> bool {
    matches!(event, Event::Key(key) if nycode_tui::translate(*key) == Key::Interrupt)
}

/// Extrai os prompts do usuário de um histórico retomado.
pub fn previous_prompts(history: &[Message]) -> Vec<String> {
    use nycode_ai::anthropic::{ContentBlock, Role};

    history
        .iter()
        .filter(|message| message.role == Role::User)
        .filter_map(|message| {
            // Uma mensagem de usuário também carrega resultados de ferramenta;
            // esses não são prompts e não pertencem ao histórico do editor.
            let texts: Vec<&str> = message
                .content
                .iter()
                .filter_map(|block| match block {
                    ContentBlock::Text { text } => Some(text.as_str()),
                    _ => None,
                })
                .collect();
            (!texts.is_empty()).then(|| texts.join("\n"))
        })
        .collect()
}

/// Nomes dos arquivos de contexto e das skills que a sessão carregou.
#[must_use]
pub fn loaded(context: &Context, root: &std::path::Path) -> (Vec<String>, Vec<String>) {
    let files = context
        .instructions
        .iter()
        .map(|instruction| crate::session::paths::display_relative(&instruction.path, root))
        .collect();
    let skills = context.skills.iter().map(|s| s.name.clone()).collect();
    (files, skills)
}

pub mod approval;
pub mod builtin;

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
pub(crate) mod fakes;
#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
mod tests;
