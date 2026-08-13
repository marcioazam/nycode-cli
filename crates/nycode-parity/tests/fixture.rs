//! Prova de que o gateway de fixture atende de verdade.
//!
//! A decisão do que responder é pura e testada em `fixture.rs`. O que só esta
//! bateria alcança é a casca: escolher a porta, anunciá-la, ler o pedido do
//! socket e devolver bytes que um cliente HTTP aceita. Sem ela, o instrumento
//! que destravou o gate de paridade não teria instrumento próprio.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

/// Fixture vivo, desligado ao sair de escopo.
///
/// O desligamento fecha a entrada padrão em vez de sinalizar. A razão não é
/// elegância: um processo morto por sinal nunca grava o arquivo de perfil, e a
/// casca de E/S do fixture aparecia no relatório com zero por cento de
/// cobertura — não por não estar testada, mas por ter sido morta antes de
/// contar que estava. Em `Drop`, e não numa chamada ao fim de cada teste,
/// porque uma asserção que falha nunca chegaria a essa chamada e o perfil se
/// perderia exatamente no caso que mais interessa.
struct Fixture {
    child: Child,
    address: String,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        // Fechar o cano é o desligamento: o fixture vê o fim da entrada padrão
        // e sai sozinho, gravando o perfil no caminho de saída normal.
        drop(self.child.stdin.take());

        // Espera limitada, e não `wait()` cru: um fixture que travasse penduraria
        // a bateria para sempre. Passado o teto, o sinal volta — perde-se o
        // perfil daquela execução, não a suíte.
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            match self.child.try_wait() {
                Ok(Some(_)) => return,
                Ok(None) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(10));
                }
                _ => break,
            }
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Sobe o fixture e devolve-o já com o endereço que ele anunciou.
fn start() -> Fixture {
    let mut child = Command::new(env!("CARGO_BIN_EXE_nycode-parity-fixture"))
        // Pedido de propósito: o desligamento por entrada padrão é o que grava
        // o perfil de cobertura, e é opcional justamente porque quem sobe o
        // fixture em segundo plano não segura a entrada padrão.
        .arg("--shutdown-on-stdin")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("o fixture deveria subir");

    let stdout = child.stdout.take().expect("stdout foi pedido em pipe");
    let mut linha = String::new();
    BufReader::new(stdout)
        .read_line(&mut linha)
        .expect("o fixture anuncia a porta na primeira linha");

    // `http://127.0.0.1:PORTA/v1` -> `127.0.0.1:PORTA`
    let address = linha
        .trim()
        .trim_start_matches("http://")
        .trim_end_matches("/v1")
        .to_owned();
    Fixture { child, address }
}

/// Faz um pedido HTTP cru e devolve a resposta inteira.
///
/// Sem cliente HTTP: o crate não tem um, e acrescentar dependência para testar
/// um fixture de teste seria pagar binário por conveniência.
fn request(address: &str, head: &str, body: &str) -> String {
    let mut stream = TcpStream::connect(address).expect("o fixture deveria aceitar conexao");
    let raw = format!(
        "{head} HTTP/1.1\r\nHost: fixture\r\nContent-Length: {}\r\n\r\n{body}",
        body.len()
    );
    stream.write_all(raw.as_bytes()).unwrap();
    stream.flush().unwrap();

    let mut response = String::new();
    stream.read_to_string(&mut response).unwrap();
    response
}

#[test]
fn the_fixture_announces_a_port_and_serves_the_catalog() {
    // Quem sobe o fixture le a primeira linha para descobrir a porta; sem o
    // anuncio, o gate teria de fixar uma porta e colidir com quem a ocupasse.
    let fixture = start();

    let response = request(&fixture.address, "GET /v1/models", "");

    assert!(response.starts_with("HTTP/1.1 200 OK"), "{response}");
    assert!(response.contains("nylla-sonnet-4.5"), "{response}");
}

