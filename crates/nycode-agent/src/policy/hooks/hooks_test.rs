//! Contrato dos hooks (FR-16, ADR-0009).

#![allow(clippy::unwrap_used, clippy::panic)]

use super::{Event, Hooks, Payload};

/// Escreve um hook executável e devolve a raiz do workspace.
fn hook(dir: &str, event: Event, body: &str) -> tempfile::TempDir {
    let root = tempfile::tempdir().unwrap();
    write_hook(root.path(), dir, event, body);
    root
}

fn write_hook(root: &std::path::Path, dir: &str, event: Event, body: &str) {
    let path = root.join(dir).join(event.filename());
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
}

fn payload(tool: &str) -> Payload {
    Payload {
        event: Event::PreToolUse,
        tool: Some(tool.to_owned()),
        input: Some(serde_json::json!({ "command": "git push" })),
        output: None,
        cwd: "/w".to_owned(),
    }
}

#[tokio::test]
async fn a_pre_tool_hook_can_veto_a_call() {
    // E o que permite escrever politica como codigo sem recompilar o binario.
    let root = hook(
        ".nycode/hooks",
        Event::PreToolUse,
        r#"echo '{"decision":"deny","reason":"nada de push desta maquina"}'"#,
    );

    let hooks = Hooks::discover(root.path());
    assert!(!hooks.is_empty(), "o script precisa ter sido descoberto");
    let response = hooks
        .fire(Event::PreToolUse, &payload("bash"))
        .await
        .expect("o hook respondeu");

    assert!(response.is_denial());
    assert_eq!(
        response.reason.as_deref(),
        Some("nada de push desta maquina")
    );
}

#[tokio::test]
async fn a_hook_does_not_inherit_the_harness_environment() {
    // Um hook vem do repositorio, roda a cada chamada de ferramenta e alcanca a
    // rede. Herdar o ambiente do harness faria de qualquer repositorio clonado
    // um canal de saida para a chave do gateway.
    //
    // O hook devolve o que enxerga como se fosse a razao da recusa, que e o
    // caminho mais curto para trazer a observacao de volta ao teste.
    let root = hook(
        ".nycode/hooks",
        Event::PreToolUse,
        r#"printf '{"decision":"deny","reason":"%s"}' "$(printenv CARGO_PKG_NAME)""#,
    );

    let response = Hooks::discover(root.path())
        .fire(Event::PreToolUse, &payload("bash"))
        .await
        .expect("o hook respondeu");

    // O cargo define CARGO_PKG_NAME no processo de teste; o hook nao pode ve-la.
    assert_eq!(
        response.reason.as_deref(),
        Some(""),
        "o hook enxergou o ambiente do harness"
    );
}

#[tokio::test]
async fn a_hook_still_finds_its_own_interpreter() {
    // Limpar o ambiente nao pode significar impedir o hook de rodar: sem `PATH`,
    // um `#!/usr/bin/env sh` nao acha o proprio interpretador.
    let root = hook(
        ".nycode/hooks",
        Event::PreToolUse,
        r#"echo '{"decision":"deny","reason":"rodei"}'"#,
    );

    let response = Hooks::discover(root.path())
        .fire(Event::PreToolUse, &payload("bash"))
        .await
        .expect("o hook respondeu");

    assert_eq!(response.reason.as_deref(), Some("rodei"));
}

#[tokio::test]
async fn a_hook_that_says_nothing_lets_the_call_through() {
    // Silencio e o caso comum: a maioria dos hooks so observa.
    let root = hook(".nycode/hooks", Event::PreToolUse, "exit 0");
    let hooks = Hooks::discover(root.path());

    assert!(hooks
        .fire(Event::PreToolUse, &payload("read"))
        .await
        .is_none());
}

#[tokio::test]
async fn a_response_that_is_not_a_denial_lets_the_call_through() {
    let root = hook(
        ".nycode/hooks",
        Event::PreToolUse,
        r#"echo '{"decision":"allow"}'"#,
    );
    let hooks = Hooks::discover(root.path());

    let response = hooks
        .fire(Event::PreToolUse, &payload("read"))
        .await
        .unwrap();
    assert!(!response.is_denial());
}

#[tokio::test]
async fn the_hook_receives_the_tool_and_the_arguments() {
    // Sem isso o hook nao tem como decidir: `bash` sozinho nao diz nada.
    let root = hook(
        ".nycode/hooks",
        Event::PreToolUse,
        r#"if grep -q 'git push' /dev/stdin; then echo '{"decision":"deny","reason":"pegou"}'; fi"#,
    );
    let hooks = Hooks::discover(root.path());

    let response = hooks
        .fire(Event::PreToolUse, &payload("bash"))
        .await
        .expect("o hook leu o payload");
    assert!(response.is_denial());
}

