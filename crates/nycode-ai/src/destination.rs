//! Se um destino de rede pode receber a credencial.
//!
//! Uma URL chega de três lugares que o usuário não necessariamente conferiu —
//! `--base-url`, uma variável de ambiente, um `.mcp.json` do repositório clonado
//! — e o binário anexa a credencial a ela. Texto claro para fora da máquina põe
//! essa credencial na rede, e a regra aqui é a única coisa entre as duas.

use crate::error::{Error, Result};

/// Recusa um destino que levaria a credencial em texto claro pela rede.
///
/// `http://` só vale para loopback. O gateway padrão é local, e exigir TLS ali
/// obrigaria cada usuário a emitir certificado para falar consigo mesmo; para
/// qualquer outro host o cálculo se inverte, porque quem estiver no caminho lê
/// a credencial no cabeçalho.
///
/// # Errors
///
/// Se a URL não tem esquema `http(s)`, se o host está ausente, ou se é `http://`
/// para um host que não é loopback.
pub fn refuse_plaintext_outside_loopback(url: &str) -> Result<()> {
    let scheme = if url.starts_with("https://") {
        Scheme::Tls
    } else if url.starts_with("http://") {
        Scheme::Plaintext
    } else {
        return Err(Error::Config(format!(
            "destino precisa de esquema http(s): {url}"
        )));
    };

    let Some(host) = host_of(url) else {
        return Err(Error::Config(format!("destino sem host: {url}")));
    };

    if scheme == Scheme::Plaintext && !is_loopback(host) {
        return Err(Error::Config(format!(
            "destino em texto claro fora de loopback: {url} — \
             use https:// para falar com {host}, ou aponte para a máquina local"
        )));
    }

    Ok(())
}

#[derive(PartialEq, Eq)]
enum Scheme {
    Plaintext,
    Tls,
}

/// O host de uma URL, sem porta, sem userinfo e sem os colchetes de `IPv6`.
///
/// Não é um parser de URL: é o suficiente para decidir se o destino é a própria
/// máquina. O que ele precisa acertar são as formas que escondem o host de uma
/// leitura ingênua — `user:senha@host` e `[::1]:8080`.
fn host_of(url: &str) -> Option<&str> {
    let authority = url.split_once("://")?.1.split('/').next()?;
    // `user:senha@host`: o host é o que vem depois do último `@`.
    let authority = authority.rsplit('@').next()?;

    let host = if let Some(bracketed) = authority.strip_prefix('[') {
        bracketed.split(']').next()?
    } else {
        authority.split(':').next()?
    };

    (!host.is_empty()).then_some(host)
}

/// Se o host é a própria máquina.
///
/// Cobre a faixa `127.0.0.0/8` inteira, e não só `127.0.0.1`, porque
/// `127.0.0.53` — o resolvedor do systemd — e `127.0.1.1` são igualmente locais.
fn is_loopback(host: &str) -> bool {
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }
    if host == "::1" || host == "::ffff:127.0.0.1" {
        return true;
    }
    host.parse::<std::net::Ipv4Addr>()
        .is_ok_and(|addr| addr.is_loopback())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plaintext_to_the_local_machine_is_allowed() {
        // O gateway padrão é local: exigir TLS ali obrigaria cada usuário a
        // emitir certificado para falar consigo mesmo.
        for url in [
            "http://127.0.0.1:8080/v1",
            "http://localhost:8080/v1",
            "http://LOCALHOST:8080/v1",
            "http://[::1]:8080/v1",
            "http://127.0.0.53/v1",
            "http://127.0.1.1:9000",
        ] {
            refuse_plaintext_outside_loopback(url).unwrap_or_else(|err| {
                panic!("{url} devia passar: {err}");
            });
        }
    }

    #[test]
    fn plaintext_to_another_host_is_refused_before_the_credential_leaves() {
        // Quem estiver no caminho lê a credencial no cabeçalho, e a URL veio de
        // um lugar que o usuário não necessariamente conferiu.
        for url in [
            "http://api.exemplo.com/v1",
            "http://10.0.0.5:8080/v1",
            "http://192.168.1.10/v1",
            "http://[2001:db8::1]/v1",
            "http://1.2.3.4",
        ] {
            let err = refuse_plaintext_outside_loopback(url)
                .expect_err(&format!("{url} devia ser recusado"));
            assert!(
                format!("{err}").contains("texto claro fora de loopback"),
                "{err}"
            );
        }
    }

    #[test]
    fn tls_is_accepted_wherever_it_points() {
        for url in ["https://api.exemplo.com/v1", "https://127.0.0.1:8443/v1"] {
            refuse_plaintext_outside_loopback(url).unwrap();
        }
    }

    #[test]
    fn a_host_disguised_by_userinfo_does_not_pass_as_loopback() {
        // `http://127.0.0.1@evil.com/` fala com `evil.com`. Ler o começo do
        // authority daria loopback, e a credencial sairia da máquina.
        let err = refuse_plaintext_outside_loopback("http://127.0.0.1@evil.com/v1")
            .expect_err("o host real é evil.com");
        assert!(format!("{err}").contains("evil.com"), "{err}");
    }

    #[test]
    fn a_destination_without_a_scheme_is_refused() {
        for url in ["api.exemplo.com/v1", "ftp://exemplo.com", ""] {
            let err = refuse_plaintext_outside_loopback(url).expect_err(url);
            assert!(format!("{err}").contains("esquema http(s)"), "{err}");
        }
    }

    #[test]
    fn a_destination_without_a_host_is_refused() {
        for url in ["http:///v1", "https://", "http://@/v1"] {
            let err = refuse_plaintext_outside_loopback(url).expect_err(url);
            assert!(format!("{err}").contains("sem host"), "{err}");
        }
    }

    #[test]
    fn the_ipv4_mapped_loopback_is_recognized() {
        refuse_plaintext_outside_loopback("http://[::ffff:127.0.0.1]:8080/v1").unwrap();
    }
}
