//! Conversa com um servidor MCP já conectado.
//!
//! Estabelecer a conexão é outro assunto e vive em [`connect`]: aqui o que
//! muda é o formato do resultado de uma chamada, lá é transporte e arranque.

use std::sync::Arc;

use async_trait::async_trait;
use nycode_agent::Tool;
use nycode_agent::mcp::Transport;
use rmcp::model::CallToolRequestParams;
use rmcp::service::{RoleClient, RunningService};
use serde_json::Value;

mod connect;

pub use connect::{connect, connect_all};

/// Prazos de uma conexão MCP.
///
/// Sem eles um servidor que sobe e emudece pendura a abertura da sessão, e uma
/// ferramenta que trava pendura o turno. O cancelamento por Ctrl-C salva quem
/// está no terminal; em headless não há quem o aperte.
#[derive(Debug, Clone, Copy)]
pub struct Timeouts {
    /// Handshake e listagem de ferramentas, que acontecem no arranque.
    pub connect: std::time::Duration,
    /// Uma chamada de ferramenta, que pode ser legitimamente demorada.
    pub call: std::time::Duration,
}

impl Default for Timeouts {
    fn default() -> Self {
        Self {
            connect: std::time::Duration::from_secs(20),
            call: std::time::Duration::from_mins(2),
        }
    }
}

/// Uma conexão viva com um servidor.
///
/// Manter a conexão no `Arc` compartilhado pelas ferramentas é o que faz o
/// servidor sobreviver ao registro: se ela caísse aqui, o processo filho
/// morreria antes da primeira chamada do modelo.
pub struct Session {
    server: String,
    service: RunningService<RoleClient, ()>,
    timeouts: Timeouts,
}

impl std::fmt::Debug for Session {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Session")
            .field("server", &self.server)
            .finish_non_exhaustive()
    }
}

impl Session {
    /// O nome com que o workspace declarou este servidor.
    #[must_use]
    pub fn name(&self) -> &str {
        &self.server
    }
}

#[async_trait]
impl Transport for Session {
    async fn call(&self, tool: &str, arguments: Value) -> Result<String, String> {
        // O protocolo exige um objeto; o agente já normaliza argumentos
        // ausentes para objeto vazio, mas um servidor não pode receber `null`.
        let arguments = match arguments {
            Value::Object(map) => Some(map),
            Value::Null => None,
            other => return Err(format!("argumentos precisam ser um objeto, veio {other}")),
        };

        let mut params = CallToolRequestParams::new(tool.to_owned());
        if let Some(arguments) = arguments {
            params = params.with_arguments(arguments);
        }

        let called = tokio::time::timeout(self.timeouts.call, self.service.call_tool(params));
        let result = called
            .await
            .map_err(|_| {
                format!(
                    "servidor `{}` nao respondeu a `{tool}` em {}s",
                    self.server,
                    self.timeouts.call.as_secs()
                )
            })?
            .map_err(|err| err.to_string())?;

        let rendered = render(&result);
        // O servidor sinaliza falha no próprio resultado. Devolvê-la como
        // sucesso faria o modelo tratar a mensagem de erro como dado.
        if result.is_error.unwrap_or(false) {
            return Err(rendered);
        }
        Ok(rendered)
    }
}

/// Teto do que uma resposta de servidor entrega ao modelo.
///
/// O mesmo teto da saída de comando, e pela mesma razão: a resposta vai inteira
/// para a janela de contexto, e um servidor que devolva o índice inteiro empurra
/// para fora o histórico que interessa. Um servidor é código de terceiro que o
/// repositório declarou, então o tamanho da resposta não é escolha do usuário.
///
/// O teto vale sobre o que sai daqui, não sobre o que entra: o `rmcp` já
/// desserializou a resposta quando esta função a recebe. Limitar o quadro no
/// transporte é o que faltaria para o teto ser de memória também, e depende de o
/// SDK expor a costura.
const MAX_RESPONSE: usize = 64 * 1024;

