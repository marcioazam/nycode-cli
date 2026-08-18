use nycode_agent::Context;
use nycode_ai::anthropic::{ContentBlock, Message, Role};

pub(super) fn unknown_command(name: &str, available: &[String]) -> String {
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

pub fn previous_prompts(history: &[Message]) -> Vec<String> {
    history
        .iter()
        .filter(|message| message.role == Role::User)
        .filter_map(|message| {
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
