//! Catálogo de modelos do endpoint, com cache em disco.
//!
//! O `GET /v1/models` é autoritativo sobre o que aquele gateway serve, mas
//! consultá-lo a cada execução colocaria uma ida à rede no caminho de startup
//! que o NFR-1 mede. O cache resolve isso; a validade curta impede que um
//! catálogo velho esconda um modelo novo.
//!
//! A validação de `--model` só acontece contra um catálogo que foi de fato
//! obtido. Recusar um modelo com base num cache vencido ou num gateway fora do
//! ar transformaria uma indisponibilidade em erro de uso.

use std::path::{Path, PathBuf};

use nycode_ai::catalog::Model;
use serde::{Deserialize, Serialize};

/// Por quanto tempo um catálogo em disco continua valendo.
///
/// Curto o bastante para que um modelo novo apareça no mesmo dia, longo o
/// bastante para que o uso normal não pague rede.
const FRESH_FOR: std::time::Duration = std::time::Duration::from_hours(6);

/// De onde veio o catálogo em mãos.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Source {
    /// Buscado do endpoint agora.
    Fetched,
    /// Lido do cache em disco.
    Cached,
    /// Não foi possível obter; a razão acompanha.
    Unavailable(String),
}

/// O catálogo e a procedência dele.
#[derive(Debug, Clone)]
pub struct Catalog {
    pub models: Vec<Model>,
    pub source: Source,
}

impl Catalog {
    /// Se o catálogo é autoritativo o bastante para recusar um modelo.
    #[must_use]
    pub fn is_authoritative(&self) -> bool {
        self.source == Source::Fetched && !self.models.is_empty()
    }

    #[must_use]
    pub fn has(&self, model: &str) -> bool {
        self.models.iter().any(|m| m.id == model)
    }

    /// Ids disponíveis, para dizer ao usuário o que existe.
    #[must_use]
    pub fn ids(&self) -> Vec<&str> {
        self.models.iter().map(|m| m.id.as_str()).collect()
    }
}

/// Conteúdo do arquivo de cache.
#[derive(Debug, Serialize, Deserialize)]
struct Cached {
    /// Milissegundos desde a época.
    fetched_at: u64,
    /// A qual endpoint este catálogo pertence.
    ///
    /// Sem isto, trocar de gateway serviria o catálogo do anterior.
    base_url: String,
    models: Vec<Model>,
}

/// Caminho do cache dentro do workspace.
#[must_use]
pub fn cache_path(root: &Path) -> PathBuf {
    root.join(".nycode/catalog.json")
}

/// Lê o cache, se existir e ainda valer para este endpoint.
#[must_use]
pub fn read_cache(path: &Path, base_url: &str, now_millis: u64) -> Option<Vec<Model>> {
    let contents = std::fs::read_to_string(path).ok()?;
    let cached: Cached = serde_json::from_str(&contents).ok()?;

    if cached.base_url != base_url {
        return None;
    }
    let age = now_millis.saturating_sub(cached.fetched_at);
    if age > u64::try_from(FRESH_FOR.as_millis()).unwrap_or(u64::MAX) {
        return None;
    }
    Some(cached.models)
}

/// Grava o cache, silenciando falhas de escrita.
///
/// Não poder cachear é uma perda de desempenho, não de correção: derrubar a
/// sessão por causa de um diretório somente-leitura seria desproporcional.
pub fn write_cache(path: &Path, base_url: &str, models: &[Model], now_millis: u64) {
    let payload = Cached {
        fetched_at: now_millis,
        base_url: base_url.to_owned(),
        models: models.to_vec(),
    };
    let Ok(json) = serde_json::to_string(&payload) else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Err(err) = std::fs::write(path, json) {
        tracing::debug!(path = %path.display(), %err, "catalogo nao pode ser cacheado");
    }
}

/// Milissegundos desde a época.
#[must_use]
pub fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

/// Resolve o catálogo: cache fresco, senão endpoint, senão indisponível.
pub async fn resolve(client: &nycode_ai::Client, root: &Path) -> Catalog {
    let path = cache_path(root);
    let base_url = client.config().base_url.clone();
    let now = now_millis();

    if let Some(models) = read_cache(&path, &base_url, now) {
        return Catalog {
            models,
            source: Source::Cached,
        };
    }

    match nycode_ai::catalog::fetch(client.http(), client.config()).await {
        Ok(models) => {
            write_cache(&path, &base_url, &models, now);
            Catalog {
                models,
                source: Source::Fetched,
            }
        }
        Err(err) => Catalog {
            models: Vec::new(),
            source: Source::Unavailable(err.to_string()),
        },
    }
}

/// Verifica o modelo pedido contra o catálogo.
///
/// Devolve a mensagem de erro quando o catálogo é autoritativo e não conhece o
/// modelo — quase sempre um erro de digitação, e dizer isso na hora é melhor
/// que deixar o gateway recusar três camadas adiante.
pub fn check(catalog: &Catalog, model: &str) -> Result<(), String> {
    if !catalog.is_authoritative() || catalog.has(model) {
        return Ok(());
    }
    Err(format!(
        "o endpoint nao serve o modelo `{model}`; disponiveis: {}",
        catalog.ids().join(", ")
    ))
}

/// Aviso a mostrar quando o catálogo não pôde ser obtido.
///
/// Seguir com o modelo padrão sem dizer nada esconderia do usuário que a
/// validação não aconteceu, que é a degradação silenciosa que o NFR-4 proíbe.
#[must_use]
pub fn warning(catalog: &Catalog) -> Option<String> {
    match &catalog.source {
        Source::Unavailable(reason) => Some(format!(
            "nycode: catalogo de modelos indisponivel ({reason}); seguindo sem validar o modelo"
        )),
        Source::Fetched | Source::Cached => None,
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::panic)]
mod tests {
    use super::*;

