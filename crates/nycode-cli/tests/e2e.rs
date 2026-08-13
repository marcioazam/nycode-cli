//! Prova vertical da Wave 0.
//!
//! Executa o binário `nycode` de verdade contra um gateway simulado que fala
//! SSE, e afirma sobre o que sai em stdout e sobre o código de saída. Os testes
//! de unidade cobrem cada peça; este cobre o fato de que elas estão ligadas.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::process::Command;

use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

/// Monta um corpo SSE no formato que o gateway emite.
fn sse_body(events: &[&str]) -> String {
    use std::fmt::Write as _;
    events.iter().fold(String::new(), |mut body, event| {
        let _ = write!(body, "event: message\ndata: {event}\n\n");
        body
    })
}

fn text_turn(text: &str) -> String {
    sse_body(&[
        r#"{"type":"message_start","message":{"id":"msg_1","usage":{"input_tokens":11}}}"#,
        &format!(
            r#"{{"type":"content_block_delta","index":0,"delta":{{"type":"text_delta","text":"{text}"}}}}"#
        ),
        r#"{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":3}}"#,
        r#"{"type":"message_stop"}"#,
    ])
}

fn run_nycode(base_url: &str, extra: &[&str]) -> std::process::Output {
    // Sem `--cwd` o binario grava `.nycode/` no diretorio corrente, e o
    // corrente de um teste de integracao e a raiz do pacote: sem este
    // redirecionamento a suite suja o proprio repositorio a cada execucao. O
    // temporario cai no fim da funcao, depois de o processo ter saido.
    let neutral = tempfile::tempdir().expect("diretorio temporario");
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_nycode"));
    cmd.current_dir(neutral.path())
        .arg("--base-url")
        .arg(base_url)
        .arg("--api-key")
        .arg("chave-de-teste")
        .args(extra)
        .env_remove("NYCODE_BASE_URL")
        .env_remove("NYCODE_API_KEY")
        .env_remove("NYCODE_MODEL");
    cmd.output().expect("o binario nycode deveria executar")
}

/// Responde `GET /v1/models`, como um gateway de verdade responde.
///
/// Sem isto o binário avisa a cada execução que o catálogo está indisponível, e
/// os testes passariam a exercitar o caminho degradado em vez do normal.
async fn with_catalog(server: &MockServer) {
    Mock::given(method("GET"))
        .and(path("/v1/models"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "data": [{ "id": "nylla-sonnet-4.5", "context_window": 200_000 }]
        })))
        .mount(server)
        .await;
}

/// Quantas vezes o gateway recebeu um turno, ignorando consultas de catálogo.
async fn turns_received(server: &MockServer) -> Vec<Vec<u8>> {
    server
        .received_requests()
        .await
        .unwrap_or_default()
        .into_iter()
        .filter(|request| request.url.path().ends_with("/messages"))
        .map(|request| request.body)
        .collect()
}

async fn gateway(body: String, status: u16) -> MockServer {
    let server = MockServer::start().await;
    with_catalog(&server).await;
    Mock::given(method("POST"))
        .and(path("/v1/messages"))
        .and(header("x-api-key", "chave-de-teste"))
        .respond_with(
            ResponseTemplate::new(status)
                .set_body_raw(body, "text/event-stream")
                .insert_header("cache-control", "no-cache"),
        )
        .mount(&server)
        .await;
    server
}

