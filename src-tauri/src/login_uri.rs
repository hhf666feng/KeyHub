use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};
use url::Url;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LoginUri {
    pub uri: String,
    /// origin, domain, host, exact, prefix, regex, never.
    pub match_type: String,
}

pub fn validate(uris: &[LoginUri]) -> Result<()> {
    ensure!(
        uris.len() <= 128,
        "At most 128 login websites are supported"
    );
    for uri in uris {
        ensure!(uri.uri.len() <= 8192, "Login website is too long");
        ensure!(
            matches!(
                uri.match_type.as_str(),
                "origin" | "domain" | "host" | "exact" | "prefix" | "regex" | "never"
            ),
            "Invalid website match rule"
        );
        if uri.match_type == "regex" {
            regex::RegexBuilder::new(&uri.uri)
                .size_limit(1_000_000)
                .build()
                .map_err(|_| {
                    anyhow::anyhow!(
                        "Unsupported website regular expression; use an exact website instead"
                    )
                })?;
        } else if uri.match_type != "never" {
            crate::passkey::origin(&uri.uri)?;
        }
    }
    Ok(())
}

pub fn matches(rule: &LoginUri, website: &str) -> bool {
    let Ok(target) = crate::passkey::origin(website) else {
        return false;
    };
    if rule.match_type == "never" {
        return false;
    }
    if rule.match_type == "regex" {
        // A regex is an explicit advanced rule. Never send credentials over remote HTTP.
        if target.scheme() != "https" && target.host_str() != Some("localhost") {
            return false;
        }
        return regex::RegexBuilder::new(&rule.uri)
            .size_limit(1_000_000)
            .build()
            .is_ok_and(|regex| regex.is_match(target.as_str()));
    }
    let Ok(saved) = crate::passkey::origin(&rule.uri) else {
        return false;
    };
    // All rules retain the saved transport security. HTTPS never matches HTTP.
    if saved.scheme() != target.scheme() {
        return false;
    }
    match rule.match_type.as_str() {
        "origin" => saved.origin() == target.origin(),
        "host" => {
            saved.host_str() == target.host_str()
                && saved.port_or_known_default() == target.port_or_known_default()
        }
        "domain" => {
            fn domain(url: &Url) -> &str {
                let host = url.host_str().unwrap_or_default();
                if matches!(url.host(), Some(url::Host::Ipv4(_) | url::Host::Ipv6(_))) {
                    return host;
                }
                psl::domain_str(host).unwrap_or(host)
            }
            domain(&saved) == domain(&target)
                && saved.port_or_known_default() == target.port_or_known_default()
        }
        "exact" => saved.as_str() == target.as_str(),
        // Require the same origin as well: a prefix such as example.com must not match example.com.evil.
        "prefix" => {
            saved.origin() == target.origin() && target.as_str().starts_with(saved.as_str())
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn matching_respects_sites_ports_protocols_and_paths() {
        let rule = |uri: &str, kind: &str| LoginUri {
            uri: uri.into(),
            match_type: kind.into(),
        };
        let domain = rule("https://login.example.co.uk", "domain");
        assert!(matches(&domain, "https://accounts.example.co.uk/login"));
        for url in [
            "https://example.co.uk.evil.com",
            "https://other.co.uk",
            "http://login.example.co.uk",
            "https://login.example.co.uk:8443",
        ] {
            assert!(!matches(&domain, url));
        }
        assert!(matches(
            &rule("https://example.com/login", "exact"),
            "https://example.com/login"
        ));
        assert!(!matches(
            &rule("https://example.com/login", "exact"),
            "https://example.com/other"
        ));
        assert!(!matches(
            &rule("https://example.com", "prefix"),
            "https://example.com.evil.test"
        ));
        assert!(!matches(
            &rule("https://example.com", "never"),
            "https://example.com"
        ));
        assert!(!matches(
            &rule("^https://example\\.com/", "regex"),
            "https://example.com.evil.test"
        ));
        assert!(!matches(
            &rule("https://127.0.0.1", "domain"),
            "https://10.0.0.1"
        ));
        assert!(!matches(&rule("https://[::1]", "domain"), "https://[::2]"));
    }
}
