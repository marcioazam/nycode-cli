//! Identificador de chamada de ferramenta que este provedor aceita.
//!
//! A Anthropic restringe o id a `^[a-zA-Z0-9_-]+$` com no máximo 64 caracteres.
//! Os outros dois dialetos não têm essa restrição: o `openai-responses` emite
//! `call_id` que passa de 450 caracteres e contém `|`.
//!
//! Isso só importa porque o histórico sobrevive à troca de modelo — é o que
//! `Agent::set_backend` existe para permitir, e é deliberado. Uma sessão que
//! acumula chamadas de ferramenta sob um dialeto e depois troca para este manda
//! ids que o provedor recusa, e a recusa é da **conversa inteira**, não da
//! chamada: a sessão para de funcionar sem que nada no histórico esteja errado.
//!
//! A reescrita é determinística e sem estado de propósito. O bloco `tool_use` e
//! o `tool_result` que responde a ele são convertidos pela mesma função na mesma
//! montagem de corpo, então o par continua casando sem que ninguém precise
//! carregar um mapa de sessão.

use std::borrow::Cow;

use super::types::{ContentBlock, Message};

/// Teto do provedor.
const MAX: usize = 64;

/// Quantos caracteres hexadecimais do resumo entram quando o id é longo demais.
const DIGEST: usize = 16;

/// Reescreve os identificadores de um histórico para a forma que este provedor
/// aceita.
///
/// Feito na montagem do corpo, e não na recepção: o `call_id` que o
/// `openai-responses` emite precisa voltar **intacto** para ele, então
/// normalizar na entrada quebraria o caso de não trocar de dialeto, que é o
/// comum. Aqui a conversão vale só para o corpo que sai daqui.
#[must_use]
pub fn rewrite(messages: &[Message]) -> Vec<Message> {
    messages
        .iter()
        .map(|message| {
            let mut message = message.clone();
            for block in &mut message.content {
                match block {
                    ContentBlock::ToolUse { id, .. } => *id = portable(id).into_owned(),
                    ContentBlock::ToolResult { tool_use_id, .. } => {
                        *tool_use_id = portable(tool_use_id).into_owned();
                    }
                    ContentBlock::Text { .. } | ContentBlock::Image { .. } => {}
                }
            }
            message
        })
        .collect()
}

/// Converte um identificador para a forma que este provedor aceita.
///
/// Um id que já serve passa intacto: reescrever o que está certo trocaria um
/// valor que o provedor devolveu por outro sem motivo, e é o caso comum.
#[must_use]
pub fn portable(id: &str) -> Cow<'_, str> {
    if acceptable(id) {
        return Cow::Borrowed(id);
    }

    let cleaned: String = id
        .chars()
        .map(|c| if allowed(c) { c } else { '_' })
        .collect();

    if cleaned.len() <= MAX && !cleaned.is_empty() {
        return Cow::Owned(cleaned);
    }

    // O resumo é do id **original**, e não do limpo: dois ids que só diferem
    // num caractere fora do alfabeto colidiriam depois da limpeza, e dois
    // `tool_use` com o mesmo id são uma conversa que o provedor recusa por
    // outro motivo.
    let digest = fingerprint(id);
    let keep = MAX - DIGEST - 1;
    let head: String = cleaned.chars().take(keep).collect();
    Cow::Owned(format!("{head}_{digest}"))
}

fn acceptable(id: &str) -> bool {
    !id.is_empty() && id.len() <= MAX && id.chars().all(allowed)
}

const fn allowed(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_' || c == '-'
}

