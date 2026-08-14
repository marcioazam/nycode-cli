//! Reparo de argumento de ferramenta que chegou pela metade.
//!
//! Um `tool_use` viaja como fragmentos de JSON no stream. Quando o turno é
//! cortado — prazo estourado, gateway que parou de enviar, cancelamento — o que
//! sobra é JSON incompleto. Antes disto ele virava `Value::Null` em silêncio, e
//! a ferramenta recebia nulo sem que nada dissesse que houve truncamento.
//!
//! **O reparo é conservador de propósito, e nisto ele diverge da referência.**
//! Fechar a aspa de uma string interrompida é o reparo óbvio e é o errado: um
//! `{"path":"src/ma` viraria `{"path":"src/ma"}`, e a escrita aconteceria num
//! caminho que o modelo nunca pediu — com cara de pedido legítimo. Aqui um valor
//! que estava sendo escrito é **descartado**, não completado. O que se recupera
//! são os campos que chegaram inteiros; o que faltou fica faltando, e a
//! ferramenta recusa por argumento ausente, que é uma falha legível.

use serde_json::Value;

/// Repara o JSON parcial de uma chamada de ferramenta.
///
/// `None` quando nem o reparo mais agressivo produz JSON válido — aí não há o
/// que aproveitar, e inventar um objeto vazio esconderia a falha.
#[must_use]
pub fn repair(partial: &str) -> Option<Value> {
    if let Ok(value) = serde_json::from_str(partial) {
        return Some(value);
    }

    let scan = Scan::of(partial);
    // Em cascata, do que preserva mais para o que preserva menos: primeiro o
    // texto inteiro fechado, depois sem o último elemento começado, depois o
    // container vazio — e o mesmo subindo cada nível ainda aberto.
    for (cut, depth) in scan.candidates() {
        let mut candidate = partial[..cut].to_owned();
        for opener in scan.stack[..depth].iter().rev() {
            candidate.push(match opener {
                Container::Object => '}',
                Container::Array => ']',
            });
        }
        if let Ok(value) = serde_json::from_str(&candidate) {
            return Some(value);
        }
    }
    None
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Container {
    Object,
    Array,
}

/// O que uma passada pelo texto revela sobre onde é seguro cortar.
struct Scan {
    /// Containers ainda abertos, do mais externo ao mais interno.
    stack: Vec<Container>,
    /// Por nível, o índice logo depois do caractere que o abriu.
    after_open: Vec<usize>,
    /// Por nível, o índice da última vírgula vista nele.
    last_comma: Vec<Option<usize>>,
    /// Se o texto termina dentro de uma string.
    in_string: bool,
    /// Comprimento do texto.
    end: usize,
}

impl Scan {
    fn of(text: &str) -> Self {
        let mut scan = Self {
            stack: Vec::new(),
            after_open: Vec::new(),
            last_comma: Vec::new(),
            in_string: false,
            end: text.len(),
        };
        let mut escaped = false;

        for (at, ch) in text.char_indices() {
            if scan.in_string {
                // A barra invertida só escapa quando ela própria não foi
                // escapada; sem isto um `"a\\"` terminaria a string no lugar
                // errado e o corte cairia dentro do texto.
                if escaped {
                    escaped = false;
                } else if ch == '\\' {
                    escaped = true;
                } else if ch == '"' {
                    scan.in_string = false;
                }
                continue;
            }

            match ch {
                '"' => scan.in_string = true,
                '{' | '[' => {
                    scan.stack.push(if ch == '{' {
                        Container::Object
                    } else {
                        Container::Array
                    });
                    scan.after_open.push(at + ch.len_utf8());
                    scan.last_comma.push(None);
                }
                '}' | ']' => {
                    scan.stack.pop();
                    scan.after_open.pop();
                    scan.last_comma.pop();
                }
                ',' => {
                    if let Some(level) = scan.last_comma.last_mut() {
                        *level = Some(at);
                    }
                }
                _ => {}
            }
        }
        scan
    }

    /// Pontos de corte, do que preserva mais para o que preserva menos.
    ///
    /// Cada par é `(índice, profundidade a fechar)`. Nenhum deles cai dentro de
    /// uma string: só se registra posição vista fora de string, e é isso que
    /// impede o corte de partir um valor ao meio em vez de descartá-lo.
    fn candidates(&self) -> Vec<(usize, usize)> {
        let mut out = Vec::new();
        let depth = self.stack.len();
        if depth == 0 {
            return out;
        }

        // O texto inteiro, quando ele não termina no meio de uma string: o
        // último valor pode estar completo e só faltarem os fechamentos.
        if !self.in_string {
            out.push((self.end, depth));
        }

        for level in (0..depth).rev() {
            let closing = level + 1;
            if let Some(comma) = self.last_comma[level] {
                out.push((comma, closing));
            }
            out.push((self.after_open[level], closing));
        }
        out
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn complete_json_is_returned_untouched() {
        assert_eq!(repair(r#"{"path":"a.rs"}"#), Some(json!({"path": "a.rs"})));
    }

    #[test]
    fn a_pair_that_arrived_whole_survives_a_missing_brace() {
        // O caso comum: o stream cortou depois do valor e antes do fecho.
        assert_eq!(repair(r#"{"path":"a.rs""#), Some(json!({"path": "a.rs"})));
    }

    #[test]
    fn a_value_still_being_written_is_dropped_and_not_completed() {
        // Este e o ponto inteiro do arquivo. Fechar a aspa daria
        // `{"path":"src/ma"}` e a escrita aconteceria num caminho que o modelo
        // nunca pediu — com cara de pedido legitimo. Descartado, a ferramenta
        // recusa por argumento ausente, que e uma falha que se le.
        assert_eq!(repair(r#"{"path":"src/ma"#), Some(json!({})));
    }

    #[test]
    fn the_fields_that_arrived_whole_are_kept_when_the_last_one_is_cut() {
        assert_eq!(
            repair(r#"{"limit":10,"path":"src/ma"#),
            Some(json!({"limit": 10}))
        );
    }

    #[test]
    fn a_nested_structure_is_closed_from_the_inside_out() {
        assert_eq!(
            repair(r#"{"edits":[{"old":"a","new":"b"}"#),
            Some(json!({"edits": [{"old": "a", "new": "b"}]}))
        );
    }

    #[test]
    fn a_trailing_comma_does_not_defeat_the_repair() {
        assert_eq!(repair(r#"{"path":"a.rs","#), Some(json!({"path": "a.rs"})));
    }

    #[test]
    fn a_key_without_its_value_yet_is_dropped() {
        assert_eq!(
            repair(r#"{"path":"a.rs","content":"#),
            Some(json!({"path": "a.rs"}))
        );
    }

    #[test]
    fn an_escaped_quote_does_not_end_the_string_early() {
        // Sem tratar o escape, o corte cairia dentro do texto e o reparo
        // devolveria metade de um valor como se fosse ele inteiro.
        assert_eq!(
            repair(r#"{"cmd":"echo \"oi\"","#),
            Some(json!({"cmd": "echo \"oi\""}))
        );
    }

    #[test]
    fn an_escaped_backslash_does_not_swallow_the_closing_quote() {
        assert_eq!(repair(r#"{"path":"a\\","#), Some(json!({"path": "a\\"})));
    }

    #[test]
    fn text_that_is_not_json_at_all_is_refused_instead_of_guessed() {
        // Inventar um objeto vazio aqui esconderia um dialeto lido errado.
        assert_eq!(repair("isto nao e json"), None);
        assert_eq!(repair(""), None);
    }

    #[test]
    fn an_array_argument_is_repaired_like_an_object() {
        assert_eq!(repair("[1,2,3"), Some(json!([1, 2, 3])));
        assert_eq!(repair(r#"[1,2,"tex"#), Some(json!([1, 2])));
    }
}
