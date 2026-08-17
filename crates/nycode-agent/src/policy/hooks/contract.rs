//! O que atravessa o cano entre o harness e um hook.
//!
//! Separado de [`super`] porque muda por outro motivo: aquele muda quando muda
//! como um hook sobe, o que o contém e o que acontece quando ele trava; isto
//! muda quando muda o JSON que o script lê e o que ele pode responder — a parte
//! que quebra scripts de terceiro quando alguém mexe nela sem perceber.

use std::path::Path;

use serde::{Deserialize, Serialize};

/// Teto de bytes da saída de ferramenta que chega ao hook.
///
/// O mesmo número que o teto do stdout de um hook, por simetria deliberada: ele
/// não lê mais do que consegue responder. Não é o mesmo símbolo porque os dois
/// lados são independentes — um limita o que entra, o outro o que sai.
///
/// A saída de uma ferramenta não tem tamanho conhecido: a de `bash` derrama o
/// excedente para arquivo temporário, e a de um servidor MCP vem de terceiro.
/// Passar qualquer uma inteira devolveria ao chamador o orçamento de memória
/// que os outros tetos existem para fechar (NFR-2), uma vez por chamada de
/// ferramenta
/// ([ADR-0022](../../../../../docs/architecture/decisions/0022-o-post-tool-use-recebe-a-saida-cortada-e-o-tamanho-dela.md)).
pub(super) const MAX_TOOL_OUTPUT: usize = 64 * 1024;

/// Momento do ciclo de vida em que um hook roda.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Event {
    SessionStart,
    /// O único que pode vetar.
    PreToolUse,
    /// Roda depois de a ferramenta ter rodado, e por isso não veta nada.
    ///
    /// Um veto aqui não teria o que impedir: o arquivo já foi escrito, o
    /// comando já rodou. Quem precisa recusar recusa antes.
    PostToolUse,
    SessionEnd,
}

impl Event {
    /// Nome do arquivo que responde por este evento.
    #[must_use]
    pub const fn filename(self) -> &'static str {
        match self {
            Self::SessionStart => "session-start",
            Self::PreToolUse => "pre-tool-use",
            Self::PostToolUse => "post-tool-use",
            Self::SessionEnd => "session-end",
        }
    }
}

/// O que o hook recebe em stdin.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Payload {
    pub event: Event,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input: Option<serde_json::Value>,
    /// Saída da ferramenta, em `post-tool-use`. Pode estar cortada.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    /// Quantos bytes a ferramenta produziu ao todo, em `post-tool-use`.
    ///
    /// Maior que o comprimento de `output` significa que o hook está lendo um
    /// pedaço. É o campo que torna o corte visível em vez de silencioso.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_total: Option<u64>,
    /// Se a ferramenta marcou o resultado como erro, em `post-tool-use`.
    ///
    /// A distinção entre um resultado marcado como erro e um texto que descreve
    /// um erro é a que faz o modelo reagir diferente; achatá-la no caminho até
    /// o hook deixaria um hook de auditoria adivinhando pelo texto.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<bool>,
    pub cwd: String,
}

impl Payload {
    /// O que um hook de ciclo de vida recebe.
    ///
    /// Sem ferramenta, sem argumento e sem resultado: `session-start` acontece
    /// antes de existir chamada, e `session-end` depois de a última ter
    /// passado. Os campos ausentes não são serializados, então o contrato JSON
    /// que chega ao script é exatamente o que se aplica ao momento.
    #[must_use]
    pub fn for_session(event: Event, cwd: &Path) -> Self {
        Self {
            event,
            tool: None,
            input: None,
            output: None,
            output_total: None,
            error: None,
            cwd: cwd.display().to_string(),
        }
    }

    /// O que um hook de `pre-tool-use` recebe.
    ///
    /// Ferramenta e argumentos, e nada de resultado: a chamada ainda não
    /// aconteceu, e é justamente por isso que este é o evento que pode vetar.
    #[must_use]
    pub fn for_call(tool: &str, input: &serde_json::Value, cwd: &Path) -> Self {
        Self {
            event: Event::PreToolUse,
            tool: Some(tool.to_owned()),
            input: Some(input.clone()),
            output: None,
            output_total: None,
            error: None,
            cwd: cwd.display().to_string(),
        }
    }

    /// O que um hook de `post-tool-use` recebe.
    ///
    /// A saída chega **cortada em [`MAX_TOOL_OUTPUT`] bytes e acompanhada do
    /// tamanho de que veio**. As duas coisas juntas são o contrato: sem o
    /// corte, o payload tem o tamanho da saída de uma ferramenta, que ninguém
    /// limita; sem o tamanho, o hook decide sobre um pedaço acreditando ter
    /// lido tudo, que é a degradação silenciosa que o NFR-4 proíbe.
    ///
    /// O corte é pela frente, e não pela cauda como em `bash`. O que chega aqui
    /// já é o resultado renderizado, e é no começo dele que está o que
    /// identifica a chamada: o aviso de confinamento e o `codigo de saida N`
    /// são as primeiras linhas do que um comando devolve.
    #[must_use]
    pub fn for_result(
        tool: &str,
        input: &serde_json::Value,
        output: &crate::tool::ToolOutput,
        cwd: &Path,
    ) -> Self {
        let capped = crate::capped::Capped::head_of(&output.content, MAX_TOOL_OUTPUT);
        Self {
            event: Event::PostToolUse,
            tool: Some(tool.to_owned()),
            input: Some(input.clone()),
            output: Some(capped.text().to_owned()),
            output_total: Some(capped.total),
            error: Some(output.is_error),
            cwd: cwd.display().to_string(),
        }
    }
}

/// O que o hook responde em stdout.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct Response {
    /// `"deny"` veta a chamada. Qualquer outra coisa a deixa passar.
    ///
    /// Só `pre-tool-use` é consultado sobre isso. Em `post-tool-use` a recusa
    /// chega tarde demais para ser obedecida, e é registrada em voz alta em vez
    /// de ignorada em silêncio.
    #[serde(default)]
    pub decision: Option<String>,
    /// A razão que chega ao modelo.
    #[serde(default)]
    pub reason: Option<String>,
    /// Encerra o turno depois desta rodada, se todas as chamadas pedirem (FR-17).
    #[serde(default)]
    pub terminate: bool,
}

impl Response {
    #[must_use]
    pub fn is_denial(&self) -> bool {
        self.decision.as_deref() == Some("deny")
    }
}
