//! Comandos embutidos da sessão interativa.
//!
//! Distintos dos slash commands de arquivo em algo essencial: aqueles expandem
//! para um prompt e vão ao modelo; estes agem sobre a própria sessão e nunca
//! gastam um turno. `/tree` não é um pedido ao modelo, é uma pergunta sobre o
//! que já aconteceu.
//!
//! Resolvidos antes dos de arquivo: um `/tree.md` no repositório não pode
//! sequestrar a navegação da sessão.

use std::fmt::Write as _;

use nycode_agent::Store;
use nycode_ai::anthropic::{ContentBlock, Message, Role};

/// O que um comando embutido pediu.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Effect {
    /// Não é embutido; segue para os comandos de arquivo.
    Passthrough,
    /// Escrever isto e continuar.
    Show(String),
    /// Encerrar a sessão.
    Quit,
    /// Passar a gravar a partir deste registro.
    Fork { record_id: String, shown: String },
    /// Compactar o histórico agora.
    Compact,
    /// Entrar ou sair do modo de planejamento.
    TogglePlan,
    /// Trocar de modelo, mantendo a conversa.
    SwitchModel(String),
}

/// Nome e resumo de cada embutido, para o `/help`.
const BUILTINS: &[(&str, &str)] = &[
    ("/help", "lista os comandos disponiveis"),
    ("/tree", "mostra os pontos de retomada desta sessao"),
    ("/fork <n>", "passa a gravar a partir do ponto <n> de /tree"),
    ("/plan", "entra ou sai do modo de planejamento"),
    ("/model [id]", "lista os modelos, ou troca para <id>"),
    ("/compact", "compacta o historico agora"),
    ("/export", "escreve a conversa em markdown no stdout"),
    ("/session", "mostra id, arquivo e tamanho desta sessao"),
    ("/copy", "mostra a ultima resposta do agente"),
    ("/new", "comeca uma sessao nova, sem o historico atual"),
    ("/reload", "rele instrucoes, skills e comandos do disco"),
    ("/quit", "encerra a sessao"),
];

/// O que a sessão tem a oferecer, para os embutidos que listam.
///
/// Um struct e não dois parâmetros: as duas listas são `&[String]`, e trocá-las
/// de posição compilaria sem reclamação nenhuma.
#[derive(Debug, Default, Clone, Copy)]
pub struct Available<'a> {
    pub commands: &'a [String],
    pub models: &'a [String],
}

/// Resolve uma linha contra os comandos embutidos.
pub fn resolve(line: &str, store: &Store, id: &str, available: &Available<'_>) -> Effect {
    let trimmed = line.trim();
    let Some(rest) = trimmed.strip_prefix('/') else {
        return Effect::Passthrough;
    };
    let (name, argument) = rest.split_once(char::is_whitespace).unwrap_or((rest, ""));

    match name {
        "help" => Effect::Show(help(available.commands)),
        "tree" => Effect::Show(tree(store, id)),
        "fork" => fork(store, id, argument.trim()),
        "plan" => Effect::TogglePlan,
        "model" => model(argument.trim(), available.models),
        "compact" => Effect::Compact,
        "export" => Effect::Show(export(store, id)),
        "session" => Effect::Show(stats(store, id)),
        "copy" => Effect::Show(copy_last(store, id)),
        "new" => Effect::Show(format!("\nnova sessao: {id}\n\n")),
        "reload" => Effect::Show("\nrecursos recarregados\n\n".to_owned()),
        "quit" | "exit" => Effect::Quit,
        _ => Effect::Passthrough,
    }
}

/// Lista os modelos, ou escolhe um.
///
/// Sem argumento lista: trocar exige saber o que existe, e o usuário não tem
/// como adivinhar o identificador que o endpoint aceita.
fn model(argument: &str, models: &[String]) -> Effect {
    if argument.is_empty() {
        if models.is_empty() {
            return Effect::Show(
                "\nnenhum modelo conhecido; o catalogo do endpoint nao foi obtido\n\n".to_owned(),
            );
        }
        let listed = models
            .iter()
            .map(|id| format!("  {id}"))
            .collect::<Vec<_>>()
            .join("\n");
        return Effect::Show(format!(
            "\nmodelos disponiveis:\n{listed}\n\n  /model <id> troca\n\n"
        ));
    }

    // Recusar antes de trocar: um identificador errado so falharia no proximo
    // turno, quando o gateway recusasse, longe da causa.
    if !models.is_empty() && !models.iter().any(|id| id == argument) {
        return Effect::Show(format!(
            "\no endpoint nao serve `{argument}`; use /model para ver a lista\n\n"
        ));
    }
    Effect::SwitchModel(argument.to_owned())
}