#[test]
fn a_turn_that_should_write_asks_for_the_write_tool() {
    let fixture = start();

    let response = request(
        &fixture.address,
        "POST /v1/messages",
        r#"{"messages":[{"role":"user","content":"crie saida.txt"}]}"#,
    );

    assert!(response.contains("text/event-stream"), "{response}");
    assert!(response.contains(r#""name":"write""#), "{response}");
    assert!(
        response.contains(r#""stop_reason":"tool_use""#),
        "{response}"
    );
}

#[test]
fn a_turn_carrying_a_tool_result_closes_instead_of_asking_again() {
    // Sem esta regra o script pediria a mesma ferramenta para sempre e o turno
    // so pararia no teto de rodadas do agente.
    let fixture = start();

    let response = request(
        &fixture.address,
        "POST /v1/messages",
        r#"{"messages":[{"role":"user","content":[{"type":"tool_result","content":"ok"}]}]}"#,
    );

    assert!(
        response.contains(r#""stop_reason":"end_turn""#),
        "{response}"
    );
}

#[test]
fn a_route_the_fixture_does_not_serve_is_refused_rather_than_answered() {
    // Um gateway que responde alguma coisa a tudo esconderia um caminho pedido
    // por engano — e o dialeto errado apareceria como resposta vazia.
    let fixture = start();

    let response = request(&fixture.address, "GET /v1/responses", "");

    assert!(response.starts_with("HTTP/1.1 404"), "{response}");
}

#[test]
fn a_request_whose_head_makes_no_sense_is_dropped_without_an_answer() {
    // Responder alguma coisa a um cabecalho que nao se entende esconderia um
    // cliente quebrado atras de uma resposta plausivel — e o gate compara
    // respostas, entao o engano viraria paridade.
    let fixture = start();

    // Uma linha de requisicao tem metodo e caminho. Com uma palavra so nao ha
    // o que rotear, e e ai que o fixture larga a conexao em vez de responder.
    let mut stream = TcpStream::connect(&fixture.address).unwrap();
    stream.write_all(b"SOZINHO\r\n\r\n").unwrap();
    stream.flush().unwrap();

    let mut response = String::new();
    stream.read_to_string(&mut response).unwrap();
    assert!(response.is_empty(), "{response}");
}

#[test]
fn a_body_that_arrives_in_two_pieces_is_assembled_before_being_answered() {
    // O corpo de um turno com prompt de sistema e schemas de ferramenta nao
    // cabe num pacote. Responder ao primeiro pedaco decidiria a rota com meio
    // JSON, e o fixture responderia a coisa errada com cara de certa.
    let fixture = start();

    let body = r#"{"messages":[{"role":"user","content":"crie saida.txt"}]}"#;
    let (head, tail) = body.split_at(20);

    let mut stream = TcpStream::connect(&fixture.address).unwrap();
    stream
        .write_all(
            format!(
                "POST /v1/messages HTTP/1.1\r\nHost: fixture\r\nContent-Length: {}\r\n\r\n{head}",
                body.len()
            )
            .as_bytes(),
        )
        .unwrap();
    stream.flush().unwrap();

    // A pausa e o ponto: sem ela o sistema operacional pode juntar as duas
    // escritas num pacote so, e o teste passaria sem exercitar a montagem.
    std::thread::sleep(Duration::from_millis(50));
    stream.write_all(tail.as_bytes()).unwrap();
    stream.flush().unwrap();

    let mut response = String::new();
    stream.read_to_string(&mut response).unwrap();
    assert!(response.contains(r#""name":"write""#), "{response}");
}

#[test]
fn a_fixture_launched_without_the_flag_survives_a_closed_stdin() {
    // O `parity-gate.sh` sobe o fixture em segundo plano, e ali a entrada
    // padrao e `/dev/null`: EOF na primeira leitura. Com o desligamento por
    // stdin incondicional o gateway morria depois de anunciar a porta e antes
    // do primeiro pedido — e o gate acusava o candidato de falha de
    // transporte, que e o instrumento reprovando o que ele deveria medir.
    let mut child = Command::new(env!("CARGO_BIN_EXE_nycode-parity-fixture"))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .spawn()
        .expect("o fixture deveria subir");

    let stdout = child.stdout.take().expect("stdout foi pedido em pipe");
    let mut linha = String::new();
    BufReader::new(stdout)
        .read_line(&mut linha)
        .expect("o fixture anuncia a porta na primeira linha");
    let address = linha
        .trim()
        .trim_start_matches("http://")
        .trim_end_matches("/v1")
        .to_owned();

    let response = request(&address, "GET /v1/models", "");
    assert!(response.starts_with("HTTP/1.1 200 OK"), "{response}");

    // Sinal aqui e o certo: sem a bandeira nao ha desligamento negociado, e e
    // exatamente isso que este teste protege. O perfil de cobertura desta
    // execucao se perde, e os outros cinco testes o gravam.
    let _ = child.kill();
    let _ = child.wait();
}

#[test]
fn a_connection_that_says_nothing_is_dropped_without_taking_the_fixture_down() {
    // Um cliente que abre e fecha nao pode derrubar o servidor: o gate roda
    // varios prompts na mesma instancia.
    let fixture = start();

    drop(TcpStream::connect(&fixture.address).unwrap());

    let response = request(&fixture.address, "GET /v1/models", "");
    assert!(response.starts_with("HTTP/1.1 200 OK"), "{response}");
}
