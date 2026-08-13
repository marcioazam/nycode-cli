//! O que o marcador de compactação diz.
//!
//! O marcador substitui o trecho que saiu, e por muito tempo disse apenas que
//! houve compactação. O modelo então relia os mesmos arquivos para descobrir
//! onde estava — o trabalho que a compactação acabara de economizar, gasto de
//! novo no turno seguinte. Aqui se decide o que ele carrega adiante: o resumo
//! do que foi decidido, e os caminhos do que foi lido e do que mudou.
//!
//! Separado do corte porque muda por outro motivo: [`super`] muda quando muda
//! onde a conversa é cortada, isto muda quando muda o que o modelo precisa
//! saber para continuar do outro lado.

use std::collections::BTreeSet;
use std::fmt::Write as _;

use nycode_ai::anthropic::{ContentBlock, Message};

/// Marcador inserido no lugar do que foi removido.
pub(super) const ELISION: &str = "[historico anterior compactado para caber na janela de contexto; \
     as decisoes ja tomadas continuam valendo]";

/// Quantos caminhos cabem em cada lista.
///
/// A lista existe para poupar releitura, e uma lista de mil caminhos custa mais
/// janela do que a releitura que ela evitaria.
pub(super) const MAX_LISTED: usize = 60;

/// Abertura do resumo, no marcador.
pub(super) const SUMMARY_OPEN: &str = "<resumo-do-que-saiu>";
pub(super) const SUMMARY_CLOSE: &str = "</resumo-do-que-saiu>";

/// Abertura da lista de arquivos lidos, no marcador.
pub(super) const READ_OPEN: &str = "<arquivos-lidos>";
pub(super) const READ_CLOSE: &str = "</arquivos-lidos>";
/// Abertura da lista de arquivos modificados, no marcador.
pub(super) const WRITTEN_OPEN: &str = "<arquivos-modificados>";
pub(super) const WRITTEN_CLOSE: &str = "</arquivos-modificados>";

/// Os arquivos que o trecho descartado tocou.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Touched {
    read: BTreeSet<String>,
    modified: BTreeSet<String>,
}

/// Monta o marcador que substitui o que saiu.
///
/// O marcador dizia que houve compactação e mais nada, então o modelo relia os
/// mesmos arquivos para descobrir onde estava — o trabalho que a compactação
/// acabara de economizar, gasto de novo no turno seguinte. Carregar os caminhos
/// adiante custa uma linha por arquivo e evita uma chamada de ferramenta por
/// arquivo.
pub fn build(touched: &Touched, summary: Option<&str>) -> String {
    let mut out = ELISION.to_owned();
    // O resumo vem antes das listas: é o que responde "onde eu estava", e as
    // listas respondem "no que eu mexi". Ler o segundo sem o primeiro faz o
    // modelo reabrir arquivo para descobrir por quê.
    if let Some(summary) = summary.map(str::trim).filter(|s| !s.is_empty()) {
        let _ = write!(out, "\n\n{SUMMARY_OPEN}\n{summary}\n{SUMMARY_CLOSE}");
    }
    append_list(&mut out, READ_OPEN, READ_CLOSE, &touched.read);
    append_list(&mut out, WRITTEN_OPEN, WRITTEN_CLOSE, &touched.modified);
    out
}

/// O que se pede ao modelo para resumir o trecho que sai.
///
/// Pede o estado e não a narrativa: o que a conversa descobriu, o que decidiu e
/// o que ficou por fazer. Um resumo que reconta a ordem dos turnos gasta janela
/// para dizer o que o histórico recente já diz.
pub const SUMMARY_PROMPT: &str = "Resuma o trecho de conversa acima para que outro \
     agente possa continuar de onde ele parou. Escreva no maximo dez linhas, em \
     topicos, cobrindo: o que foi descoberto sobre o codigo, que decisoes foram \
     tomadas e por que, e o que ficou por fazer. Nao reconte a ordem dos turnos e \
     nao repita conteudo de arquivo. Responda so com o resumo.";

fn append_list(out: &mut String, open: &str, close: &str, paths: &BTreeSet<String>) {
    if paths.is_empty() {
        return;
    }
    let _ = write!(out, "\n{open}\n");
    for path in paths.iter().take(MAX_LISTED) {
        let _ = writeln!(out, "{path}");
    }
    if paths.len() > MAX_LISTED {
        let _ = writeln!(out, "[e mais {}]", paths.len() - MAX_LISTED);
    }
    out.push_str(close);
}

/// Extrai do trecho descartado quais arquivos foram lidos e quais mudaram.
///
/// Cumulativo entre compactações: o marcador da compactação anterior está
/// dentro do trecho que esta descarta, e as listas dele são lidas de volta.
/// Sem isso a segunda compactação apagaria o que a primeira preservou.
pub fn touched(dropped: &[Message]) -> Touched {
    let mut touched = Touched::default();

    for message in dropped {
        for block in &message.content {
            match block {
                ContentBlock::ToolUse { name, input, .. } => {
                    let Some(path) = input.get("path").and_then(serde_json::Value::as_str) else {
                        continue;
                    };
                    match name.as_str() {
                        "read" => touched.read.insert(path.to_owned()),
                        "write" | "edit" => touched.modified.insert(path.to_owned()),
                        _ => false,
                    };
                }
                ContentBlock::Text { text } => {
                    absorb(&mut touched.read, text, READ_OPEN, READ_CLOSE);
                    absorb(&mut touched.modified, text, WRITTEN_OPEN, WRITTEN_CLOSE);
                }
                _ => {}
            }
        }
    }

    // Um arquivo que mudou não precisa aparecer também como lido: o modelo o
    // reabriria de qualquer forma antes de mexer nele de novo.
    touched.read.retain(|path| !touched.modified.contains(path));
    touched
}

/// Recolhe os caminhos de uma lista já escrita num marcador anterior.
fn absorb(into: &mut BTreeSet<String>, text: &str, open: &str, close: &str) {
    let Some(start) = text.find(open) else {
        return;
    };
    let rest = &text[start + open.len()..];
    let Some(end) = rest.find(close) else {
        return;
    };
    for line in rest[..end].lines() {
        let line = line.trim();
        // A cauda `[e mais N]` conta o que não coube; recolhê-la como caminho
        // poria um nome inventado na lista.
        if !line.is_empty() && !line.starts_with('[') {
            into.insert(line.to_owned());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_tail_that_counts_the_omitted_is_not_read_back_as_a_path() {
        // `[e mais 15]` nao e caminho; recolhe-lo poria um nome inventado na
        // lista da compactacao seguinte.
        let mut touched = Touched::default();
        absorb(
            &mut touched.read,
            "<arquivos-lidos>\na.rs\n[e mais 15]\n</arquivos-lidos>",
            READ_OPEN,
            READ_CLOSE,
        );

        assert_eq!(touched.read, BTreeSet::from(["a.rs".to_owned()]));
    }

    #[test]
    fn a_marker_without_anything_to_say_is_just_the_elision() {
        assert_eq!(build(&Touched::default(), None), ELISION);
    }
}
