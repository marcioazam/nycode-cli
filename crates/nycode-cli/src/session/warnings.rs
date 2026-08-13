//! O que a sessão diz ao usuário antes do primeiro turno.
//!
//! Três avisos, e os três existem pela mesma razão: uma diferença entre o que
//! o usuário acha que está ligado e o que está ligado de fato só é dele para
//! decidir se ele souber dela. Separados da montagem porque mudam por outro
//! motivo — a montagem muda quando muda a ordem de armar as peças, isto muda
//! quando muda o que precisa ser dito.

/// Se o comando de shell é alcançável nesta sessão.
///
/// Duas portas levam a ele. `--allow-writes` troca o gate por um que permite
/// tudo; e a sessão interativa usa o gate `Ask`, que chega a `bash` mediante
/// aprovação no prompt — sem flag nenhuma.
///
/// A segunda porta é a que estava sem aviso: o critério era a sessão ser
/// gravável, então quem aprovava um comando no prompt de uma sessão interativa
/// o fazia acreditando que ele estava contido.
pub(super) const fn bash_is_reachable(
    grant: crate::invocation::grant::Grant,
    interactive: bool,
) -> bool {
    grant.decides_everything() || interactive
}

/// O que o usuário precisa saber antes do primeiro turno.
///
/// FR-11: rodar sem confinamento em silêncio é a degradação que o NFR-4 proíbe.
/// A diferença entre "protegido" e "achou que estava protegido" é a única que
/// importa aqui, e só o usuário pode decidir se ela é aceitável. Onde `bash` não
/// é alcançável não há o que confinar, e o aviso seria ruído.
pub(super) fn startup_warnings(shell_reachable: bool) -> Vec<String> {
    shell_reachable
        .then(nycode_agent::sandbox::detect_from_path)
        .and_then(|confinement| confinement.warning())
        .into_iter()
        .collect()
}

/// Quais hooks o repositório instalou.
///
/// Silêncio quando não há nenhum: anunciar uma lista vazia treina o usuário a
/// ignorar a linha, e é justamente ela que precisa ser lida no dia em que um
/// hook aparecer sem ele saber.
pub(super) fn hooks_notice(hooks: &nycode_agent::policy::Hooks) -> Option<String> {
    if hooks.is_empty() {
        return None;
    }
    Some(format!("hooks ativos: {}", hooks.declared().join(", ")))
}

#[cfg(test)]
mod policy_test {
    use super::*;

    fn call(name: &str) -> nycode_agent::ToolCall {
        nycode_agent::ToolCall {
            id: "t1".to_owned(),
            name: name.to_owned(),
            input: serde_json::Value::Null,
        }
    }

    #[test]
    fn a_subagent_inherits_the_grant_of_whoever_called_it() {
        // Um filho que pudesse mais que o pai seria uma escada de privilegio
        // (FR-15). A heranca virou literal quando a concessao virou um valor: o
        // subagente recebe o mesmo `Grant`, entao o mesmo gate.
        use crate::invocation::grant::Grant;

        assert!(!Grant::ReadOnly.gate().check(&call("write")).is_allowed());
        assert!(Grant::Writes.gate().check(&call("write")).is_allowed());
        assert!(!Grant::Writes.gate().check(&call("bash")).is_allowed());
        assert!(Grant::All.gate().check(&call("bash")).is_allowed());
    }

    #[test]
    fn a_read_only_session_is_not_warned_about_a_sandbox_it_does_not_need() {
        // Nao ha o que confinar, e o aviso seria ruido.
        assert!(startup_warnings(false).is_empty());
    }

    #[test]
    fn an_interactive_session_reaches_bash_without_any_flag() {
        // O gate `Ask` chega a `bash` por aprovacao no prompt. Amarrar o aviso
        // ao `--allow-writes` deixava quem aprova acreditando que o comando
        // estava contido, que e a degradacao silenciosa da ADR-0005.
        use crate::invocation::grant::Grant;

        assert!(
            bash_is_reachable(Grant::ReadOnly, true),
            "interativa sem flag"
        );
        assert!(
            bash_is_reachable(Grant::All, false),
            "headless com --allow-all"
        );
    }

    #[test]
    fn writing_alone_does_not_reach_bash_in_a_headless_session() {
        // `--allow-writes` concede escrita de arquivo e so ela; sem interlocutor
        // nao ha por onde `bash` entrar, e avisar ali seria ruido.
        use crate::invocation::grant::Grant;

        assert!(!bash_is_reachable(Grant::ReadOnly, false));
        assert!(!bash_is_reachable(Grant::Writes, false));
    }

    #[test]
    fn a_writable_session_is_silent_only_when_the_policy_denies_by_default() {
        // O resultado depende da maquina; o que se protege e a correspondencia
        // entre o silencio e a unica postura que o dispensa. Amarrar isto a
        // `is_enforced` deixaria o Seatbelt — que permite por omissao — passar
        // por equivalente ao `bubblewrap` e calar o aviso do FR-8.
        use nycode_agent::sandbox::Strength;

        let warned = !startup_warnings(true).is_empty();
        let strength = nycode_agent::sandbox::detect_from_path().strength();
        assert_eq!(warned, strength != Strength::Restrictive);
    }

    #[test]
    fn a_workspace_without_hooks_says_nothing() {
        // Anunciar lista vazia treina o usuario a ignorar a linha, e e ela que
        // precisa ser lida no dia em que um hook aparecer sem ele saber.
        let dir = tempfile::tempdir().unwrap();
        let hooks = nycode_agent::policy::Hooks::discover(dir.path());
        assert_eq!(hooks_notice(&hooks), None);
    }

    fn install(root: &std::path::Path, event: &str) {
        let path = root.join(".nycode/hooks").join(event);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "#!/bin/sh\nexit 0").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
    }

    #[test]
    fn a_workspace_with_hooks_names_them() {
        let dir = tempfile::tempdir().unwrap();
        install(dir.path(), "pre-tool-use");

        let hooks = nycode_agent::policy::Hooks::discover(dir.path());
        let notice = hooks_notice(&hooks).expect("ha um hook");
        assert!(notice.contains("pre-tool-use"), "{notice}");
    }

    #[test]
    fn the_header_names_every_hook_that_runs_and_not_a_subset_of_them() {
        // O cabecalho e como o usuario descobre que o repositorio instalou uma
        // politica. Um evento que roda e nao aparece ali e o mesmo defeito que
        // um evento que aparece e nao roda, visto do outro lado.
        let dir = tempfile::tempdir().unwrap();
        for event in [
            "session-start",
            "pre-tool-use",
            "post-tool-use",
            "session-end",
        ] {
            install(dir.path(), event);
        }

        let hooks = nycode_agent::policy::Hooks::discover(dir.path());
        let notice = hooks_notice(&hooks).expect("ha hooks");
        for event in [
            "session-start",
            "pre-tool-use",
            "post-tool-use",
            "session-end",
        ] {
            assert!(notice.contains(event), "{event} nao aparece em {notice}");
        }
    }
}
