//! Catálogo de modelos.
//!
//! A fonte é o `GET /v1/models` do próprio endpoint, que é autoritativo sobre o
//! que aquele gateway realmente serve. Manter uma lista fixa no binário
//! significaria envelhecer a cada release de modelo; o `models.dev` existe como
//! complemento comunitário para metadados que um endpoint não declara.

pub mod cost;

pub use cost::{Cost, Price, Rates, Tier};

use serde::Deserialize;
use serde_json::Value;

use crate::config::Config;
use crate::error::{Error, Result};

/// Endpoint público do catálogo comunitário.
pub const MODELS_DEV_URL: &str = "https://models.dev/api.json";

/// Um modelo disponível.
///
/// Serializável porque o catálogo é cacheado em disco: buscá-lo a cada execução
/// colocaria uma ida à rede no caminho de startup, que o NFR-1 mede.
// Sem `Eq`: o preço é ponto flutuante, e igualdade exata de `f64` não é uma
// relação de equivalência. `PartialEq` é o que os testes precisam.
#[derive(Debug, Clone, PartialEq, serde::Serialize, Deserialize)]
pub struct Model {
    pub id: String,
    pub display_name: String,
    /// Janela de contexto em tokens, quando declarada.
    ///
    /// Sem ela a interface não tem como dizer quanto resta antes de compactar.
    pub context_window: Option<u64>,
    pub max_output_tokens: Option<u64>,
    /// Tarifas declaradas pelo endpoint, quando ele as declara.
    ///
    /// `None` é dizer que não se sabe, e a interface mostra volume sem custo.
    /// O FR-6 proíbe tabela fixa no binário, e estimar por família de modelo
    /// daria um número inventado com a mesma cara de um medido (ADR-0026).
    #[serde(default)]
    pub price: Option<Price>,
    /// Se o modelo aceita imagem, quando o catálogo declara.
    ///
    /// `None` é o comportamento antigo: o pedido leva o anexo. `Some(false)`
    /// tira a imagem do fio.
    #[serde(default)]
    pub vision: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct ModelsResponse {
    data: Vec<Value>,
}

/// Lê o catálogo de um endpoint compatível.
///
/// O prazo é total, e não de ociosidade como o do turno: aqui não há streaming
/// a proteger, e a chamada roda no arranque, antes de a interface abrir. Sem
/// teto, um gateway que aceita a conexão e não responde trava o binário sem
/// desenhar nada na tela.
pub async fn fetch(http: &reqwest::Client, config: &Config) -> Result<Vec<Model>> {
    // O cabeçalho é o do dialeto configurado, e só ele. Mandar `x-api-key` e
    // `Authorization` juntos entregava a credencial em dois formatos a quem
    // estivesse do outro lado — e o outro lado é um `base_url` que o usuário
    // aponta, não necessariamente o gateway que ele imagina.
    let mut request = http
        .get(config.endpoint("models"))
        .timeout(config.timeouts.catalog);
    for (name, value) in config.dialect.build().headers(&config.api_key) {
        request = request.header(name, value);
    }

    let response = request.send().await?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(Error::Config(format!(
            "catalogo respondeu {status}: {body}"
        )));
    }

    let parsed: ModelsResponse = response
        .json()
        .await
        .map_err(|err| Error::Config(format!("catalogo malformado: {err}")))?;

    Ok(parsed.data.iter().filter_map(parse_model).collect())
}

/// Projeta uma entrada de catálogo no formato interno.
///
/// Os nomes de campo variam entre implementações: `context_window` é o que o
/// gateway emite, `context_length` é o que a convenção OpenAI usa. Ler só um dos
/// dois deixaria a janela desconhecida contra metade dos endpoints.
///
/// Um modelo sem `id` é descartado: sem identificador não há como selecioná-lo.
fn parse_model(raw: &Value) -> Option<Model> {
    let id = raw.get("id").and_then(Value::as_str)?.to_owned();
    let number = |names: &[&str]| {
        names
            .iter()
            .find_map(|name| raw.get(*name).and_then(Value::as_u64))
    };

    Some(Model {
        display_name: raw
            .get("display_name")
            .or_else(|| raw.get("name"))
            .and_then(Value::as_str)
            .unwrap_or(&id)
            .to_owned(),
        context_window: number(&["context_window", "context_length"]),
        max_output_tokens: number(&["max_output_tokens", "max_tokens"]),
        price: cost::parse(raw),
        vision: vision_of(raw),
        id,
    })
}

