use crossfire_adapter_http::server::{HeaderMap, Peer};
use crossfire_contracts::validation;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    net::IpAddr,
    sync::Mutex,
};

const WINDOW: i64 = 60_000;
const CLIENT_LIMIT: u32 = 120;
const AGGREGATE_LIMIT: u32 = 4096;
const CLIENTS: usize = 4096;

fn normalize(address: IpAddr) -> IpAddr {
    match address {
        IpAddr::V6(address) => address
            .to_ipv4_mapped()
            .map_or(IpAddr::V6(address), IpAddr::V4),
        address => address,
    }
}
pub fn address(value: &str) -> Option<IpAddr> {
    value.parse::<IpAddr>().ok().map(normalize)
}
pub fn proxies(value: &Value) -> Result<Vec<IpAddr>> {
    let values = validation::list(value, 0, 32)?;
    let mut output = Vec::with_capacity(values.len());
    for value in values {
        let parsed = value
            .as_str()
            .and_then(address)
            .filter(|value| !output.contains(value));
        output.push(parsed.ok_or_else(|| Failure::new(ErrorCode::Invalid,
            "trustedProxyAddresses must contain distinct literal IP addresses without scopes or networks"))?);
    }
    Ok(output)
}
#[derive(Default)]
struct Window {
    count: u32,
    expires_at: i64,
}
struct Windows {
    clients: BTreeMap<IpAddr, Window>,
    aggregate: Window,
    next_expiry: i64,
}
pub struct RequestBudget {
    trusted: BTreeSet<IpAddr>,
    windows: Mutex<Windows>,
}
impl RequestBudget {
    pub fn new(proxies: &[IpAddr]) -> Self {
        Self {
            trusted: proxies.iter().copied().map(normalize).collect(),
            windows: Mutex::new(Windows {
                clients: BTreeMap::new(),
                aggregate: Window::default(),
                next_expiry: i64::MAX,
            }),
        }
    }
    pub fn admit(&self, peer: Peer, headers: &HeaderMap, now: i64) -> Result<()> {
        let Peer::Tcp(peer) = peer else {
            return Err(Failure::new(
                ErrorCode::Forbidden,
                "Client address is unavailable",
            ));
        };
        let mut client = normalize(peer.ip());
        if self.trusted.contains(&client) {
            let mut values = headers.get_all("x-forwarded-for").iter();
            client = values.next().and_then(|value| value.to_str().ok()).and_then(address)
                .filter(|_| values.next().is_none()).ok_or_else(|| Failure::new(ErrorCode::Forbidden,
                    "Trusted ingress must overwrite X-Forwarded-For with one literal client IP address"))?;
        }
        let mut windows = self
            .windows
            .lock()
            .map_err(|_| Failure::new(ErrorCode::Unavailable, "Request budget ownership failed"))?;
        if now >= windows.next_expiry {
            windows.clients.retain(|_, value| value.expires_at > now);
            windows.next_expiry = windows
                .clients
                .values()
                .map(|value| value.expires_at)
                .min()
                .unwrap_or(i64::MAX);
        }
        if windows.aggregate.expires_at <= now {
            windows.aggregate = Window {
                count: 0,
                expires_at: now.saturating_add(WINDOW),
            };
        }
        let entry = windows.clients.get(&client);
        if entry.is_some_and(|value| value.count >= CLIENT_LIMIT)
            || windows.aggregate.count >= AGGREGATE_LIMIT
            || entry.is_none() && windows.clients.len() >= CLIENTS
        {
            return Err(Failure::new(ErrorCode::RateLimit, "Request rate exceeded"));
        }
        let entry = windows.clients.entry(client).or_insert(Window {
            count: 0,
            expires_at: now.saturating_add(WINDOW),
        });
        entry.count += 1;
        let expires_at = entry.expires_at;
        windows.aggregate.count += 1;
        windows.next_expiry = windows.next_expiry.min(expires_at);
        Ok(())
    }
}