/// Junta o conteúdo textual de um resultado.
fn render(result: &rmcp::model::CallToolResult) -> String {
    let parts: Vec<String> = result
        .content
        .iter()
        .filter_map(|block| block.as_text().map(|text| text.text.clone()))
        .collect();

    if !parts.is_empty() {
        return capped(parts.join("\n"));
    }
    // Sem bloco de texto, o conteúdo estruturado é o que houver de resposta;
    // devolver vazio faria uma resposta legítima parecer ausência de resposta.
    result
        .structured_content
        .as_ref()
        .map(|content| capped(content.to_string()))
        .unwrap_or_default()
}

/// Corta no teto, dizendo que cortou e de quanto.
///
/// Truncar em silêncio faria o modelo raciocinar sobre uma resposta que ele
/// acredita ter lido inteira, que é a degradação que o NFR-4 proíbe.
fn capped(rendered: String) -> String {
    if rendered.len() <= MAX_RESPONSE {
        return rendered;
    }
    // Recuar até a fronteira de caractere: cortar no byte partiria um codepoint
    // e o que chega ao modelo deixaria de ser texto válido.
    let mut cut = MAX_RESPONSE;
    while cut > 0 && !rendered.is_char_boundary(cut) {
        cut -= 1;
    }
    let total = rendered.len();
    format!(
        "{}\n[truncado: estes sao os primeiros {cut} bytes; a resposta tem {total}]",
        &rendered[..cut]
    )
}

/// O que uma conexão bem-sucedida entrega: a sessão viva e as ferramentas dela.
///
/// A sessão vem junto porque o chamador precisa segurá-la: largá-la mataria o
/// processo do servidor antes da primeira chamada do modelo.
pub type Connected = (Arc<Session>, Vec<Arc<dyn Tool>>);

#[cfg(test)]
mod tests {
    use super::connect::attach_within;
    use super::*;
    use crate::fakes::{Fixture, Reply};

    /// Conecta a um servidor em processo com a resposta programada.
    async fn against(reply: Reply) -> Connected {
        let channel = crate::fakes::channel(Fixture { reply });
        attach_within("docs", channel, Timeouts::default())
            .await
            .expect("o handshake em memoria")
    }

    fn ctx() -> (tempfile::TempDir, nycode_agent::ToolContext) {
        let dir = tempfile::tempdir().unwrap();
        let ctx = nycode_agent::ToolContext::new(dir.path()).unwrap();
        (dir, ctx)
    }

    #[tokio::test]
    async fn calling_a_tool_returns_what_the_server_answered() {
        let (dir, context) = ctx();
        let (_session, tools) = against(Reply::Text("achei tres".to_owned())).await;

        let output = tools[0]
            .execute(serde_json::json!({ "q": "erro" }), &context)
            .await;

        assert_eq!(output.content, "achei tres");
        assert!(!output.is_error);
        drop(dir);
    }

    #[tokio::test]
    async fn a_failure_the_server_flags_reaches_the_model_as_a_failure() {
        // Devolver como sucesso faria o modelo tratar a mensagem de erro como
        // conteudo, que e a degradacao silenciosa que o NFR-4 proibe.
        let (dir, context) = ctx();
        let (_session, tools) = against(Reply::Failure("indice offline".to_owned())).await;

        // O dublê declara `q` obrigatório, e a conferência de schema acontece
        // antes da chamada: omiti-lo faria o teste medir a conferência em vez
        // do que ele diz medir.
        let output = tools[0]
            .execute(serde_json::json!({ "q": "erro" }), &context)
            .await;

        assert!(output.is_error, "o servidor sinalizou erro");
        assert!(
            output.content.contains("indice offline"),
            "{}",
            output.content
        );
        assert!(
            output.content.contains("docs__search"),
            "o nome qualificado precisa aparecer: {}",
            output.content
        );
        drop(dir);
    }

    #[tokio::test]
    async fn a_protocol_error_becomes_a_reported_failure_not_a_panic() {
        // O servidor pode recusar no nivel do protocolo, e nao no resultado.
        // Esse caminho tem de virar erro legivel em vez de derrubar o turno.
        let (session, _tools) = against(Reply::Empty).await;

        let err = session
            .call("explode", serde_json::json!({}))
            .await
            .expect_err("o servidor recusou");
        assert!(err.contains("recusou"), "{err}");
    }

