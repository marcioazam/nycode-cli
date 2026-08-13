//! O que entra no corpo e não é conteúdo: amostragem, raciocínio e cache.
//!
//! Separado de [`super::dialect`] porque muda por outro motivo: aquele muda
//! quando muda o endpoint, o cabeçalho ou a forma do pedido, e isto muda quando
//! muda a política de amostragem, o contrato de raciocínio do provedor, ou onde
//! o ponto de corte do cache é marcado.

use serde_json::{Value, json};

use super::ToolSpec;
use crate::sampling::{self, Sampling};

/// Quanto do teto fica reservado para a resposta quando há raciocínio.
///
/// Menos que isto é uma resposta que cabe numa frase, e um turno que pensou
/// muito para dizer pouco é indistinguível de um que falhou.
const MIN_ANSWER_TOKENS: u64 = 1024;

/// Acrescenta ao corpo o que não é conteúdo: amostragem, raciocínio e cache.
///
/// Feito por cima do JSON serializado, e não por campos em `Request`, porque
/// `cache_control` muda a *forma* de `system` — de string para lista de blocos
/// — e essa forma só existe quando o cache está ligado.
pub fn decorate(body: &mut Value, sampling: &Sampling, breakpoint: Option<usize>) {
    let Some(object) = body.as_object_mut() else {
        return;
    };

    if let Some(temperature) = sampling.temperature {
        object.insert("temperature".to_owned(), json!(temperature));
    }
    if let Some(top_p) = sampling.top_p {
        object.insert("top_p".to_owned(), json!(top_p));
    }
    if !sampling.stop_sequences.is_empty() {
        object.insert("stop_sequences".to_owned(), json!(sampling.stop_sequences));
    }
    if let Some(budget) = sampling.thinking.budget() {
        // O raciocínio divide o teto com a resposta neste provedor. Um orçamento
        // que come o teto inteiro produz um turno que pensa e não responde:
        // gastou tokens, demorou, e devolveu nada.
        //
        // Quem cede é o teto, e não o orçamento. Encolher o raciocínio daria ao
        // usuário menos do que ele pediu sem dizer — o que o NFR-4 proíbe —, e
        // abaixo de mil tokens o provedor recusa o pedido de qualquer forma.
        let budget = u64::from(budget);
        let teto = object
            .get("max_tokens")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        if teto < budget + MIN_ANSWER_TOKENS {
            object.insert("max_tokens".to_owned(), json!(budget + MIN_ANSWER_TOKENS));
        }
        object.insert(
            "thinking".to_owned(),
            json!({ "type": "enabled", "budget_tokens": budget }),
        );
    }

    if !sampling.cache_prefix {
        return;
    }

    // O prefixo estável é o sistema mais as ferramentas: é o que se repete
    // idêntico a cada turno. Marcar depois disso não acerta, porque o histórico
    // cresce e um prefixo que muda é um cache que erra.
    if let Some(Value::String(text)) = object.get("system") {
        let block = json!([{
            "type": "text",
            "text": text,
            "cache_control": sampling::ephemeral(),
        }]);
        object.insert("system".to_owned(), block);
    }

    mark_tool_prefix(object, breakpoint);
}

/// Põe o marcador na ferramenta que fecha o prefixo estável.
///
/// Só uma: o marcador cobre tudo que veio antes dele, e um por ferramenta
/// gastaria os pontos de corte que o backend limita.
///
/// A escolhida é a última **estável**, e não a última do array. Uma ferramenta
/// de servidor MCP entra quando o workspace a declara e some quando o servidor
/// não sobe; com o marcador no fim, conectar um servidor mudaria o que está
/// dentro do prefixo e o cache erraria o turno inteiro. Com ele na última
/// estável, o que varia fica depois do corte e não conta.
fn mark_tool_prefix(object: &mut serde_json::Map<String, Value>, breakpoint: Option<usize>) {
    let Some(index) = breakpoint else {
        return;
    };
    if let Some(Value::Array(tools)) = object.get_mut("tools")
        && let Some(Value::Object(marked)) = tools.get_mut(index)
    {
        marked.insert("cache_control".to_owned(), sampling::ephemeral());
    }
}

/// Onde termina o prefixo estável de ferramentas.
///
/// `None` quando não há nenhuma estável: marcar a primeira extensão faria o
/// ponto de corte se mover junto com o que ele deveria excluir.
pub fn stable_prefix_end(tools: &[ToolSpec]) -> Option<usize> {
    tools.iter().rposition(|tool| !tool.extension)
}