#[tokio::test]
async fn a_hook_that_crashes_does_not_block_the_session() {
    // Falha aberto e a decisao do ADR-0009: um script quebrado nao pode
    // transformar o agente em inutilizavel.
    let root = hook(".nycode/hooks", Event::PreToolUse, "exit 1");
    let hooks = Hooks::discover(root.path());

    assert!(hooks
        .fire(Event::PreToolUse, &payload("bash"))
        .await
        .is_none());
}

#[tokio::test]
async fn a_hook_that_answers_garbage_is_ignored_rather_than_obeyed() {
    let root = hook(".nycode/hooks", Event::PreToolUse, "echo 'isto nao e json'");
    let hooks = Hooks::discover(root.path());

    assert!(hooks
        .fire(Event::PreToolUse, &payload("bash"))
        .await
        .is_none());
}

#[tokio::test]
async fn a_hook_that_reads_stdin_forever_still_terminates() {
    // Sem fechar o stdin, um `cat` penduraria toda chamada de ferramenta.
    let root = hook(".nycode/hooks", Event::PreToolUse, "cat > /dev/null");
    let hooks = Hooks::discover(root.path());

    let started = std::time::Instant::now();
    assert!(hooks
        .fire(Event::PreToolUse, &payload("bash"))
        .await
        .is_none());
    assert!(
        started.elapsed() < super::TIMEOUT,
        "nao pode ter esperado o teto"
    );
}

#[tokio::test]
async fn a_hook_that_hangs_is_cut_off_by_the_timeout() {
    // Um hook roda a cada chamada; um que trava travaria o turno inteiro.
    let root = hook(".nycode/hooks", Event::PreToolUse, "sleep 60");
    // O teto encurtado é o que evita gastar cinco segundos em toda execução da
    // suíte só para provar que o corte acontece.
    let hooks = Hooks::discover(root.path()).with_timeout(std::time::Duration::from_millis(50));

    let started = std::time::Instant::now();
    assert!(hooks
        .fire(Event::PreToolUse, &payload("bash"))
        .await
        .is_none());
    assert!(
        started.elapsed() < std::time::Duration::from_secs(2),
        "o corte precisa acontecer antes de o hook terminar"
    );
}

#[tokio::test]
async fn a_hook_cut_off_by_the_timeout_is_killed_and_not_left_behind() {
    // Estourar o prazo larga o future, e largar o future nao mata processo
    // nenhum: o hook segue escrevendo no workspace que o modelo esta
    // inspecionando. Como um hook dispara a cada chamada de ferramenta, o que
    // fica para tras se acumula ao longo da sessao.
    let root = hook(
        ".nycode/hooks",
        Event::PreToolUse,
        "while true; do echo . >> sentinela.txt; sleep 0.02; done",
    );
    let hooks = Hooks::discover(root.path()).with_timeout(std::time::Duration::from_millis(300));
    let sentinela = root.path().join("sentinela.txt");
    let size = || std::fs::metadata(&sentinela).map_or(0, |m| m.len());

    assert!(hooks
        .fire(Event::PreToolUse, &payload("bash"))
        .await
        .is_none());

    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    let logo_depois = size();
    assert!(
        logo_depois > 0,
        "o hook precisa ter escrito algo, senao o teste passa a toa"
    );
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;

    assert_eq!(
        logo_depois,
        size(),
        "o hook continuou escrevendo depois de o prazo o ter cortado"
    );
}

#[tokio::test]
async fn a_hook_that_floods_stdout_is_not_buffered_whole() {
    // O teto de tempo nao limita memoria: em cinco segundos um hook escreve
    // muito mais do que cabe no orcamento de RSS, e isso a cada chamada de
    // ferramenta.
    let root = tempfile::tempdir().unwrap();
    write_hook(
        root.path(),
        ".nycode/hooks",
        Event::PreToolUse,
        "yes x | head -c 1000000",
    );
    let program = root
        .path()
        .join(".nycode/hooks")
        .join(Event::PreToolUse.filename());

    let out = super::spawn(&program, root.path(), String::new())
        .await
        .expect("o hook rodou");

    assert!(
        out.len() <= super::MAX_OUTPUT,
        "{} bytes guardados, o teto e {}",
        out.len(),
        super::MAX_OUTPUT
    );
}

#[tokio::test]
async fn a_file_without_the_execute_bit_is_a_draft_and_not_a_hook() {
    // Executa-lo produziria um erro a cada chamada de ferramenta.
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join(".nycode/hooks/pre-tool-use");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, "#!/bin/sh\necho '{\"decision\":\"deny\"}'").unwrap();

    let hooks = Hooks::discover(root.path());
    assert!(hooks.is_empty());
}

