//! Quem serve o modelo, e como o pedido chega até ele.
//!
//! Os três módulos daqui respondem à mesma pergunta em etapas: [`settings`]
//! resolve de onde falar — endpoint, dialeto, modelo — entre flag, arquivo do
//! usuário e padrão; [`catalog`] descobre o que esse endpoint de fato serve,
//! com preço e janela, porque o FR-6 proíbe tabela fixa no binário; e
//! [`tuning`] monta a amostragem que modula o pedido e conta ao usuário o que
//! o dialeto escolhido não fará.
//!
//! Estavam soltos ao lado do arranque da sessão, que muda por outro motivo: um
//! muda quando muda o vocabulário do provedor, o outro quando muda o que se
//! mede ou se diz ao abrir.

pub mod catalog;
pub mod settings;
pub mod tuning;
