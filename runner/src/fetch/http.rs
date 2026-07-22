//! The real `reqwest`-based [`HttpFactFetcher`] and its resource-limit config.

use std::net::IpAddr;
use std::time::Duration;

use async_trait::async_trait;

use crate::fetch::{FactFetcher, FetchError};

/// Default HTTP request timeout for [`HttpFactFetcher`].
pub const DEFAULT_FETCH_TIMEOUT: Duration = Duration::from_secs(30);

/// Default maximum fact-content body size for [`HttpFactFetcher`] (8 MiB). A
/// body exceeding this is rejected with [`FetchError::TooLarge`] so a hostile or
/// unbounded response can't exhaust memory. Fact content is small text, so this
/// is generous.
pub const DEFAULT_MAX_BODY_BYTES: usize = 8 * 1024 * 1024;

/// The default `reqwest`-based fetcher: an HTTP(S) `GET` returning the raw
/// response body bytes.
///
/// **Scheme policy:** only `http` and `https` are accepted; any other scheme is
/// rejected up front with [`FetchError::UnsupportedScheme`] (so a fact `uri`
/// can never reach the local filesystem, `data:` blobs, etc.).
///
/// **Status policy:** non-2xx responses are errors ([`FetchError::Status`]).
///
/// **SSRF policy:** a fact `uri` is chain-controlled, so before each request the
/// host is resolved and REJECTED with [`FetchError::BlockedHost`] if it (or any
/// resolved address) is an internal/special-use IP (loopback, RFC1918, link-local
/// incl. `169.254.169.254` cloud metadata, CGNAT, ULA, …). Redirects to a literal
/// internal IP are likewise refused by a custom redirect policy.
///
/// **Timeout:** a per-request timeout (default [`DEFAULT_FETCH_TIMEOUT`]) bounds
/// each fetch. Redirects are capped at 10 hops; nothing exotic is enabled.
///
/// **Body-size cap:** the response body is capped at `max_body_bytes` (default
/// [`DEFAULT_MAX_BODY_BYTES`]) — a declared `Content-Length` over the cap is
/// rejected up front, and the body is streamed chunk-by-chunk and aborted with
/// [`FetchError::TooLarge`] the moment it would exceed the cap.
#[derive(Clone, Debug)]
pub struct HttpFactFetcher {
    client: reqwest::Client,
    max_body_bytes: usize,
    /// When `true`, the internal/special-use-IP SSRF guard is bypassed — for
    /// local dev / tests that fetch from a `127.0.0.1` mock server. Defaults to
    /// `false` (guard ON). NEVER enable in a deployed keeper.
    allow_internal_hosts: bool,
}

impl HttpFactFetcher {
    /// Build a fetcher with the [default timeout](DEFAULT_FETCH_TIMEOUT) and
    /// [default body cap](DEFAULT_MAX_BODY_BYTES).
    pub fn new() -> Result<Self, FetchError> {
        Self::with_timeout(DEFAULT_FETCH_TIMEOUT)
    }

    /// Build a fetcher with a custom request timeout (default body cap).
    pub fn with_timeout(timeout: Duration) -> Result<Self, FetchError> {
        let client = reqwest::Client::builder()
            .timeout(timeout)
            // Redirect hardening: reject any redirect whose target host is a
            // LITERAL internal/special-use IP (e.g. a 302 → http://169.254.169.254).
            // The pre-fetch `is_fetchable` check guards the initial host; this
            // closes the most common redirect-to-metadata SSRF without async DNS in
            // the (sync) redirect policy. Hostname redirects that resolve internally
            // share the indexer's residual gap (documented).
            .redirect(reqwest::redirect::Policy::custom(|attempt| {
                match attempt.url().host_str().and_then(|h| h.parse::<IpAddr>().ok()) {
                    Some(ip) if is_disallowed(ip) => attempt.error("redirect to a blocked host"),
                    _ if attempt.previous().len() > 10 => attempt.stop(),
                    _ => attempt.follow(),
                }
            }))
            .build()
            .map_err(|e| FetchError::Transport {
                uri: "<client init>".to_string(),
                message: e.to_string(),
            })?;
        Ok(Self {
            client,
            max_body_bytes: DEFAULT_MAX_BODY_BYTES,
            allow_internal_hosts: false,
        })
    }

    /// Override the maximum response body size (builder-style).
    pub fn with_max_body_bytes(mut self, max_body_bytes: usize) -> Self {
        self.max_body_bytes = max_body_bytes;
        self
    }

    /// Bypass the internal/special-use-IP SSRF guard (builder-style) — for local
    /// dev / tests fetching from a `127.0.0.1` mock server. NEVER enable in a
    /// deployed keeper: it re-opens the SSRF this guard exists to close.
    pub fn with_allow_internal_hosts(mut self, allow: bool) -> Self {
        self.allow_internal_hosts = allow;
        self
    }
}

/// The scheme of `uri` (lowercased), i.e. the text before the first `:`.
fn scheme_of(uri: &str) -> Option<String> {
    uri.split_once(':').map(|(s, _)| s.to_ascii_lowercase())
}