#[tokio::test]
async fn a_workspace_without_hooks_declares_none() {
    let root = tempfile::tempdir().unwrap();
    let hooks = Hooks::discover(root.path());

    assert!(hooks.is_empty());
    assert!(hooks.declared().is_empty());
    assert!(hooks
        .fire(Event::SessionStart, &payload("x"))
        .await
        .is_none());
}

#[tokio::test]
async fn the_project_scope_overrides_the_broader_one() {
    let root = tempfile::tempdir().unwrap();
    write_hook(
        root.path(),
        ".claude/hooks",
        Event::PreToolUse,
        r#"echo '{"decision":"deny","reason":"antigo"}'"#,
    );
    write_hook(
        root.path(),
        ".nycode/hooks",
        Event::PreToolUse,
        r#"echo '{"decision":"deny","reason":"do projeto"}'"#,
    );

    let response = Hooks::discover(root.path())
        .fire(Event::PreToolUse, &payload("bash"))
        .await
        .unwrap();
    assert_eq!(response.reason.as_deref(), Some("do projeto"));
}

#[tokio::test]
async fn each_event_has_its_own_file() {
    let root = tempfile::tempdir().unwrap();
    write_hook(root.path(), ".nycode/hooks", Event::SessionStart, "exit 0");
    write_hook(root.path(), ".nycode/hooks", Event::SessionEnd, "exit 0");

    let hooks = Hooks::discover(root.path());
    assert_eq!(hooks.declared(), vec!["session-end", "session-start"]);
    assert!(hooks.fire(Event::PreToolUse, &payload("x")).await.is_none());
}

#[tokio::test]
async fn a_hook_still_being_written_is_retried_instead_of_skipped() {
    // `execve` devolve `ETXTBSY` enquanto alguem tem o executavel aberto para
    // escrita. Desistir na primeira tentativa pularia em silencio um hook que
    // existe e esta instalado.
    let root = hook(
        ".nycode/hooks",
        Event::PreToolUse,
        r#"echo '{"decision":"deny","reason":"consegui rodar"}'"#,
    );
    let path = root.path().join(".nycode/hooks/pre-tool-use");

    // Segurar o arquivo aberto para escrita e o que provoca `ETXTBSY`.
    let held = std::fs::OpenOptions::new().write(true).open(&path).unwrap();
    let releaser = std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(20));
        drop(held);
    });

    let response = Hooks::discover(root.path())
        .fire(Event::PreToolUse, &payload("bash"))
        .await;
    releaser.join().unwrap();

    assert_eq!(
        response.and_then(|r| r.reason).as_deref(),
        Some("consegui rodar"),
        "a segunda tentativa precisa pegar o arquivo ja liberado"
    );
}

#[tokio::test]
async fn a_hook_locked_for_writing_the_whole_time_gives_up_without_blocking() {
    // Tentar para sempre penduraria toda chamada de ferramenta.
    let root = hook(".nycode/hooks", Event::PreToolUse, "echo '{}'");
    let path = root.path().join(".nycode/hooks/pre-tool-use");
    let _held = std::fs::OpenOptions::new().write(true).open(&path).unwrap();

    let started = std::time::Instant::now();
    let response = Hooks::discover(root.path())
        .fire(Event::PreToolUse, &payload("bash"))
        .await;

    assert!(response.is_none());
    assert!(
        started.elapsed() < std::time::Duration::from_secs(2),
        "a desistencia precisa ser rapida"
    );
}

#[test]
fn the_event_names_are_the_ones_the_documentation_promises() {
    // Renomear um arquivo aqui faria hooks existentes pararem de disparar em
    // silencio.
    assert_eq!(Event::SessionStart.filename(), "session-start");
    assert_eq!(Event::PreToolUse.filename(), "pre-tool-use");
    assert_eq!(Event::PostToolUse.filename(), "post-tool-use");
    assert_eq!(Event::SessionEnd.filename(), "session-end");
}

#[test]
fn the_payload_serializes_without_the_fields_that_do_not_apply() {
    // `post-tool-use` tem saida e `session-start` nao tem ferramenta; mandar
    // `null` obrigaria todo hook a tratar o caso.
    let payload = Payload {
        event: Event::SessionStart,
        tool: None,
        input: None,
        output: None,
        cwd: "/w".to_owned(),
    };
    let rendered = serde_json::to_value(&payload).unwrap();

    assert_eq!(rendered["event"], "session-start");
    assert!(rendered.get("tool").is_none());
    assert!(rendered.get("input").is_none());
}
