use super::*;
use crate::policy::confinement::sandbox;

fn workspace() -> (tempfile::TempDir, ToolContext) {
    let dir = tempfile::tempdir().unwrap();
    let ctx = ToolContext::new(dir.path()).unwrap();
    (dir, ctx)
}

fn call(parts: &[&str]) -> Value {
    json!({ "argv": parts })
}

fn script(dir: &tempfile::TempDir, body: &str) -> Value {
    std::fs::write(dir.path().join("t.sh"), body).unwrap();
    json!({ "argv": ["bash", "t.sh"] })
}

/// A ferramenta sem confinamento e com o ambiente no mínimo.
///
/// Os testes de comportamento da ferramenta — captura de saida, codigo de
/// erro — sao sobre a ferramenta, nao sobre o sandbox nem sobre a
/// configuracao de quem roda a suite.
fn bare() -> Bash {
    Bash::default()
        .with_confinement(Confinement::Unavailable {
            reason: "teste".to_owned(),
        })
        .with_environment(Allowlist::default())
}

#[tokio::test]
async fn captures_stdout_of_a_successful_command() {
    let (_dir, ctx) = workspace();
    let out = bare().execute(call(&["echo", "ola"]), &ctx).await;

    assert!(!out.is_error);
    assert!(out.content.contains("ola"));
    assert!(out.content.contains("stdout"));
}

#[tokio::test]
async fn a_nonzero_exit_is_marked_as_an_error() {
    // Sem a marcacao o modelo seguiria como se o teste tivesse passado.
    let (dir, ctx) = workspace();
    let out = bare().execute(script(&dir, "exit 3"), &ctx).await;

    assert!(out.is_error);
    assert!(out.content.contains("codigo de saida 3"));
}

#[tokio::test]
async fn stderr_is_captured_alongside_stdout() {
    let (dir, ctx) = workspace();
    let out = bare()
        .execute(script(&dir, "echo saida; echo erro >&2"), &ctx)
        .await;

    assert!(out.content.contains("saida"));
    assert!(out.content.contains("erro"));
    assert!(out.content.contains("--- stderr ---"));
}

#[tokio::test]
async fn the_command_runs_in_the_workspace_root() {
    let (dir, ctx) = workspace();
    std::fs::write(dir.path().join("marcador.txt"), "x").unwrap();

    let out = bare().execute(call(&["ls"]), &ctx).await;
    assert!(out.content.contains("marcador.txt"));
}

#[tokio::test]
async fn a_timeout_reaches_the_model_as_a_failure() {
    // O texto da mensagem e do `launch`; o que se protege aqui e que ela
    // chega marcada como erro, e nao como saida normal de um comando.
    let (_dir, ctx) = workspace();
    let bash = Bash::with_timeout(Duration::from_millis(200))
        .with_confinement(Confinement::Unavailable {
            reason: "teste".to_owned(),
        })
        .with_environment(Allowlist::default());

    let out = bash.execute(call(&["sleep", "30"]), &ctx).await;

    assert!(out.is_error);
    assert!(out.content.contains("excedeu"), "{}", out.content);
}

#[tokio::test]
async fn a_per_call_timeout_overrides_the_construction_deadline() {
    let (_dir, ctx) = workspace();
    let bash = Bash::with_timeout(Duration::from_secs(30))
        .with_confinement(Confinement::Unavailable {
            reason: "teste".to_owned(),
        })
        .with_environment(Allowlist::default());

    let out = bash
        .execute(json!({ "argv": ["sleep", "30"], "timeout": 1 }), &ctx)
        .await;
    assert!(out.is_error, "{}", out.content);
    assert!(out.content.contains("1s"), "{}", out.content);
}

#[tokio::test]
async fn a_zero_timeout_is_refused_before_running() {
    let (_dir, ctx) = workspace();
    let out = bare()
        .execute(json!({ "argv": ["true"], "timeout": 0 }), &ctx)
        .await;
    assert!(out.is_error);
    assert!(out.content.contains("timeout"), "{}", out.content);
}