#[tokio::test(flavor = "multi_thread")]
async fn answers_a_prompt_end_to_end_over_real_http() {
    let server = gateway(text_turn("resposta do gateway"), 200).await;
    let base = format!("{}/v1", server.uri());

    let out = run_nycode(&base, &["-p", "diga algo"]);

    assert!(
        out.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert_eq!(
        String::from_utf8_lossy(&out.stdout).trim(),
        "resposta do gateway"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn stdout_carries_only_the_answer_so_it_can_be_piped() {
    // O progresso de ferramenta vai para stderr. Se vazar para stdout,
    // `nycode -p ... | jq` quebra.
    let server = gateway(text_turn("apenas isto"), 200).await;
    let base = format!("{}/v1", server.uri());

    let out = run_nycode(&base, &["-p", "oi"]);
    assert_eq!(String::from_utf8_lossy(&out.stdout), "apenas isto\n");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_refusal_exits_nonzero() {
    let body = sse_body(&[
        r#"{"type":"message_start","message":{"id":"m"}}"#,
        r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"nao posso"}}"#,
        r#"{"type":"message_delta","delta":{"stop_reason":"refusal"}}"#,
        r#"{"type":"message_stop"}"#,
    ]);
    let server = gateway(body, 200).await;
    let base = format!("{}/v1", server.uri());

    let out = run_nycode(&base, &["-p", "algo bloqueado"]);
    assert_eq!(
        out.status.code(),
        Some(3),
        "recusa precisa ser detectavel pelo codigo de saida"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_truncated_stream_fails_instead_of_printing_partial_text_as_the_answer() {
    // Sem `message_stop`. Este e o modo de falha que o NFR-4 existe para barrar.
    let body = sse_body(&[
        r#"{"type":"message_start","message":{"id":"m"}}"#,
        r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"parcial"}}"#,
    ]);
    let server = gateway(body, 200).await;
    let base = format!("{}/v1", server.uri());

    let out = run_nycode(&base, &["-p", "oi"]);
    assert!(
        !out.status.success(),
        "stream cortado nao pode sair com zero"
    );
    assert!(String::from_utf8_lossy(&out.stderr).contains("sem evento de encerramento"));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_gateway_error_body_reaches_the_user_verbatim() {
    let body = r#"{"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long: 250000 tokens"}}"#;
    let server = gateway(body.to_owned(), 400).await;
    let base = format!("{}/v1", server.uri());

    let out = run_nycode(&base, &["-p", "oi"]);
    assert!(!out.status.success());
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("prompt is too long"),
        "mensagem do gateway perdida: {stderr}"
    );
}

/// Turno em que o modelo pede uma ferramenta.
fn write_tool_turn(path: &str, content: &str) -> String {
    sse_body(&[
        r#"{"type":"message_start","message":{"id":"m"}}"#,
        r#"{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"t1","name":"write"}}"#,
        &format!(
            r#"{{"type":"content_block_delta","index":0,"delta":{{"type":"input_json_delta","partial_json":"{{\"path\":\"{path}\",\"content\":\"{content}\"}}"}}}}"#
        ),
        r#"{"type":"content_block_stop","index":0}"#,
        r#"{"type":"message_delta","delta":{"stop_reason":"tool_use"}}"#,
        r#"{"type":"message_stop"}"#,
    ])
}

/// Gateway que responde cada requisição com o próximo corpo da fila.
async fn gateway_sequence(bodies: &[String]) -> MockServer {
    let server = MockServer::start().await;
    with_catalog(&server).await;
    for body in bodies {
        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_raw(body.clone(), "text/event-stream")
                    .insert_header("cache-control", "no-cache"),
            )
            .up_to_n_times(1)
            .mount(&server)
            .await;
    }
    server
}

#[tokio::test(flavor = "multi_thread")]
async fn the_agent_works_in_the_directory_it_was_pointed_at() {
    // Sem `--cwd` o agente opera no diretorio corrente, que num script quase
    // nunca e o repositorio alvo.
    let dir = tempfile::tempdir().unwrap();
    let server = gateway_sequence(&[
        write_tool_turn("criado.txt", "conteudo"),
        text_turn("pronto"),
    ])
    .await;
    let base = format!("{}/v1", server.uri());

    let out = run_nycode(
        &base,
        &[
            "-p",
            "crie um arquivo",
            "--allow-writes",
            "--cwd",
            dir.path().to_str().unwrap(),
        ],
    );

    assert!(
        out.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let criado = dir.path().join("criado.txt");
    assert!(
        criado.is_file(),
        "a ferramenta precisa ter escrito em --cwd"
    );
    assert_eq!(std::fs::read_to_string(criado).unwrap(), "conteudo");
}

#[tokio::test(flavor = "multi_thread")]
async fn without_allow_writes_the_file_is_never_created() {
    // O gate somente-leitura e a diferenca entre um agente headless seguro e um
    // que modifica o repositorio sem ninguem ter autorizado.
    let dir = tempfile::tempdir().unwrap();
    let server = gateway_sequence(&[
        write_tool_turn("proibido.txt", "conteudo"),
        text_turn("nao consegui"),
    ])
    .await;
    let base = format!("{}/v1", server.uri());

    let out = run_nycode(
        &base,
        &[
            "-p",
            "crie um arquivo",
            "--cwd",
            dir.path().to_str().unwrap(),
        ],
    );

    assert!(out.status.success());
    assert!(
        !dir.path().join("proibido.txt").exists(),
        "o gate padrao precisa impedir a escrita"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn continue_replays_the_previous_session_to_the_gateway() {
    // O historico precisa voltar ao backend: sem isso `--continue` retoma um id
    // mas comeca a conversa do zero, que e pior que falhar.
    let dir = tempfile::tempdir().unwrap();
    let cwd = dir.path().to_str().unwrap();
    let server = gateway_sequence(&[text_turn("primeira"), text_turn("segunda")]).await;
    let base = format!("{}/v1", server.uri());

    let first = run_nycode(&base, &["-p", "quem sou eu", "--cwd", cwd]);
    assert!(
        first.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&first.stderr)
    );

    let second = run_nycode(&base, &["-p", "e agora", "--cwd", cwd, "--continue"]);
    assert!(
        second.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&second.stderr)
    );
    assert_eq!(
        String::from_utf8_lossy(&second.stdout).trim(),
        "segunda",
        "a segunda execucao precisa ter falado com o gateway"
    );

    let turns = turns_received(&server).await;
    assert_eq!(turns.len(), 2, "um turno por execucao");
    let replayed = String::from_utf8_lossy(&turns[1]).to_string();
    assert!(
        replayed.contains("quem sou eu") && replayed.contains("primeira"),
        "o historico da primeira sessao precisa voltar ao backend: {replayed}"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_session_is_persisted_only_after_the_turn_succeeds() {
    // Gravar antes registraria uma conversa que nunca aconteceu.
    let dir = tempfile::tempdir().unwrap();
    let cwd = dir.path().to_str().unwrap();
    let server = gateway(String::new(), 500).await;
    let base = format!("{}/v1", server.uri());

    let out = run_nycode(&base, &["-p", "vai falhar", "--cwd", cwd]);
    assert!(!out.status.success());

    let sessions = dir.path().join(".nycode/sessions");
    let gravadas = std::fs::read_dir(&sessions).map_or(0, std::iter::Iterator::count);
    assert_eq!(gravadas, 0, "um turno que falhou nao pode virar sessao");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_model_the_endpoint_does_not_serve_is_refused_with_the_list_of_those_it_does() {
    // FR-6: o catalogo vem do endpoint. Um modelo digitado errado precisa
    // falhar aqui, com a lista do que existe, e nao virar uma recusa do
    // gateway tres camadas adiante.
    let dir = tempfile::tempdir().unwrap();
    let server = gateway(text_turn("nao deveria chegar"), 200).await;
    let base = format!("{}/v1", server.uri());

    let out = run_nycode(
        &base,
        &[
            "-p",
            "oi",
            "--cwd",
            dir.path().to_str().unwrap(),
            "--model",
            "nylla-sonet-4.5",
        ],
    );

    assert!(!out.status.success());
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stderr.contains("nylla-sonet-4.5"), "{stderr}");
    assert!(
        stderr.contains("nylla-sonnet-4.5"),
        "precisa listar o que o endpoint serve: {stderr}"
    );
    assert!(
        turns_received(&server).await.is_empty(),
        "nao pode gastar um turno com modelo invalido"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn the_catalog_is_cached_so_the_second_run_does_not_ask_again() {
    // Consultar o catalogo a cada execucao poria uma ida a rede no caminho de
    // startup, que o NFR-1 mede.
    let dir = tempfile::tempdir().unwrap();
    let cwd = dir.path().to_str().unwrap();
    let server = gateway_sequence(&[text_turn("uma"), text_turn("duas")]).await;
    let base = format!("{}/v1", server.uri());

    run_nycode(&base, &["-p", "primeira", "--cwd", cwd]);
    run_nycode(&base, &["-p", "segunda", "--cwd", cwd]);

    let catalog_requests = server
        .received_requests()
        .await
        .unwrap()
        .into_iter()
        .filter(|request| request.url.path().ends_with("/models"))
        .count();
    assert_eq!(catalog_requests, 1, "a segunda execucao le do cache");
    assert!(dir.path().join(".nycode/catalog.json").exists());
}

#[tokio::test(flavor = "multi_thread")]
async fn the_json_mode_publishes_the_tool_sequence_and_the_usage() {
    // FR-12: quem integra o binario precisa saber quais ferramentas rodaram e
    // quanto custou, sem inferir isso de texto formatado para humano.
    let dir = tempfile::tempdir().unwrap();
    let server = gateway_sequence(&[
        write_tool_turn("criado.txt", "conteudo"),
        text_turn("pronto"),
    ])
    .await;
    let base = format!("{}/v1", server.uri());

    let out = run_nycode(
        &base,
        &[
            "-p",
            "crie o arquivo",
            "--cwd",
            dir.path().to_str().unwrap(),
            "--allow-writes",
            "--output-format",
            "json",
        ],
    );
    assert!(
        out.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );

    let stdout = String::from_utf8_lossy(&out.stdout);
    let events: Vec<serde_json::Value> = stdout
        .lines()
        .map(|line| serde_json::from_str(line).expect("cada linha e um evento JSON"))
        .collect();

    let kinds: Vec<&str> = events
        .iter()
        .filter_map(|e| e.get("type").and_then(serde_json::Value::as_str))
        .collect();
    assert!(kinds.contains(&"tool_start"), "{kinds:?}");
    assert!(kinds.contains(&"tool_end"), "{kinds:?}");
    assert_eq!(
        kinds.last(),
        Some(&"result"),
        "o ultimo evento fecha o turno"
    );

    let last = events.last().unwrap();
    assert_eq!(last["stop_reason"], "end_turn");
    assert!(
        last["usage"]["input_tokens"].as_u64().unwrap() > 0,
        "a contabilidade precisa chegar: {last}"
    );
    assert_eq!(last["tool_rounds"], 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_failed_turn_in_json_mode_ends_with_an_error_event() {
    // Terminar com `result` faria um consumidor tratar a falha como turno
    // concluido.
    let dir = tempfile::tempdir().unwrap();
    let body = r#"{"type":"error","error":{"type":"invalid_request_error","message":"modelo indisponivel"}}"#;
    let server = gateway(body.to_owned(), 400).await;
    let base = format!("{}/v1", server.uri());

    let out = run_nycode(
        &base,
        &[
            "-p",
            "vai falhar",
            "--cwd",
            dir.path().to_str().unwrap(),
            "--output-format",
            "json",
        ],
    );

    assert!(!out.status.success());
    let stdout = String::from_utf8_lossy(&out.stdout);
    let last: serde_json::Value =
        serde_json::from_str(stdout.lines().next_back().expect("ao menos um evento")).unwrap();
    assert_eq!(last["type"], "error");
}

#[test]
fn version_runs_without_a_gateway_and_without_a_runtime() {
    // NFR-1 mede este caminho. Ele nao pode tocar rede nem construir o runtime.
    let out = Command::new(env!("CARGO_BIN_EXE_nycode"))
        .arg("--version")
        .output()
        .unwrap();
    assert!(out.status.success());
    assert!(String::from_utf8_lossy(&out.stdout).contains("nycode"));
}

#[test]
fn an_interactive_session_without_a_terminal_is_refused_instead_of_hanging() {
    // `echo x | nycode` abriria um prompt que ninguem pode responder. O codigo
    // 2 e o mesmo que sempre significou "esta superficie nao serve aqui".
    let out = Command::new(env!("CARGO_BIN_EXE_nycode")).output().unwrap();
    assert_eq!(out.status.code(), Some(2));

    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stderr.contains("terminal"), "{stderr}");
    assert!(
        stderr.contains("-p"),
        "a mensagem precisa dizer qual e a saida: {stderr}"
    );
}
