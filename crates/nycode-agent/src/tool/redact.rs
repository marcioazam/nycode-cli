use std::sync::{Arc, Mutex};

use super::ToolOutput;

#[cfg(test)]
const PLANTED: &str = "sk-test-agt06-secret";

#[must_use]
pub fn apply(mut output: ToolOutput) -> ToolOutput {
    output.content = secrets(&output.content);
    output
}

#[must_use]
pub fn secrets(text: &str) -> String {
    let mut out = redact_prefixed(text, "sk-");
    out = redact_prefixed(&out, "ghp_");
    out
}

fn redact_prefixed(text: &str, prefix: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find(prefix) {
        out.push_str(&rest[..at]);
        out.push_str("[redacted]");
        rest = &rest[at + prefix.len()..];
        let skip = rest
            .find(|ch: char| !ch.is_ascii_alphanumeric() && ch != '-' && ch != '_')
            .unwrap_or(rest.len());
        rest = &rest[skip..];
    }
    out.push_str(rest);
    out
}

#[derive(Debug)]
pub struct Binding {
    slot: Arc<Mutex<Option<String>>>,
}

impl Binding {
    #[must_use]
    pub fn plant(secret: impl Into<String>) -> Self {
        Self {
            slot: Arc::new(Mutex::new(Some(secret.into()))),
        }
    }

    #[must_use]
    pub fn slot(&self) -> Arc<Mutex<Option<String>>> {
        Arc::clone(&self.slot)
    }
}

impl Drop for Binding {
    fn drop(&mut self) {
        if let Ok(mut slot) = self.slot.lock() {
            *slot = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_planted_secret_does_not_reach_the_model_block() {
        let output = apply(ToolOutput::ok(format!("token {PLANTED} leaked")));
        let rendered = format!("{:?}", output.into_blocks("t1"));
        assert!(!rendered.contains(PLANTED), "{rendered}");
        assert!(!rendered.contains("sk-test"), "{rendered}");
        assert!(rendered.contains("[redacted]"), "{rendered}");
    }

    #[test]
    fn a_github_token_prefix_is_redacted() {
        let redacted = secrets("auth ghp_abcdefghijklmnopqrstuvwxyz012345");
        assert!(!redacted.contains("ghp_abcdefghijklmnopqrstuvwxyz012345"));
        assert!(redacted.contains("[redacted]"));
    }

    #[test]
    fn extra_credential_binding_is_gone_when_execute_returns() {
        let binding = Binding::plant(PLANTED);
        let slot = binding.slot();
        assert_eq!(slot.lock().expect("slot").as_deref(), Some(PLANTED));
        drop(binding);
        assert!(slot.lock().expect("slot").is_none());
    }
}