fn fingerprint(id: &str) -> String {
    use std::hash::{Hash as _, Hasher as _};

    // `DefaultHasher::new` fixa as chaves, então o mesmo id produz o mesmo
    // resumo — que é o que faz o par `tool_use`/`tool_result` continuar casando
    // sem mapa. Não é hash criptográfico e não precisa ser: o que se quer aqui
    // é distinguir ids, não resistir a alguém que os escolha.
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    id.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

#[cfg(test)]
mod tests {
    use super::super::ToolSpec;
    use super::*;
    use crate::dialect::{Dialect as _, UnifiedRequest};
    use crate::sampling::Sampling;

    /// Um `call_id` no formato que o `openai-responses` emite.
    fn responses_style() -> String {
        "fc_".to_owned() + &"a".repeat(460) + "|call_0"
    }

    #[test]
    fn a_history_carried_over_from_another_dialect_still_produces_a_body_this_one_accepts() {
        // O caso inteiro. `Agent::set_backend` mantem o historico ao trocar de
        // modelo, de proposito. Um id do `openai-responses` passa de 450
        // caracteres e tem `|`, e a Anthropic recusa a **conversa inteira** por
        // causa dele — nao a chamada. A sessao para de funcionar sem que nada no
        // historico esteja errado.
        let bruto = responses_style();
        let messages = vec![
            Message::assistant(vec![ContentBlock::ToolUse {
                id: bruto.clone(),
                name: "read".to_owned(),
                input: serde_json::json!({"path": "a.rs"}),
            }]),
            Message::tool_results(vec![ContentBlock::ToolResult {
                tool_use_id: bruto.clone(),
                content: "conteudo".to_owned(),
                is_error: false,
            }]),
        ];

        let body = super::super::dialect::Messages.body(&UnifiedRequest {
            model: "nylla-sonnet-4.5",
            max_tokens: 1024,
            messages: &messages,
            system: None,
            tools: &[] as &[ToolSpec],
            sampling: &Sampling::default(),
        });

        let emitido = body["messages"][0]["content"][0]["id"]
            .as_str()
            .expect("o bloco de uso de ferramenta precisa ter id");
        let respondido = body["messages"][1]["content"][0]["tool_use_id"]
            .as_str()
            .expect("o resultado precisa apontar para a chamada");

        assert!(
            acceptable(emitido),
            "o provedor recusaria o id emitido: {emitido}"
        );
        assert_eq!(
            emitido, respondido,
            "o par se desfez: o resultado deixou de apontar para a chamada"
        );
    }

    #[test]
    fn an_identifier_this_provider_already_accepts_passes_untouched() {
        // O caso comum. Reescrever o que esta certo trocaria um valor que o
        // proprio provedor devolveu.
        assert_eq!(portable("toolu_01A2b3C-d4"), "toolu_01A2b3C-d4");
        assert!(matches!(portable("call_1"), Cow::Borrowed(_)));
    }

    #[test]
    fn a_character_the_provider_refuses_is_replaced_instead_of_dropped() {
        // Descartar encurtaria dois ids diferentes ate o mesmo valor.
        assert_eq!(portable("fc_abc|def"), "fc_abc_def");
        assert_eq!(portable("a.b:c"), "a_b_c");
    }

    #[test]
    fn an_identifier_over_the_ceiling_is_shortened_to_fit() {
        let longo = "call_".to_owned() + &"x".repeat(500);

        let convertido = portable(&longo);

        assert!(
            convertido.len() <= MAX,
            "{} caracteres: {convertido}",
            convertido.len()
        );
        assert!(!convertido.is_empty());
    }

    #[test]
    fn the_same_identifier_always_becomes_the_same_thing() {
        // E o que faz o par `tool_use`/`tool_result` continuar casando sem que
        // ninguem carregue um mapa de sessao. Se isto quebrar, o provedor ve um
        // resultado de ferramenta sem origem e recusa o turno.
        let bruto = "resp_".to_owned() + &"y".repeat(600) + "|z";

        assert_eq!(portable(&bruto), portable(&bruto));
    }

    #[test]
    fn two_identifiers_that_differ_only_past_the_ceiling_do_not_collide() {
        // Cortar sem resumo faria dois `tool_use` distintos virarem o mesmo id,
        // que e uma conversa recusada por outro motivo.
        let base = "call_".to_owned() + &"x".repeat(500);
        let outro = base.clone() + "diferente";

        assert_ne!(portable(&base), portable(&outro));
    }

    #[test]
    fn two_identifiers_that_differ_only_outside_the_alphabet_do_not_collide() {
        // O resumo e do id original justamente por isto: depois da limpeza os
        // dois teriam a mesma forma.
        let um = "a|".to_owned() + &"x".repeat(80);
        let outro = "a.".to_owned() + &"x".repeat(80);

        assert_ne!(portable(&um), portable(&outro));
    }

    #[test]
    fn an_empty_identifier_becomes_something_the_provider_accepts() {
        // Vazio nao casa `^[a-zA-Z0-9_-]+$`, entao nao pode passar intacto.
        let convertido = portable("");

        assert!(!convertido.is_empty());
        assert!(acceptable(&convertido), "{convertido}");
    }

    #[test]
    fn every_conversion_produces_something_the_provider_accepts() {
        for bruto in [
            "",
            "|",
            "a b c",
            "acentuação",
            &"z".repeat(1000),
            "fc_68a1b2|call_0",
        ] {
            let convertido = portable(bruto);
            assert!(
                acceptable(&convertido),
                "{bruto:?} virou {convertido:?}, que o provedor recusa"
            );
        }
    }
}
