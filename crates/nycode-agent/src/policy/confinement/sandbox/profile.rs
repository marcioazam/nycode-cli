//! De uma política ao `argv` que a impõe.
//!
//! Vive separado da detecção porque muda por outro motivo: [`super`] muda
//! quando uma plataforma ou uma ferramenta de sandbox muda, isto muda quando a
//! política muda. São dois eixos, e juntá-los faria uma política nova mexer no
//! código que decide se há sandbox.

use std::path::Path;

use super::Confinement;

/// O que um processo confinado alcança.
///
/// Quem invoca escolhe; o processo confinado não escolhe o próprio confinamento
/// ([ADR-0017](../../../../../docs/architecture/decisions/0017-duas-politicas-de-confinamento.md)).
///
/// As duas são assimétricas porque os riscos são. O comando de shell precisa
/// escrever no workspace e não precisa de rede: um comando que baixa código sai
/// do que o usuário revisou. O servidor MCP é o oposto — falar com uma API é a
/// razão de ele existir, e editar arquivo é trabalho das ferramentas, que passam
/// pela contenção de caminho.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Policy {
    /// Escrita na raiz e no temporário, rede negada. Comando de shell e hook.
    WorkspaceWrite,
    /// Escrita só no temporário, rede permitida. Servidor MCP por stdio.
    NetworkClient,
}

impl Policy {
    /// Se a raiz do workspace é gravável sob esta política.
    #[must_use]
    pub const fn writes_to_workspace(self) -> bool {
        matches!(self, Self::WorkspaceWrite)
    }

    /// Se a rede é alcançável sob esta política.
    #[must_use]
    pub const fn reaches_network(self) -> bool {
        matches!(self, Self::NetworkClient)
    }
}

#[must_use]
pub fn wrap(confinement: &Confinement, root: &Path, argv: &[String]) -> Vec<String> {
    let mut out = prefix(confinement, Policy::WorkspaceWrite, root);
    out.extend(argv.iter().cloned());
    out
}

/// O prefixo de confinamento, ao qual o chamador anexa o próprio `argv`.
///
/// Existe separado de [`wrap`] porque nem todo processo confinado é um comando
/// de shell: um hook é um executável e um servidor MCP é programa mais
/// argumentos. Devolver só o prefixo deixa o chamador montar o resto sem que
/// esta camada precise saber a forma de cada um.
///
/// Vazio quando não há confinamento — o chamador roda o processo como sempre
/// rodou, e o aviso é o que diz isso ao usuário.
#[must_use]
pub fn prefix(confinement: &Confinement, policy: Policy, root: &Path) -> Vec<String> {
    match confinement {
        Confinement::Bubblewrap { program } => bubblewrap_prefix(program, policy, root),
        Confinement::Seatbelt { program } => vec![
            program.clone(),
            "-p".to_owned(),
            seatbelt_profile(policy, root),
        ],
        Confinement::Unavailable { .. } => Vec::new(),
    }
}

fn bubblewrap_prefix(program: &str, policy: Policy, root: &Path) -> Vec<String> {
    let root = root.display().to_string();
    // Todo o sistema entra somente-leitura, nas duas políticas: um agente
    // precisa do toolchain e das bibliotecas, e um servidor precisa do próprio
    // runtime.
    let mut argv = vec![
        program.to_owned(),
        "--ro-bind".to_owned(),
        "/".to_owned(),
        "/".to_owned(),
    ];

    if policy.writes_to_workspace() {
        // A raiz é remontada com escrita por cima. Só para quem edita: um
        // servidor MCP responde perguntas, e editar é trabalho das ferramentas,
        // que passam pela contenção de caminho.
        argv.extend(["--bind".to_owned(), root.clone(), root.clone()]);
    }

    argv.extend([
        "--bind".to_owned(),
        "/tmp".to_owned(),
        "/tmp".to_owned(),
        "--dev".to_owned(),
        "/dev".to_owned(),
        "--proc".to_owned(),
        "/proc".to_owned(),
    ]);

    if !policy.reaches_network() {
        argv.push("--unshare-net".to_owned());
    }

    argv.extend([
        // O processo vira PID 1 de um namespace próprio, e terminá-lo leva
        // junto tudo que ele iniciou. Sem isto, matar o `bash` no estouro de
        // prazo deixaria os netos rodando (ADR-0015).
        "--unshare-pid".to_owned(),
        // Sem isto o filho sobrevive ao harness e fica órfão.
        "--die-with-parent".to_owned(),
        "--chdir".to_owned(),
        root,
    ]);

    argv
}

