//! Reconstrução da conversa a partir dos registros de uma sessão.
//!
//! O arquivo é uma árvore append-only ([ADR-0006]): cada registro aponta para o
//! pai, e ramificar é dois registros passarem a compartilhar o mesmo. Ler a
//! sessão é escolher um caminho nessa árvore — lógica pura sobre os registros
//! já carregados, que fica aqui longe do I/O para ser exercitada sozinha.
//!
//! [ADR-0006]: ../../../../docs/architecture/decisions/0006-a-sessao-e-uma-arvore-no-mesmo-arquivo.md

use nycode_ai::anthropic::Message;

use super::Record;

/// A conversa ativa: o caminho que leva ao último registro gravado.
///
/// Devolver o arquivo inteiro mandaria ramos abandonados ao modelo como se
/// fossem parte da conversa.
pub(super) fn conversation(records: &[Record]) -> Vec<Message> {
    let Some(tip) = records.last().and_then(|record| record.id.as_deref()) else {
        // Sem `id` em lugar nenhum é arquivo v1: lista, na ordem gravada.
        return records
            .iter()
            .map(|record| record.message.clone())
            .collect();
    };

    // Um arquivo v1 que recebeu registro novo fica misto, e a árvore não
    // alcança a parte de cima: o índice é por `id`, e registro v1 não tem
    // nenhum. Sem este prefixo, retomar uma sessão antiga e responder apaga a
    // conversa da leitura — ela continua no disco, e é isso que torna a perda
    // invisível para quem está conversando.
    let mut messages: Vec<Message> = records
        .iter()
        .take_while(|record| record.id.is_none())
        .map(|record| record.message.clone())
        .collect();
    messages.extend(chain_to(records, tip));
    messages
}

/// As mensagens da raiz até um registro, seguindo os pais.
///
/// Recebe os registros já lidos em vez de reler: quem chama sempre acabou de
/// carregar o arquivo, e ler de novo dobra o custo de retomar a sessão.
pub(super) fn chain_to(records: &[Record], record_id: &str) -> Vec<Message> {
    let by_id: std::collections::HashMap<&str, &Record> = records
        .iter()
        .filter_map(|r| r.id.as_deref().map(|rid| (rid, r)))
        .collect();

    let mut chain = Vec::new();
    let mut cursor = Some(record_id);
    // O teto existe porque um `parent_id` apontando para trás em ciclo —
    // arquivo editado à mão, por exemplo — penduraria a leitura.
    while let Some(current) = cursor.take() {
        let Some(record) = by_id.get(current) else {
            break;
        };
        chain.push(record.message.clone());
        if chain.len() > records.len() {
            break;
        }
        cursor = record.parent_id.as_deref();
    }

    chain.reverse();
    chain
}
