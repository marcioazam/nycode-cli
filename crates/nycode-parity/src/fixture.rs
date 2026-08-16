//! Gateway determinístico para o harness de paridade.
//!
//! O gate de paridade nunca rodou por um motivo mecânico: a comparação precisa
//! dos dois harnesses **e** de um gateway para os dois falarem, e o gateway não
//! estava disponível. Sem ele o script saía com zero, dizendo em voz alta que
//! não executou — honesto, e mesmo assim uma regra sem instrumento.
//!
//! Este módulo é o instrumento. Serve o dialeto Anthropic Messages com um script
//! fixo, o suficiente para que uma execução produza as cinco dimensões que o
//! [`crate::transcript`] compara: uma chamada de ferramenta, um arquivo escrito,
//! um `stop_reason`, uma contabilidade e um código de saída.
//!
//! O que ele **não** é: um substituto do gateway real. Ele prova que os dois
//! harnesses reagem igual às mesmas respostas, que é exatamente o que o NFR-6
//! pergunta. Não prova nada sobre o gateway.
//!
//! # Forma
//!
//! A decisão está em funções puras — [`plan`], [`route`], [`respond`] — e a E/S
//! é uma casca fina sobre elas. É o que permite testar o script inteiro sem
//! abrir socket.

use serde_json::Value;

/// Contabilidade que toda resposta reporta.
///
/// Constante de propósito. Os dois harnesses montam prompt de sistema e schema
/// de ferramenta diferentes, então uma contagem derivada do tamanho do corpo
/// divergiria entre eles por uma razão que não é defeito de nenhum dos dois — e
/// o harness acusaria divergência de tokens em toda execução.
const INPUT_TOKENS: u64 = 1_234;
const OUTPUT_TOKENS: u64 = 56;

/// O conteúdo que o script manda escrever.
const WRITTEN: &str = "pronto\n";

/// O que a próxima resposta faz.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Plan {
    /// Responder em texto e encerrar o turno.
    Text,
    /// Pedir a escrita de `saida.txt`.
    Write,
    /// Pedir a leitura do `README.md`.
    Read,
}

/// Decide o que responder a partir do corpo do pedido.
///
/// Um pedido que já carrega `tool_result` é a segunda metade de um turno de
/// ferramenta: o script encerra em vez de pedir outra, senão o laço não pararia.
///
/// Só o que o usuário mandou conta. A referência inclui `README.md` no prompt
/// de sistema; procurar no corpo inteiro pedia `read` em todo turno.
#[must_use]
pub fn plan(body: &str) -> Plan {
    let haystack = user_facing(body);
    if haystack.contains("tool_result") {
        return Plan::Text;
    }
    if haystack.contains("saida.txt") {
        return Plan::Write;
    }
    if haystack.contains("README.md") {
        return Plan::Read;
    }
    Plan::Text
}

/// Texto em que o script decide o plano: mensagens, nunca o `system`.
fn user_facing(body: &str) -> String {
    let Ok(value) = serde_json::from_str::<Value>(body) else {
        return body.to_owned();
    };
    match value.get("messages") {
        Some(messages) => messages.to_string(),
        None => body.to_owned(),
    }
}

/// O corpo SSE correspondente a um plano.
#[must_use]
pub fn turn(plan: Plan) -> String {
    let mut out = String::new();
    event(
        &mut out,
        "message_start",
        &format!(
            r#"{{"type":"message_start","message":{{"id":"msg_fixture","usage":{{"input_tokens":{INPUT_TOKENS},"output_tokens":0}}}}}}"#
        ),
    );

    let stop = match plan {
        Plan::Text => {
            text_block(&mut out, "ok");
            "end_turn"
        }
        Plan::Write => {
            tool_block(
                &mut out,
                "write",
                &serde_json::json!({ "path": "saida.txt", "content": WRITTEN }),
            );
            "tool_use"
        }
        Plan::Read => {
            tool_block(
                &mut out,
                "read",
                &serde_json::json!({ "path": "README.md" }),
            );
            "tool_use"
        }
    };

    event(
        &mut out,
        "message_delta",
        &format!(
            r#"{{"type":"message_delta","delta":{{"stop_reason":"{stop}"}},"usage":{{"output_tokens":{OUTPUT_TOKENS}}}}}"#
        ),
    );
    event(&mut out, "message_stop", r#"{"type":"message_stop"}"#);
    out
}

fn text_block(out: &mut String, text: &str) {
    event(
        out,
        "content_block_start",
        r#"{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}"#,
    );
    event(
        out,
        "content_block_delta",
        &format!(
            r#"{{"type":"content_block_delta","index":0,"delta":{{"type":"text_delta","text":"{text}"}}}}"#
        ),
    );
    event(
        out,
        "content_block_stop",
        r#"{"type":"content_block_stop","index":0}"#,
    );
}

fn tool_block(out: &mut String, name: &str, input: &Value) {
    event(
        out,
        "content_block_start",
        &format!(
            r#"{{"type":"content_block_start","index":0,"content_block":{{"type":"tool_use","id":"toolu_fixture","name":"{name}","input":{{}}}}}}"#
        ),
    );
    // O argumento vai num fragmento so: o decodificador acumula fragmentos, e
    // parti-lo aqui exercitaria a acumulacao sem mudar o resultado observavel.
    let fragment =
        serde_json::to_string(&input.to_string()).unwrap_or_else(|_| "\"{}\"".to_owned());
    event(
        out,
        "content_block_delta",
        &format!(
            r#"{{"type":"content_block_delta","index":0,"delta":{{"type":"input_json_delta","partial_json":{fragment}}}}}"#
        ),
    );
    event(
        out,
        "content_block_stop",
        r#"{"type":"content_block_stop","index":0}"#,
    );
}

fn event(out: &mut String, name: &str, data: &str) {
    out.push_str("event: ");
    out.push_str(name);
    out.push_str("\ndata: ");
    out.push_str(data);
    out.push_str("\n\n");
}

/// O catálogo que o gateway declara.
///
/// O identificador é o mesmo modelo padrão do `nycode`, e não um nome
/// inventado: o binário valida o modelo pedido contra o catálogo e recusa o que
/// o endpoint não serve, então um nome próprio aqui obrigaria toda invocação a
/// passar `--model` — inclusive a do harness de paridade, que não passa.
#[must_use]
pub fn models() -> String {
    r#"{"data":[{"id":"nylla-sonnet-4.5","display_name":"Fixture Sonnet","context_window":200000,"max_output_tokens":8192}]}"#
        .to_owned()
}

/// Uma resposta HTTP, antes de virar bytes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reply {
    pub status: &'static str,
    pub content_type: &'static str,
    pub body: String,
}