/// Listagem de tudo que pode ser digitado.
fn help(available: &[String]) -> String {
    let mut out = String::from("\ncomandos:\n");
    for (name, summary) in BUILTINS {
        let _ = writeln!(out, "  {name:<14} {summary}");
    }
    if !available.is_empty() {
        out.push_str("\ndeste workspace:\n");
        for name in available {
            let _ = writeln!(out, "  /{name}");
        }
    }
    out.push('\n');
    out
}

/// Os pontos a partir dos quais a sessão pode ser retomada.
///
/// Só os turnos do usuário: ramificar do meio de uma resposta do modelo
/// produziria um histórico que o backend recusa, porque deixaria um `tool_use`
/// sem o `tool_result` correspondente.
fn tree(store: &Store, id: &str) -> String {
    let points = resume_points(store, id);
    if points.is_empty() {
        return "\nnada gravado nesta sessao ainda.\n\n".to_owned();
    }

    let mut out = String::from("\npontos de retomada:\n");
    for (index, (_, summary)) in points.iter().enumerate() {
        let _ = writeln!(out, "  {:>3}  {summary}", index + 1);
    }
    let _ = writeln!(out, "\n  /fork <n> passa a gravar a partir do ponto <n>\n");
    out
}

/// Passa a gravar a partir de um ponto anterior.
fn fork(store: &Store, id: &str, argument: &str) -> Effect {
    let points = resume_points(store, id);
    let Ok(chosen) = argument.parse::<usize>() else {
        return Effect::Show(format!(
            "\n/fork precisa do numero de um ponto de /tree; veio `{argument}`\n\n"
        ));
    };

    let Some((record_id, summary)) = chosen.checked_sub(1).and_then(|i| points.get(i)) else {
        return Effect::Show(format!(
            "\n/fork {chosen} nao existe; ha {} pontos\n\n",
            points.len()
        ));
    };

    Effect::Fork {
        record_id: record_id.clone(),
        shown: format!("\nretomando de: {summary}\n\n"),
    }
}

fn stats(store: &Store, id: &str) -> String {
    let Ok(path) = store.path_for(id) else {
        return format!("\nsessao invalida: {id}\n\n");
    };
    let messages = store.load(id).map_or(0, |m| m.len());
    let bytes = std::fs::metadata(&path).map_or(0, |m| m.len());
    let nome = crate::session::name_of(store, id).unwrap_or_else(|| "(sem nome)".to_owned());
    format!(
        "\nsessao: {id}\nnome: {nome}\narquivo: {}\nmensagens: {messages}\nbytes: {bytes}\n\n",
        path.display()
    )
}

fn copy_last(store: &Store, id: &str) -> String {
    let text = store.load(id).ok().and_then(|messages| {
        messages
            .into_iter()
            .rev()
            .find(|m| m.role == Role::Assistant)
            .map(|m| render(&m))
    });
    match text {
        Some(text) => format!("\nultima resposta:\n\n{text}\n\n"),
        None => "\nnenhuma resposta do agente para copiar.\n\n".to_owned(),
    }
}

/// A conversa em markdown.
fn export(store: &Store, id: &str) -> String {
    let Ok(messages) = store.load(id) else {
        return "\nnada gravado nesta sessao ainda.\n\n".to_owned();
    };

    let mut out = format!("\n# sessao {id}\n\n");
    for message in &messages {
        let who = match message.role {
            Role::User => "usuario",
            Role::Assistant => "nycode",
        };
        let _ = writeln!(out, "## {who}\n\n{}\n", render(message));
    }
    out
}

/// O texto de uma mensagem, para exibição.
fn render(message: &Message) -> String {
    let parts: Vec<String> = message
        .content
        .iter()
        .map(|block| match block {
            ContentBlock::Text { text } => text.clone(),
            ContentBlock::ToolUse { name, .. } => format!("_(chamou `{name}`)_"),
            ContentBlock::ToolResult { .. } => "_(resultado de ferramenta)_".to_owned(),
            ContentBlock::Image { .. } => "_(imagem anexada)_".to_owned(),
        })
        .collect();
    parts.join("\n\n")
}

/// Os registros de usuário, com um resumo de uma linha cada.
fn resume_points(store: &Store, id: &str) -> Vec<(String, String)> {
    let Ok(records) = store.records(id) else {
        return Vec::new();
    };

    records
        .into_iter()
        .filter(|record| record.message.role == Role::User)
        .filter_map(|record| {
            let record_id = record.id?;
            // Um resultado de ferramenta também é papel `user` no wire, e
            // oferecê-lo como ponto de retomada quebraria o par `tool_use`.
            if matches!(
                record.message.content.first(),
                Some(ContentBlock::ToolResult { .. })
            ) {
                return None;
            }
            Some((record_id, summarize(&render(&record.message))))
        })
        .collect()
}

/// Uma linha de no máximo 70 caracteres.
fn summarize(text: &str) -> String {
    let single: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if single.chars().count() <= 70 {
        return single;
    }
    format!("{}...", single.chars().take(67).collect::<String>())
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
#[path = "builtin_test.rs"]
mod builtin_test;