#[tokio::test]
async fn oversized_output_is_truncated_and_says_so() {
    let (dir, ctx) = workspace();
    let out = bare()
        .execute(
            script(&dir, "head -c 200000 /dev/zero | tr '\\0' 'x'"),
            &ctx,
        )
        .await;

    assert!(out.content.contains("[truncado"));
}

#[tokio::test]
async fn an_empty_or_missing_command_is_reported() {
    let (_dir, ctx) = workspace();
    assert!(bare().execute(json!({}), &ctx).await.is_error);
    assert!(
        bare()
            .execute(json!({ "argv": ["   "] }), &ctx)
            .await
            .is_error
    );
}

#[tokio::test]
async fn a_silent_successful_command_says_it_produced_nothing() {
    // String vazia faria o modelo achar que a ferramenta falhou. O `bare()`
    // roda sem confinamento, entao a resposta tambem carrega esse fato —
    // que e o que a ADR-0005 exige e o que o `output` monta.
    let (_dir, ctx) = workspace();
    let out = bare().execute(call(&["true"]), &ctx).await;

    assert!(!out.is_error);
    assert!(out.content.ends_with("(sem saida)"), "{}", out.content);
}

#[tokio::test]
async fn an_unconfined_command_carries_the_fact_into_the_model_answer() {
    // A outra metade do nao negociavel da ADR-0005: o aviso em `stderr`
    // fala com o usuario, isto fala com o modelo.
    let (_dir, ctx) = workspace();
    let out = bare().execute(call(&["echo", "oi"]), &ctx).await;

    assert!(
        out.content.starts_with(output::UNCONFINED),
        "{}",
        out.content
    );
}

#[tokio::test]
async fn a_write_outside_the_workspace_is_stopped_by_the_operating_system() {
    // E o criterio de aceite do FR-11: barrado pelo sistema, nao pela
    // politica do harness — que um `cd ..` contornaria.
    //
    // O alvo precisa ser um lugar onde o usuario normalmente escreve, senao
    // a permissao do proprio sistema de arquivos barraria de qualquer jeito
    // e o teste nao distinguiria nada. `/tmp` nao serve: a politica o monta
    // gravavel de proposito, porque todo build precisa dele.
    let Some(home) = std::env::var_os("HOME").map(std::path::PathBuf::from) else {
        return;
    };
    let alvo = home.join(format!(".nycode-sonda-{}.tmp", std::process::id()));
    let _ = std::fs::remove_file(&alvo);

    let (dir, ctx) = workspace();
    let body = format!("echo invadi > {}", alvo.display());

    let confinement = sandbox::detect_from_path();
    if !confinement.is_enforced() {
        assert!(confinement.warning().is_some());
        return;
    }

    let out = Bash::default().execute(script(&dir, &body), &ctx).await;
    let escaped = alvo.exists();
    let _ = std::fs::remove_file(&alvo);

    assert!(
        !escaped,
        "a escrita fora da raiz precisa ser barrada pelo sistema: {}",
        out.content
    );
    assert!(
        out.is_error,
        "o comando barrado precisa falhar: {}",
        out.content
    );
}

#[tokio::test]
async fn the_network_is_out_of_reach_under_confinement() {
    // Um comando que baixa codigo sai do que o usuario revisou. E a
    // dimensao mais limpa de verificar: nao depende de permissao de
    // arquivo nenhuma.
    let (dir, ctx) = workspace();
    if !matches!(sandbox::detect_from_path(), Confinement::Bubblewrap { .. }) {
        return;
    }

    let out = Bash::default()
        .execute(script(&dir, "exec 3<>/dev/tcp/1.1.1.1/80"), &ctx)
        .await;

    assert!(
        out.is_error,
        "a rede precisa estar fora de alcance: {}",
        out.content
    );
}