    fn model(id: &str) -> Model {
        Model {
            id: id.to_owned(),
            display_name: id.to_owned(),
            context_window: Some(200_000),
            max_output_tokens: Some(8192),
            price: None,
            vision: None,
        }
    }

    fn catalog(source: Source, ids: &[&str]) -> Catalog {
        Catalog {
            models: ids.iter().map(|id| model(id)).collect(),
            source,
        }
    }

    #[test]
    fn a_cache_written_now_reads_back() {
        let dir = tempfile::tempdir().unwrap();
        let path = cache_path(dir.path());
        let models = vec![model("nylla-sonnet-4.5")];

        write_cache(&path, "http://gw/v1", &models, 1_000);
        assert_eq!(read_cache(&path, "http://gw/v1", 1_000), Some(models));
    }

    #[test]
    fn a_cache_from_another_endpoint_is_not_served() {
        // Trocar de gateway e receber o catalogo do anterior faria o usuario
        // escolher um modelo que o endpoint atual nao tem.
        let dir = tempfile::tempdir().unwrap();
        let path = cache_path(dir.path());
        write_cache(&path, "http://antigo/v1", &[model("a")], 1_000);

        assert_eq!(read_cache(&path, "http://novo/v1", 1_000), None);
    }

    #[test]
    fn a_stale_cache_is_not_served() {
        let dir = tempfile::tempdir().unwrap();
        let path = cache_path(dir.path());
        write_cache(&path, "http://gw/v1", &[model("a")], 0);

        let just_expired = u64::try_from(FRESH_FOR.as_millis()).unwrap() + 1;
        assert_eq!(read_cache(&path, "http://gw/v1", just_expired), None);
        // Um milissegundo antes do vencimento ainda vale.
        assert!(read_cache(&path, "http://gw/v1", just_expired - 2).is_some());
    }

    #[test]
    fn a_missing_or_corrupt_cache_is_simply_absent() {
        let dir = tempfile::tempdir().unwrap();
        let path = cache_path(dir.path());
        assert_eq!(read_cache(&path, "http://gw/v1", 0), None);

        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "{isto nao e json").unwrap();
        assert_eq!(read_cache(&path, "http://gw/v1", 0), None);
    }

    #[test]
    fn a_clock_that_went_backwards_does_not_expire_the_cache() {
        // `saturating_sub` evita que um relogio ajustado para tras produza uma
        // idade absurda e invalide um cache recem-escrito.
        let dir = tempfile::tempdir().unwrap();
        let path = cache_path(dir.path());
        write_cache(&path, "http://gw/v1", &[model("a")], 10_000);

        assert!(read_cache(&path, "http://gw/v1", 5_000).is_some());
    }

    #[test]
    fn an_unwritable_cache_directory_does_not_break_anything() {
        // Perder o cache custa desempenho, nao correcao.
        let path = Path::new("/proc/nao-da-para-escrever/catalog.json");
        write_cache(path, "http://gw/v1", &[model("a")], 0);
        assert_eq!(read_cache(path, "http://gw/v1", 0), None);
    }

    #[test]
    fn a_fetched_catalog_refuses_a_model_it_does_not_serve() {
        // Quase sempre erro de digitacao; dizer na hora e melhor que deixar o
        // gateway recusar tres camadas adiante.
        let catalog = catalog(Source::Fetched, &["nylla-sonnet-4.5", "nylla-opus-4"]);

        assert_eq!(check(&catalog, "nylla-sonnet-4.5"), Ok(()));
        let err = check(&catalog, "nylla-sonet-4.5").unwrap_err();
        assert!(err.contains("nylla-sonet-4.5"), "{err}");
        assert!(
            err.contains("nylla-opus-4"),
            "precisa listar o que existe: {err}"
        );
    }

    #[test]
    fn a_cached_catalog_does_not_refuse_anything() {
        // Um cache pode estar velho; recusar com base nele transformaria a
        // idade do arquivo em erro de uso.
        let catalog = catalog(Source::Cached, &["a"]);
        assert_eq!(check(&catalog, "b"), Ok(()));
    }

    #[test]
    fn an_unavailable_catalog_warns_and_refuses_nothing() {
        // Seguir em silencio esconderia que a validacao nao aconteceu.
        let catalog = Catalog {
            models: Vec::new(),
            source: Source::Unavailable("connection refused".to_owned()),
        };

        assert_eq!(check(&catalog, "qualquer"), Ok(()));
        let warning = warning(&catalog).expect("precisa avisar");
        assert!(warning.contains("connection refused"), "{warning}");
    }

    #[test]
    fn a_catalog_that_was_obtained_does_not_warn() {
        assert!(warning(&catalog(Source::Fetched, &["a"])).is_none());
        assert!(warning(&catalog(Source::Cached, &["a"])).is_none());
    }

    #[test]
    fn an_empty_fetched_catalog_is_not_treated_as_authoritative() {
        // Um endpoint que responde com lista vazia nao sabe o que serve;
        // recusar todo modelo com base nisso tornaria a sessao inutilizavel.
        let catalog = catalog(Source::Fetched, &[]);
        assert!(!catalog.is_authoritative());
        assert_eq!(check(&catalog, "qualquer"), Ok(()));
    }

    #[test]
    fn the_cache_lives_inside_the_workspace_state_directory() {
        let path = cache_path(Path::new("/w"));
        assert_eq!(path, Path::new("/w/.nycode/catalog.json"));
    }

    #[test]
    fn the_clock_reports_a_plausible_epoch() {
        // 2026 em milissegundos; um zero aqui invalidaria todo cache.
        assert!(now_millis() > 1_700_000_000_000);
    }
}