    #[tokio::test]
    async fn a_tool_that_never_answers_does_not_hang_the_turn() {
        // O servidor responde ao handshake e a listagem, e trava na chamada. E
        // o caso que o prazo de conexao nao cobre: sem prazo aqui, o turno
        // espera para sempre.
        let prazos = Timeouts {
            call: std::time::Duration::from_millis(100),
            ..Timeouts::default()
        };
        let canal = crate::fakes::channel(Fixture { reply: Reply::Hang });
        let (session, _tools) = attach_within("travado", canal, prazos)
            .await
            .expect("o handshake responde");

        let err = session
            .call("search", serde_json::json!({ "q": "x" }))
            .await
            .expect_err("a chamada precisa estourar o prazo");

        assert!(
            err.contains("travado"),
            "o servidor precisa se nomear: {err}"
        );
        assert!(
            err.contains("search"),
            "a ferramenta precisa aparecer: {err}"
        );
    }

    #[tokio::test]
    async fn a_result_without_text_falls_back_to_the_structured_content() {
        // Devolver vazio faria uma resposta legitima parecer ausencia de
        // resposta, e o modelo concluiria que a ferramenta nao achou nada.
        let (dir, context) = ctx();
        let (_session, tools) = against(Reply::Structured(serde_json::json!({ "total": 3 }))).await;

        let output = tools[0]
            .execute(serde_json::json!({ "q": "x" }), &context)
            .await;
        assert!(output.content.contains("total"), "{}", output.content);
        drop(dir);
    }

    #[test]
    fn an_oversized_response_is_cut_and_says_the_real_size() {
        // A resposta vai inteira para a janela de contexto, e um servidor e
        // codigo de terceiro que o repositorio declarou: o tamanho dela nao e
        // escolha do usuario. Cortar em silencio faria o modelo raciocinar
        // sobre uma resposta que acredita ter lido inteira.
        let grande = "x".repeat(MAX_RESPONSE + 500);
        let out = capped(grande);

        assert!(out.contains("[truncado"), "{}", &out[out.len() - 120..]);
        assert!(out.contains(&(MAX_RESPONSE + 500).to_string()));
        assert!(out.len() < MAX_RESPONSE + 200, "cortou de verdade");
    }

    #[test]
    fn a_response_that_fits_is_untouched() {
        assert_eq!(capped("curta".to_owned()), "curta");
    }

    #[test]
    fn the_cut_never_splits_a_character() {
        // Cortar no byte partiria um codepoint e o que chega ao modelo
        // deixaria de ser texto valido.
        let out = capped("á".repeat(MAX_RESPONSE));
        assert!(out.contains("[truncado"));
        // O `format!` so produz `String` valida; o que se protege e que o
        // recuo ate a fronteira aconteceu antes da fatia.
        assert!(out.starts_with('á'));
    }

    #[tokio::test]
    async fn an_entirely_empty_result_is_empty_rather_than_an_error() {
        let (dir, context) = ctx();
        let (_session, tools) = against(Reply::Empty).await;

        let output = tools[0]
            .execute(serde_json::json!({ "q": "x" }), &context)
            .await;
        assert!(output.content.is_empty());
        assert!(!output.is_error);
        drop(dir);
    }

    #[tokio::test]
    async fn non_object_arguments_are_refused_before_reaching_the_server() {
        // O protocolo exige objeto; mandar um escalar produziria um erro de
        // desserializacao no servidor, longe da causa.
        let (session, _tools) = against(Reply::Empty).await;

        let err = session
            .call("search", serde_json::json!("texto solto"))
            .await
            .expect_err("um escalar nao e argumento valido");
        assert!(err.contains("objeto"), "{err}");
    }

    #[tokio::test]
    async fn a_debug_view_names_the_server_without_dumping_the_connection() {
        let (session, _tools) = against(Reply::Empty).await;
        let rendered = format!("{session:?}");
        assert!(rendered.contains("docs"), "{rendered}");
    }
}