/// Scheme + resolved-IP SSRF guard: http/https only, and EVERY resolved address
/// must be global (reject if ANY is internal — no partial-trust of multi-homed
/// hosts). Ported from the indexer's `meta_fetch` guard so the chain-controlled
/// fact `uri` can't drive the keeper at internal/metadata endpoints.
async fn is_fetchable(uri: &str) -> bool {
    let url = match reqwest::Url::parse(uri) {
        Ok(u) => u,
        Err(_) => return false,
    };
    if !matches!(url.scheme(), "http" | "https") {
        return false;
    }
    let Some(host) = url.host_str().map(str::to_owned) else {
        return false;
    };
    let port = url.port_or_known_default().unwrap_or(443);
    let addrs: Vec<_> = match tokio::net::lookup_host((host, port)).await {
        Ok(it) => it.collect(),
        Err(_) => return false,
    };
    // Reject hosts that resolve to nothing, or to ANY internal address.
    !addrs.is_empty() && addrs.iter().all(|a| !is_disallowed(a.ip()))
}

/// Whether an IP is off-limits for the fetcher (internal / special-use ranges).
/// Built from stable `std::net` predicates since `IpAddr::is_global` is unstable.
/// Mirrors `indexer::meta_fetch::is_disallowed`.
fn is_disallowed(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_broadcast()
                || v4.is_documentation()
                || v4.is_unspecified()
                || o[0] == 0
                || (o[0] == 100 && (o[1] & 0xc0) == 64) // 100.64.0.0/10 CGNAT
        }
        IpAddr::V6(v6) => {
            v6.is_loopback()
                || v6.is_unspecified()
                || (v6.segments()[0] & 0xffc0) == 0xfe80 // link-local fe80::/10
                || (v6.segments()[0] & 0xfe00) == 0xfc00 // unique-local fc00::/7
                || v6.to_ipv4_mapped().is_some_and(|m| is_disallowed(IpAddr::V4(m)))
        }
    }
}

#[async_trait]
impl FactFetcher for HttpFactFetcher {
    async fn fetch(&self, uri: &str) -> Result<Vec<u8>, FetchError> {
        // Scheme allowlist FIRST — never hand a non-http(s) uri to reqwest.
        match scheme_of(uri).as_deref() {
            Some("http") | Some("https") => {}
            other => {
                return Err(FetchError::UnsupportedScheme {
                    uri: uri.to_string(),
                    scheme: other.unwrap_or("").to_string(),
                });
            }
        }

        // SSRF guard: resolve the host and reject if it (or any of its addresses)
        // is an internal/special-use IP, BEFORE issuing the request. Bypassable
        // ONLY via `with_allow_internal_hosts` (local dev / tests).
        if !self.allow_internal_hosts && !is_fetchable(uri).await {
            return Err(FetchError::BlockedHost {
                uri: uri.to_string(),
            });
        }

        let resp = self
            .client
            .get(uri)
            .send()
            .await
            .map_err(|e| FetchError::Transport {
                uri: uri.to_string(),
                message: e.to_string(),
            })?;

        let status = resp.status();
        if !status.is_success() {
            return Err(FetchError::Status {
                uri: uri.to_string(),
                status: status.as_u16(),
            });
        }

        // Reject an over-cap declared Content-Length up front (cheap, before
        // reading the body).
        if let Some(len) = resp.content_length() {
            if len > self.max_body_bytes as u64 {
                return Err(FetchError::TooLarge {
                    uri: uri.to_string(),
                    limit: self.max_body_bytes,
                });
            }
        }

        // Stream chunk-by-chunk so a body with no/lying Content-Length still
        // can't exceed the cap or exhaust memory.
        let mut resp = resp;
        let mut buf = Vec::new();
        while let Some(chunk) = resp.chunk().await.map_err(|e| FetchError::Transport {
            uri: uri.to_string(),
            message: e.to_string(),
        })? {
            if buf.len() + chunk.len() > self.max_body_bytes {
                return Err(FetchError::TooLarge {
                    uri: uri.to_string(),
                    limit: self.max_body_bytes,
                });
            }
            buf.extend_from_slice(&chunk);
        }
        Ok(buf)
    }
}

#[cfg(test)]
mod ssrf_tests {
    use super::{is_disallowed, is_fetchable};
    use std::net::{Ipv4Addr, Ipv6Addr};

    #[test]
    fn disallows_internal_ipv4_and_metadata() {
        for ip in [
            "127.0.0.1",
            "10.1.2.3",
            "192.168.0.5",
            "172.16.9.9",
            "169.254.169.254", // cloud metadata
            "100.64.1.1",      // CGNAT
            "0.0.0.0",
        ] {
            let v4: Ipv4Addr = ip.parse().unwrap();
            assert!(is_disallowed(v4.into()), "{ip} should be blocked");
        }
    }

    #[test]
    fn allows_global_ipv4() {
        for ip in ["1.1.1.1", "8.8.8.8", "93.184.216.34"] {
            let v4: Ipv4Addr = ip.parse().unwrap();
            assert!(!is_disallowed(v4.into()), "{ip} should be allowed");
        }
    }

    #[test]
    fn disallows_internal_ipv6() {
        for ip in ["::1", "::", "fe80::1", "fc00::1", "::ffff:127.0.0.1"] {
            let v6: Ipv6Addr = ip.parse().unwrap();
            assert!(is_disallowed(v6.into()), "{ip} should be blocked");
        }
    }

    #[tokio::test]
    async fn is_fetchable_rejects_scheme_and_literal_internal_hosts() {
        assert!(!is_fetchable("file:///etc/passwd").await);
        assert!(!is_fetchable("ftp://example.com/x").await);
        assert!(!is_fetchable("http://169.254.169.254/latest/meta-data").await);
        assert!(!is_fetchable("http://127.0.0.1:8080/x").await);
        assert!(!is_fetchable("http://10.0.0.1/x").await);
        assert!(!is_fetchable("not a url").await);
    }
}
