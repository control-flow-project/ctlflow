use crossfire_adapter_http::server::{HeaderMap, Peer};
use crossfire_kernel::failure::ErrorCode;
use crossfire_server::{
    configuration,
    http::public_request_budget::{self as budget, RequestBudget},
};
use serde_json::json;
use std::net::{IpAddr, SocketAddr};

fn peer(address: &str) -> Result<Peer, Box<dyn std::error::Error>> {
    Ok(Peer::Tcp(SocketAddr::new(address.parse()?, 12345)))
}
fn forwarded(address: &str) -> Result<HeaderMap, Box<dyn std::error::Error>> {
    let mut headers = HeaderMap::new();
    headers.insert("x-forwarded-for", address.parse()?);
    Ok(headers)
}

#[test]
fn configuration_accepts_only_distinct_literal_immediate_peers()
-> Result<(), Box<dyn std::error::Error>> {
    assert_eq!(
        budget::address("::ffff:192.0.2.1"),
        Some("192.0.2.1".parse::<IpAddr>()?)
    );
    assert_eq!(
        budget::address("2001:DB8::1"),
        budget::address("2001:db8:0:0:0:0:0:1")
    );
    for value in [
        "127.1",
        "0177.0.0.1",
        "2130706433",
        "127.0.0.1:80",
        "::1%lo",
        " 127.0.0.1",
        "unknown",
        "192.0.2.1, 192.0.2.2",
    ] {
        assert_eq!(budget::address(value), None, "{value}");
    }
    for value in [
        json!(null),
        json!("127.0.0.1"),
        json!(["0.0.0.0/0"]),
        json!(["localhost"]),
        json!(["::ffff:127.0.0.1", "127.0.0.1"]),
        json!(vec!["::1"; 33]),
    ] {
        assert!(budget::proxies(&value).is_err());
    }
    let value = json!({"instance":"test", "serverName":"example.localhost", "publicOrigin":"http://127.0.0.1:8080",
        "contentOrigin":"http://localhost:8082", "matrixOrigin":"http://127.0.0.1:6167", "administrator":"@admin:example.localhost",
        "jwtSecret":"a".repeat(43), "registrationSecret":"b".repeat(43), "trustedProxyAddresses":["::ffff:127.0.0.1"]});
    assert_eq!(
        configuration::parse(&value)?.trusted_proxy_addresses,
        vec!["127.0.0.1".parse::<IpAddr>()?]
    );
    Ok(())
}

#[test]
fn only_an_explicit_peer_may_supply_exactly_one_client_ip() -> Result<(), Box<dyn std::error::Error>>
{
    let rate = RequestBudget::new(&budget::proxies(&json!(["::ffff:127.0.0.1"]))?);
    assert_eq!(
        rate.admit(peer("127.0.0.1")?, &HeaderMap::new(), 0)
            .err()
            .map(|error| error.code),
        Some(ErrorCode::Forbidden)
    );
    for value in ["", "198.51.100.1, 203.0.113.1", "127.1"] {
        assert_eq!(
            rate.admit(peer("127.0.0.1")?, &forwarded(value)?, 0)
                .err()
                .map(|error| error.code),
            Some(ErrorCode::Forbidden)
        );
    }
    let mut duplicate = forwarded("198.51.100.1")?;
    duplicate.append("x-forwarded-for", "198.51.100.1".parse()?);
    assert_eq!(
        rate.admit(peer("127.0.0.1")?, &duplicate, 0)
            .err()
            .map(|error| error.code),
        Some(ErrorCode::Forbidden)
    );
    rate.admit(peer("127.0.0.1")?, &forwarded("198.51.100.1")?, 0)?;
    assert_eq!(
        rate.admit(Peer::Unix(0), &HeaderMap::new(), 0)
            .err()
            .map(|error| error.code),
        Some(ErrorCode::Forbidden)
    );
    Ok(())
}

#[test]
fn limits_roll_over_exactly_and_untrusted_headers_do_not_select_buckets()
-> Result<(), Box<dyn std::error::Error>> {
    let rate = RequestBudget::new(&[]);
    for index in 0..120 {
        rate.admit(
            peer("192.0.2.1")?,
            &forwarded(&format!("198.51.100.{index}"))?,
            0,
        )?;
    }
    for now in [0, 59_999] {
        assert_eq!(
            rate.admit(peer("::ffff:192.0.2.1")?, &HeaderMap::new(), now)
                .err()
                .map(|error| error.code),
            Some(ErrorCode::RateLimit)
        );
    }
    rate.admit(peer("192.0.2.2")?, &HeaderMap::new(), 59_999)?;
    rate.admit(peer("192.0.2.1")?, &HeaderMap::new(), 60_000)?;
    Ok(())
}

#[test]
fn client_rejections_do_not_consume_independent_aggregate_capacity()
-> Result<(), Box<dyn std::error::Error>> {
    let rate = RequestBudget::new(&["127.0.0.1".parse()?]);
    let origin = peer("127.0.0.1")?;
    for _ in 0..120 {
        rate.admit(origin, &forwarded("192.0.2.1")?, 0)?;
    }
    for _ in 0..4096 {
        assert!(rate.admit(origin, &forwarded("192.0.2.1")?, 0).is_err());
    }
    for index in 0..(4096 - 120) {
        rate.admit(
            origin,
            &forwarded(&format!("2001:db8::{:x}", index + 1))?,
            0,
        )?;
    }
    assert_eq!(
        rate.admit(origin, &forwarded("203.0.113.1")?, 0)
            .err()
            .map(|error| error.code),
        Some(ErrorCode::RateLimit)
    );
    rate.admit(origin, &forwarded("203.0.113.1")?, 60_000)?;
    Ok(())
}
