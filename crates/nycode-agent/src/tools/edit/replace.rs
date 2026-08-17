//! Substituições disjuntas no mesmo conteúdo (FR-13).

/// Aplica as trocas de uma vez, da direita para a esquerda.
pub fn apply(contents: &str, pairs: &[(String, String)]) -> Result<String, String> {
    let mut spans = Vec::with_capacity(pairs.len());
    for (old, new) in pairs {
        if old.is_empty() {
            return Err("`old_string` vazio casaria em qualquer posicao".to_owned());
        }
        if old == new {
            return Err("`old_string` e `new_string` sao iguais; nada a fazer".to_owned());
        }
        let occurrences = contents.matches(old.as_str()).count();
        match occurrences {
            0 => {
                return Err("`old_string` nao encontrado; confira espacos e indentacao".to_owned());
            }
            1 => {}
            n => {
                return Err(format!(
                    "`old_string` aparece {n} vezes; inclua mais contexto para torna-lo unico"
                ));
            }
        }
        let start = contents.find(old.as_str()).ok_or_else(|| {
            "`old_string` nao encontrado; confira espacos e indentacao".to_owned()
        })?;
        spans.push((start, start + old.len(), new.as_str()));
    }

    spans.sort_by_key(|(start, _, _)| *start);
    for pair in spans.windows(2) {
        if pair[0].1 > pair[1].0 {
            return Err("as substituicoes se sobrepoem; separe-as em chamadas".to_owned());
        }
    }

    let mut out = contents.to_owned();
    for (start, end, new) in spans.into_iter().rev() {
        out.replace_range(start..end, new);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disjoint_replacements_all_land() {
        let updated = apply(
            "um dois tres",
            &[("um".into(), "UM".into()), ("tres".into(), "TRES".into())],
        )
        .unwrap();
        assert_eq!(updated, "UM dois TRES");
    }

    #[test]
    fn overlapping_replacements_are_refused() {
        let err = apply(
            "abcdef",
            &[("abc".into(), "x".into()), ("cde".into(), "y".into())],
        )
        .unwrap_err();
        assert!(err.contains("sobrepoem"), "{err}");
    }

    #[test]
    fn abutting_replacements_are_not_overlap() {
        let updated = apply(
            "abcd",
            &[("ab".into(), "X".into()), ("cd".into(), "Y".into())],
        )
        .unwrap();
        assert_eq!(updated, "XY");
    }

    #[test]
    fn a_pair_that_matches_twice_is_refused() {
        let err = apply("ab ab", &[("ab".into(), "x".into())]).unwrap_err();
        assert!(err.contains("2 vezes"), "{err}");
    }
}