/// Roteia um pedido.
///
/// Só dois caminhos importam: o catálogo, que o `nycode` busca ao montar a
/// sessão, e as mensagens. Qualquer outro é 404 — um gateway que respondesse
/// alguma coisa a tudo esconderia um caminho pedido por engano.
#[must_use]
pub fn route(method: &str, path: &str, body: &str) -> Reply {
    match (method, path.trim_end_matches('/')) {
        ("GET", "/v1/models") => Reply {
            status: "200 OK",
            content_type: "application/json",
            body: models(),
        },
        ("POST", "/v1/messages") => Reply {
            status: "200 OK",
            content_type: "text/event-stream",
            body: turn(plan(body)),
        },
        _ => Reply {
            status: "404 Not Found",
            content_type: "application/json",
            body: r#"{"type":"error","error":{"type":"not_found","message":"rota nao servida pelo fixture"}}"#
                .to_owned(),
        },
    }
}

/// Serializa a resposta em HTTP/1.1.
#[must_use]
pub fn respond(reply: &Reply) -> String {
    format!(
        "HTTP/1.1 {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        reply.status,
        reply.content_type,
        reply.body.len(),
        reply.body
    )
}

/// Método, caminho e tamanho do corpo declarados no cabeçalho.
///
/// Devolve `None` para um cabeçalho que não tem linha de pedido — o que
/// acontece quando alguém abre a conexão e a fecha sem falar.
#[must_use]
pub fn parse_head(head: &str) -> Option<(String, String, usize)> {
    let mut lines = head.lines();
    let mut request = lines.next()?.split_whitespace();
    let method = request.next()?.to_owned();
    let path = request.next()?.to_owned();

    let length = lines
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("content-length")
                .then(|| value.trim().parse().ok())?
        })
        .unwrap_or(0);

    Some((method, path, length))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_first_request_mentioning_the_output_file_asks_for_a_write() {
        assert_eq!(
            plan(r#"{"messages":[{"text":"crie saida.txt"}]}"#),
            Plan::Write
        );
    }

    #[test]
    fn a_first_request_mentioning_the_readme_asks_for_a_read() {
        assert_eq!(
            plan(r#"{"messages":[{"text":"leia o README.md"}]}"#),
            Plan::Read
        );
    }

    #[test]
    fn a_request_carrying_a_tool_result_ends_the_turn() {
        // Sem esta regra o script pediria a mesma ferramenta de novo e o turno
        // so pararia no teto de rodadas do agente.
        let body = r#"{"messages":[{"content":[{"type":"tool_result","content":"ok"}]},{"text":"saida.txt"}]}"#;
        assert_eq!(plan(body), Plan::Text);
    }

    #[test]
    fn a_request_asking_for_nothing_in_particular_answers_in_text() {
        assert_eq!(plan(r#"{"messages":[{"text":"responda ok"}]}"#), Plan::Text);
    }

    #[test]
    fn a_readme_in_the_system_prompt_does_not_ask_for_a_read() {
        // A referência manda README.md no prompt de sistema. Procurar no corpo
        // inteiro fazia o fixture pedir `read` em todo turno, inclusive no
        // prompt que só pede a palavra "ok" — divergência do instrumento, não
        // do candidato.
        let body = r#"{"system":"leia README.md se existir","messages":[{"role":"user","content":"responda ok"}]}"#;
        assert_eq!(plan(body), Plan::Text);
    }

    #[test]
    fn a_text_turn_carries_usage_and_a_stop_reason() {
        let sse = turn(Plan::Text);
        assert!(sse.contains(r#""input_tokens":1234"#));
        assert!(sse.contains(r#""output_tokens":56"#));
        assert!(sse.contains(r#""stop_reason":"end_turn""#));
        assert!(sse.contains("event: message_stop"));
    }

    #[test]
    fn a_tool_turn_names_the_tool_and_stops_for_it() {
        let sse = turn(Plan::Write);
        assert!(sse.contains(r#""name":"write""#));
        assert!(sse.contains(r#""stop_reason":"tool_use""#));
    }

    #[test]
    fn the_tool_argument_survives_as_a_parsable_json_string() {
        // O fragmento vai escapado dentro de `partial_json`; se o escape
        // estiver errado o agente recebe argumento invalido e a ferramenta
        // nunca roda.
        let sse = turn(Plan::Read);
        let line = sse
            .lines()
            .find(|l| l.contains("input_json_delta"))
            .unwrap();
        let value: Value = serde_json::from_str(line.trim_start_matches("data: ")).unwrap();
        let fragment = value["delta"]["partial_json"].as_str().unwrap();
        let parsed: Value = serde_json::from_str(fragment).unwrap();
        assert_eq!(parsed["path"], "README.md");
    }

    #[test]
    fn the_written_content_round_trips_through_the_fragment() {
        let sse = turn(Plan::Write);
        let line = sse
            .lines()
            .find(|l| l.contains("input_json_delta"))
            .unwrap();
        let value: Value = serde_json::from_str(line.trim_start_matches("data: ")).unwrap();
        let parsed: Value =
            serde_json::from_str(value["delta"]["partial_json"].as_str().unwrap()).unwrap();
        assert_eq!(parsed["content"], WRITTEN);
    }

    #[test]
    fn the_catalog_declares_the_default_model_so_no_flag_is_needed() {
        // O binario recusa modelo que o catalogo nao lista. Um nome proprio
        // aqui quebraria o harness de paridade, que nao passa `--model`.
        let value: Value = serde_json::from_str(&models()).unwrap();
        assert_eq!(value["data"][0]["id"], "nylla-sonnet-4.5");
        assert_eq!(value["data"][0]["context_window"], 200_000);
    }

    #[test]
    fn the_two_served_routes_answer_and_everything_else_is_refused() {
        assert_eq!(route("GET", "/v1/models", "").status, "200 OK");
        assert_eq!(
            route("POST", "/v1/messages", "").content_type,
            "text/event-stream"
        );
        assert_eq!(route("GET", "/v1/whatever", "").status, "404 Not Found");
        assert_eq!(route("POST", "/v1/models", "").status, "404 Not Found");
    }

    #[test]
    fn a_trailing_slash_is_the_same_route() {
        assert_eq!(route("GET", "/v1/models/", "").status, "200 OK");
    }

    #[test]
    fn the_response_declares_the_byte_length_of_the_body() {
        // Errar isso trava o cliente esperando bytes que nao vem, e a falha
        // aparece como prazo de ociosidade em vez de erro de fixture.
        let reply = route("GET", "/v1/models", "");
        let raw = respond(&reply);
        let declared: usize = raw
            .lines()
            .find_map(|l| l.strip_prefix("Content-Length: "))
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        assert_eq!(declared, reply.body.len());
    }

    #[test]
    fn the_head_yields_method_path_and_body_length() {
        let head = "POST /v1/messages HTTP/1.1\r\nHost: x\r\nContent-Length: 42\r\n";
        assert_eq!(
            parse_head(head),
            Some(("POST".to_owned(), "/v1/messages".to_owned(), 42))
        );
    }

    #[test]
    fn the_content_length_header_is_matched_case_insensitively() {
        let head = "POST /v1/messages HTTP/1.1\r\ncontent-length: 7\r\n";
        assert_eq!(parse_head(head).unwrap().2, 7);
    }

    #[test]
    fn a_request_without_a_body_length_reads_no_body() {
        assert_eq!(parse_head("GET /v1/models HTTP/1.1\r\n").unwrap().2, 0);
    }

    #[test]
    fn a_malformed_head_is_refused_rather_than_guessed() {
        assert_eq!(parse_head(""), None);
        assert_eq!(parse_head("GET\r\n"), None);
    }

    #[test]
    fn an_unparsable_content_length_is_treated_as_absent() {
        // Um valor que nao e numero nao pode virar tamanho; ler zero byte e
        // devolver 404 diz mais que travar na leitura.
        let head = "POST /v1/messages HTTP/1.1\r\nContent-Length: nao-e-numero\r\n";
        assert_eq!(parse_head(head).unwrap().2, 0);
    }
}
