//! O hook descoberto não pode mudar de conteúdo antes de rodar.

#![allow(clippy::unwrap_used, clippy::panic)]

use super::hooks_test::{hook, payload, write_hook};
use super::{Event, Hooks};

#[tokio::test]
async fn a_hook_changed_after_discovery_is_not_executed() {
    let root = hook(".nycode/hooks", Event::PreToolUse, "echo antes");
    let hooks = Hooks::discover(root.path());

    write_hook(
        root.path(),
        ".nycode/hooks",
        Event::PreToolUse,
        "echo depois",
    );

    assert!(
        hooks
            .fire(Event::PreToolUse, &payload("bash"))
            .await
            .is_none()
    );
}