fn vision_of(raw: &Value) -> Option<bool> {
    if let Some(flag) = raw.get("vision").and_then(Value::as_bool) {
        return Some(flag);
    }
    let inputs = raw
        .pointer("/modalities/input")
        .or_else(|| raw.get("input"))
        .and_then(Value::as_array)?;
    Some(inputs.iter().any(|item| item.as_str() == Some("image")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    async fn serve(body: Value, status: u16) -> MockServer {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/models"))
            .respond_with(ResponseTemplate::new(status).set_body_json(body))
            .mount(&server)
            .await;
        server
    }

    fn config(server: &MockServer) -> Config {
        Config::new(format!("{}/v1", server.uri()), "chave").unwrap()
    }

    #[tokio::test]
    async fn the_catalog_sends_only_the_header_its_dialect_uses() {
        // Mandar `x-api-key` e `Authorization` juntos entregava a credencial em
        // dois formatos, e o destino e um `base_url` que o usuario aponta — nao
        // necessariamente o gateway que ele imagina.
        use wiremock::matchers::header;

        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/models"))
            .and(header("x-api-key", "chave"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"data":[]})))
            .mount(&server)
            .await;

        // Anthropic autentica por `x-api-key`; o `Authorization` nao pode ir.
        fetch(&reqwest::Client::new(), &config(&server))
            .await
            .expect("o catalogo respondeu");

        let recebidas = server.received_requests().await.expect("houve pedido");
        assert!(
            recebidas[0].headers.get("authorization").is_none(),
            "a credencial foi tambem no formato do outro dialeto"
        );
    }

    #[tokio::test]
    async fn a_dialect_that_authenticates_with_bearer_does_not_send_the_other_header() {
        use wiremock::matchers::header;

        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/models"))
            .and(header("authorization", "Bearer chave"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"data":[]})))
            .mount(&server)
            .await;

        let config = config(&server).with_dialect(crate::dialect::Kind::OpenAiChat);
        fetch(&reqwest::Client::new(), &config)
            .await
            .expect("o catalogo respondeu");

        let recebidas = server.received_requests().await.expect("houve pedido");
        assert!(
            recebidas[0].headers.get("x-api-key").is_none(),
            "a credencial foi tambem no formato do outro dialeto"
        );
    }

    #[tokio::test]
    async fn reads_the_gateway_catalog_with_real_context_windows() {
        // O gateway anuncia a janela real do modelo; sem ela a interface nao tem
        // como dizer quanto resta antes de compactar.
        let server = serve(
            json!({"data":[
                {"id":"nylla-sonnet-4.5","display_name":"Nylla Sonnet 4.5","context_window":200_000},
                {"id":"nylla-grok-4.5","context_length":500_000}
            ]}),
            200,
        )
        .await;

        let models = fetch(&reqwest::Client::new(), &config(&server))
            .await
            .unwrap();
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].display_name, "Nylla Sonnet 4.5");
        assert_eq!(models[0].context_window, Some(200_000));
        assert_eq!(
            models[1].context_window,
            Some(500_000),
            "context_length foi ignorado"
        );
    }

    #[tokio::test]
    async fn a_model_without_an_id_is_discarded() {
        // Sem identificador nao ha como seleciona-lo; listar produziria uma
        // entrada inutil no seletor.
        let server = serve(
            json!({"data":[{"display_name":"sem id"},{"id":"bom"}]}),
            200,
        )
        .await;

        let models = fetch(&reqwest::Client::new(), &config(&server))
            .await
            .unwrap();
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].id, "bom");
    }

    #[tokio::test]
    async fn the_id_is_the_fallback_display_name() {
        let server = serve(json!({"data":[{"id":"nylla-swe-1.6"}]}), 200).await;
        let models = fetch(&reqwest::Client::new(), &config(&server))
            .await
            .unwrap();
        assert_eq!(models[0].display_name, "nylla-swe-1.6");
        assert_eq!(models[0].context_window, None);
    }

    #[tokio::test]
    async fn an_error_response_names_the_status() {
        let server = serve(json!({"error":"nao autorizado"}), 401).await;
        let err = fetch(&reqwest::Client::new(), &config(&server))
            .await
            .unwrap_err();
        assert!(err.to_string().contains("401"));
    }

    #[tokio::test]
    async fn a_malformed_catalog_is_reported_as_configuration() {
        let server = serve(json!({"inesperado": true}), 200).await;
        let err = fetch(&reqwest::Client::new(), &config(&server))
            .await
            .unwrap_err();
        assert!(matches!(err, Error::Config(_)));
    }

    #[tokio::test]
    async fn a_gateway_that_never_answers_the_catalog_does_not_hang_startup() {
        // A busca roda antes de a interface abrir: sem prazo, um gateway que
        // aceita a conexao e nao responde trava o binario sem desenhar nada.
        use wiremock::matchers::method;
        use wiremock::{Mock, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(200).set_delay(std::time::Duration::from_secs(30)))
            .mount(&server)
            .await;

        let config = config(&server).with_timeouts(crate::config::Timeouts {
            catalog: std::time::Duration::from_millis(50),
            ..crate::config::Timeouts::default()
        });

        let err = fetch(&reqwest::Client::new(), &config).await.unwrap_err();
        assert!(
            matches!(&err, Error::Transport(inner) if inner.is_timeout()),
            "esperado estouro de prazo, veio {err:?}"
        );
    }

    #[test]
    fn both_field_conventions_are_read() {
        // `max_output_tokens` e a forma do gateway, `max_tokens` a da convencao
        // OpenAI. Ler so uma deixaria metade dos endpoints sem limite conhecido.
        let gateway = parse_model(&json!({"id":"a","max_output_tokens":8192})).unwrap();
        assert_eq!(gateway.max_output_tokens, Some(8192));

        let openai = parse_model(&json!({"id":"b","max_tokens":4096})).unwrap();
        assert_eq!(openai.max_output_tokens, Some(4096));
    }

    #[test]
    fn vision_comes_from_the_catalog_not_from_a_hardcoded_family() {
        assert_eq!(
            parse_model(&json!({"id": "a", "vision": false}))
                .unwrap()
                .vision,
            Some(false)
        );
        assert_eq!(
            parse_model(&json!({
                "id": "b",
                "modalities": {"input": ["text", "image"]}
            }))
            .unwrap()
            .vision,
            Some(true)
        );
        assert_eq!(
            parse_model(&json!({"id": "c", "input": ["text"]}))
                .unwrap()
                .vision,
            Some(false)
        );
        assert_eq!(parse_model(&json!({"id": "d"})).unwrap().vision, None);
    }

    #[test]
    fn the_community_catalog_url_is_the_documented_one() {
        assert_eq!(MODELS_DEV_URL, "https://models.dev/api.json");
    }
}