#[tokio::test]
async fn a_write_inside_the_workspace_still_works_under_confinement() {
    // Confinar nao pode significar impedir o trabalho: a raiz e escrevivel.
    let (dir, ctx) = workspace();
    let confinement = sandbox::detect_from_path();
    if !confinement.is_enforced() {
        return;
    }

    let out = Bash::default()
        .execute(script(&dir, "echo dentro > criado.txt"), &ctx)
        .await;

    assert!(!out.is_error, "{}", out.content);
    assert!(dir.path().join("criado.txt").exists());
}

#[test]
fn the_schema_requires_argv() {
    assert_eq!(Bash::default().input_schema()["required"][0], "argv");
    assert_eq!(Bash::default().name(), "bash");
    assert!(Bash::default().description().contains("argv"));
}

#[test]
fn an_empty_argument_after_the_program_is_preserved() {
    let parsed = argv_from(&json!({ "argv": ["printf", "", "x"] })).unwrap();

    assert_eq!(parsed, vec!["printf", "", "x"]);
}

#[test]
fn every_supported_script_interpreter_flag_is_rejected() {
    for (program, flag) in [
        ("bash", "-c"),
        ("sh", "-lc"),
        ("node", "--eval"),
        ("perl", "-e"),
        ("ruby", "-e"),
        ("lua", "-e"),
        ("php", "-r"),
    ] {
        assert!(
            interpreter_accepts_script(program, flag),
            "{program} {flag}"
        );
    }
}

#[test]
fn script_interpreter_flags_do_not_reject_other_arguments() {
    for (program, argument) in [
        ("bash", "--version"),
        ("node", "--version"),
        ("perl", "--version"),
        ("ruby", "--version"),
        ("lua", "--version"),
        ("php", "--version"),
    ] {
        assert!(
            !interpreter_accepts_script(program, argument),
            "{program} {argument}"
        );
    }
}

#[test]
fn env_split_string_forms_are_rejected() {
    assert!(interprets_script(&[
        "env".to_owned(),
        "--split-string".to_owned(),
        "bash -c".to_owned(),
    ]));
    assert!(interprets_script(&[
        "env".to_owned(),
        "--split-string=bash -c".to_owned(),
    ]));
}

#[tokio::test]
async fn a_command_string_is_rejected_and_metacharacters_are_data() {
    let (_dir, ctx) = workspace();
    let refused = bare()
        .execute(json!({ "command": "echo spawned" }), &ctx)
        .await;
    assert!(refused.is_error);
    assert!(refused.content.contains("command"), "{}", refused.content);
    assert!(!refused.content.contains("spawned"), "{}", refused.content);

    let out = bare().execute(call(&["echo", "$(whoami)"]), &ctx).await;
    assert!(!out.is_error, "{}", out.content);
    assert!(out.content.contains("$(whoami)"), "{}", out.content);
}

#[tokio::test]
async fn an_interpreter_dash_c_is_refused() {
    let (_dir, ctx) = workspace();
    let out = bare()
        .execute(json!({ "argv": ["bash", "-c", "echo spawned"] }), &ctx)
        .await;
    assert!(out.is_error);
    assert!(out.content.contains("-c"), "{}", out.content);
    assert!(!out.content.contains("spawned"), "{}", out.content);

    let out = bare()
        .execute(
            json!({ "argv": ["env", "bash", "-c", "echo spawned"] }),
            &ctx,
        )
        .await;
    assert!(out.is_error, "{}", out.content);
    assert!(out.content.contains("-c"), "{}", out.content);
    assert!(!out.content.contains("spawned"), "{}", out.content);

    let out = bare()
        .execute(
            json!({ "argv": ["node", "-e", "console.log('spawned')"] }),
            &ctx,
        )
        .await;
    assert!(out.is_error, "{}", out.content);
    assert!(!out.content.contains("spawned"), "{}", out.content);

    let out = bare()
        .execute(
            json!({ "argv": ["env", "-S", "sh -c", "echo spawned"] }),
            &ctx,
        )
        .await;
    assert!(out.is_error, "{}", out.content);
    assert!(!out.content.contains("spawned"), "{}", out.content);
}