/// Perfil Seatbelt equivalente à política pedida.
fn seatbelt_profile(policy: Policy, root: &Path) -> String {
    let network = if policy.reaches_network() {
        "(allow network*)"
    } else {
        "(deny network*)"
    };
    let workspace = if policy.writes_to_workspace() {
        format!(
            "(allow file-write* (subpath \"{}\"))",
            sbpl_literal(&root.display().to_string())
        )
    } else {
        String::new()
    };

    format!(
        "(version 1)\
         (allow default)\
         {network}\
         (deny file-write*)\
         {workspace}\
         (allow file-write* (subpath \"/tmp\"))\
         (allow file-write* (subpath \"/private/tmp\"))"
    )
}

/// Escapa um caminho para dentro de um literal de string do SBPL.
///
/// O perfil é texto e a raiz entra entre aspas. Uma aspa crua fecha o literal, e
/// o resto do caminho passa a ser lido como política — devolvendo ao comando
/// exatamente o que a política acabou de negar. Aspa e barra invertida são
/// legais em nome de diretório no macOS, então isto não é hipotético para quem
/// escolhe onde clonar.
///
/// A barra invertida é escapada primeiro: fazer o contrário deixaria um caminho
/// terminado em `\` escapar a aspa de fechamento, que é a mesma fuga por outra
/// porta.
fn sbpl_literal(raw: &str) -> String {
    raw.replace('\\', r"\\").replace('"', "\\\"")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bwrap() -> Confinement {
        Confinement::Bubblewrap {
            program: "bwrap".to_owned(),
        }
    }

    fn args(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|p| (*p).to_owned()).collect()
    }

    #[test]
    fn without_confinement_the_command_runs_as_it_always_did() {
        // Degradar precisa ser degradar, nao quebrar: o comando ainda roda, e o
        // aviso e o que diz ao usuario o que mudou.
        let ausente = Confinement::Unavailable {
            reason: "teste".to_owned(),
        };
        assert_eq!(
            wrap(&ausente, Path::new("/w"), &args(&["echo", "oi"])),
            vec!["echo", "oi"]
        );
    }

    #[test]
    fn the_shell_is_not_a_login_shell() {
        // Um shell de login carrega `/etc/profile` e o perfil do usuario, o que
        // devolve para dentro do confinamento o ambiente que a allowlist acabou
        // de tirar — e cobra o arranque do perfil em cada comando.
        for confinement in [
            bwrap(),
            Confinement::Seatbelt {
                program: "sandbox-exec".to_owned(),
            },
            Confinement::Unavailable {
                reason: "teste".to_owned(),
            },
        ] {
            let argv = wrap(&confinement, Path::new("/w"), &args(&["echo", "oi"]));
            assert!(
                !argv.contains(&"-lc".to_owned()) && !argv.contains(&"-l".to_owned()),
                "{confinement:?} ainda usa shell de login: {argv:?}"
            );
            assert!(
                !argv.contains(&"-c".to_owned()),
                "{confinement:?} ainda envolve `-c`: {argv:?}"
            );
        }
    }

    #[test]
    fn without_confinement_the_prefix_is_empty_rather_than_pretending() {
        let ausente = Confinement::Unavailable {
            reason: "teste".to_owned(),
        };
        assert!(prefix(&ausente, Policy::WorkspaceWrite, Path::new("/w")).is_empty());
        assert!(prefix(&ausente, Policy::NetworkClient, Path::new("/w")).is_empty());
    }

    #[test]
    fn bubblewrap_mounts_the_system_read_only_and_the_workspace_writable() {
        let argv = wrap(&bwrap(), Path::new("/w/proj"), &args(&["cargo", "test"])).join(" ");

        assert!(argv.contains("--ro-bind / /"), "{argv}");
        assert!(argv.contains("--bind /w/proj /w/proj"), "{argv}");
        assert!(argv.ends_with("cargo test"), "{argv}");
    }

    #[test]
    fn bubblewrap_denies_the_network_to_a_shell_command() {
        // Um comando que baixa codigo sai do que o usuario revisou.
        let argv = wrap(&bwrap(), Path::new("/w"), &args(&["curl", "exemplo.com"]));
        assert!(argv.contains(&"--unshare-net".to_owned()), "{argv:?}");
    }

    #[test]
    fn bubblewrap_does_not_leave_orphans_behind() {
        let argv = wrap(&bwrap(), Path::new("/w"), &args(&["sleep", "999"]));
        assert!(argv.contains(&"--die-with-parent".to_owned()), "{argv:?}");
    }

    #[test]
    fn bubblewrap_puts_the_command_in_its_own_pid_namespace() {
        // Sem isto, matar o `bash` no estouro de prazo deixaria os netos
        // rodando, ainda escrevendo no workspace.
        let argv = wrap(&bwrap(), Path::new("/w"), &args(&["sleep", "999"]));
        assert!(argv.contains(&"--unshare-pid".to_owned()), "{argv:?}");
    }

    #[test]
    fn the_server_policy_keeps_the_network_and_the_shell_policy_does_not() {
        // Negar rede a um servidor cuja razao de existir e falar com uma API o
        // inutiliza, e o usuario o desabilita para recuperar a funcao — que e
        // pior que confinamento nenhum, porque parece protecao.
        let shell = prefix(&bwrap(), Policy::WorkspaceWrite, Path::new("/w"));
        assert!(shell.contains(&"--unshare-net".to_owned()), "{shell:?}");

        let servidor = prefix(&bwrap(), Policy::NetworkClient, Path::new("/w"));
        assert!(
            !servidor.contains(&"--unshare-net".to_owned()),
            "{servidor:?}"
        );
    }

    #[test]
    fn the_server_policy_does_not_make_the_workspace_writable() {
        // Um servidor MCP responde perguntas; editar arquivo e trabalho das
        // ferramentas, que passam pela contencao de caminho.
        let servidor = prefix(&bwrap(), Policy::NetworkClient, Path::new("/w/proj")).join(" ");

        assert!(!servidor.contains("--bind /w/proj"), "{servidor}");
        assert!(servidor.contains("--ro-bind / /"), "{servidor}");
        assert!(servidor.contains("--bind /tmp /tmp"), "{servidor}");
    }

    #[test]
    fn the_seatbelt_profile_denies_writes_outside_the_workspace() {
        let profile = seatbelt_profile(Policy::WorkspaceWrite, Path::new("/Users/alguem/proj"));

        assert!(profile.contains("(deny file-write*)"), "{profile}");
        assert!(
            profile.contains("(allow file-write* (subpath \"/Users/alguem/proj\"))"),
            "{profile}"
        );
        assert!(profile.contains("(deny network*)"), "{profile}");
    }

    #[test]
    fn the_server_seatbelt_profile_allows_the_network_and_no_workspace_write() {
        let profile = seatbelt_profile(Policy::NetworkClient, Path::new("/w/proj"));

        assert!(profile.contains("(allow network*)"), "{profile}");
        assert!(profile.contains("(deny file-write*)"), "{profile}");
        assert!(!profile.contains("subpath \"/w/proj\""), "{profile}");
    }

    #[test]
    fn the_seatbelt_invocation_passes_the_profile_inline() {
        let seatbelt = Confinement::Seatbelt {
            program: "sandbox-exec".to_owned(),
        };
        let argv = wrap(&seatbelt, Path::new("/w"), &args(&["ls"]));

        assert_eq!(argv[1], "-p");
        assert!(argv[2].contains("(version 1)"), "{argv:?}");
        assert_eq!(argv.last().map(String::as_str), Some("ls"));
    }

    #[test]
    fn a_workspace_path_cannot_close_the_profile_string() {
        // Aspa e barra invertida sao legais em nome de diretorio no macOS. Crua,
        // a aspa fecha o literal e o que vem depois deixa de ser dado e vira
        // politica: devolve ao comando o que a politica acabou de negar.
        let hostil = Path::new(r#"/w/x")(allow network*"#);
        let profile = seatbelt_profile(Policy::WorkspaceWrite, hostil);

        assert!(
            profile.contains(r#"/w/x\")(allow network*"#),
            "a aspa precisa chegar escapada: {profile}"
        );
    }

    #[test]
    fn a_backslash_in_the_workspace_path_is_escaped_before_the_quote() {
        // Escapar so a aspa deixaria um caminho terminado em `\` escapar a aspa
        // de fechamento — a mesma fuga por outra porta.
        let profile = seatbelt_profile(Policy::WorkspaceWrite, Path::new(r"/w/a\b"));
        assert!(profile.contains(r"/w/a\\b"), "{profile}");
    }

    #[test]
    fn the_command_is_never_split_or_reinterpreted() {
        // Passar o comando como argumento unico de `bash -lc` e o que preserva
        // aspas, pipes e redirecionamento. Quebra-lo mudaria o que roda.
        let tricky = r#"echo "um dois" | grep dois > saida.txt"#;
        for confinement in [
            bwrap(),
            Confinement::Seatbelt {
                program: "sandbox-exec".to_owned(),
            },
            Confinement::Unavailable {
                reason: "x".to_owned(),
            },
        ] {
            let argv = wrap(&confinement, Path::new("/w"), &args(&[tricky]));
            assert_eq!(
                argv.last().map(String::as_str),
                Some(tricky),
                "{confinement:?}"
            );
        }
    }
}
