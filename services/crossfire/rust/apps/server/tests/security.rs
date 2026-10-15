use crossfire_adapter_http::server::HeaderMap;
use crossfire_kernel::secret::Secret;
use crossfire_server::{configuration, security};
use serde_json::json;

fn configuration_value() -> serde_json::Value {
    json!({ "instance":"contracts", "serverName":"architecture.localhost", "publicOrigin":"http://127.0.0.1:8001", "contentOrigin":"http://localhost:8002", "matrixOrigin":"http://127.0.0.1:8003", "administrator":"@admin:architecture.localhost", "jwtSecret":"a".repeat(43), "registrationSecret":"b".repeat(43) })
}

#[test]
fn origins_and_resource_configuration_are_validated_at_the_boundary()
-> Result<(), Box<dyn std::error::Error>> {
    let base = configuration_value();
    let config = configuration::parse(&base)?;
    assert_eq!(config.logging_retention_days, 7);
    assert_eq!(config.publication_budget.uploads, 8);
    assert_eq!(
        config.service_matrix_id(),
        "@crossfire-contracts:architecture.localhost"
    );
    for origin in [
        "http://127.0.0.1:8001",
        "http://127.0.0.1:8003",
        "https://example.com/prefix",
        "https://user@example.com",
        "http://public.example.com",
        "https://example.com/?query=yes",
    ] {
        let mut value = base.clone();
        value["contentOrigin"] = json!(origin);
        assert!(
            configuration::parse(&value).is_err(),
            "reject unsafe content origin"
        );
    }
    let mut value = base.clone();
    value["publicOrigin"] = json!("https://gaap.example");
    value["contentOrigin"] = json!("https://gaap.example:8443");
    assert!(configuration::parse(&value).is_err());
    value["contentOrigin"] = json!("https://content.gaap.example");
    assert!(configuration::parse(&value).is_ok());
    value["loggingRetentionDays"] = json!(0);
    assert!(configuration::parse(&value).is_err());
    value["loggingRetentionDays"] = json!(1);
    value["publicationBudget"] = json!({ "instanceBytes":100, "agentBytes":101, "instanceCount":4, "agentCount":1, "uploads":1 });
    assert!(configuration::parse(&value).is_err());
    value["publicationBudget"]["agentBytes"] = json!(100);
    assert!(configuration::parse(&value).is_ok());
    value["compatibility"] = json!(true);
    assert!(configuration::parse(&value).is_err());
    Ok(())
}

#[test]
fn navigation_origins_cookies_and_bearers_are_unambiguous() -> Result<(), Box<dyn std::error::Error>>
{
    let origin = url::Url::parse("https://app.example.com")?;
    let mut headers = HeaderMap::new();
    headers.insert("host", "app.example.com".parse()?);
    assert!(security::host(&headers, &origin).is_ok());
    assert!(security::same_origin(&headers, &origin, true).is_err());
    headers.insert("origin", "https://app.example.com".parse()?);
    assert!(security::same_origin(&headers, &origin, true).is_ok());
    headers.append("origin", "https://app.example.com".parse()?);
    assert!(security::same_origin(&headers, &origin, false).is_err());
    headers.remove("origin");
    headers.insert(
        "cookie",
        "__Host-crossfire=first; extra=safe; __Host-crossfire=second".parse()?,
    );
    assert!(security::cookie(&headers, security::SESSION_COOKIE).is_err());
    headers.insert("cookie", "other=safe; __Host-crossfire=private".parse()?);
    assert_eq!(
        security::cookie(&headers, security::SESSION_COOKIE)?,
        Some(Secret::new("private".to_owned()))
    );
    headers.insert("authorization", "Bearer token".parse()?);
    assert_eq!(security::bearer(&headers)?, Secret::new("token".to_owned()));
    headers.append("authorization", "Bearer other".parse()?);
    assert!(security::bearer(&headers).is_err());
    let cookie = security::session_cookie(
        Some(&Secret::new("private".to_owned())),
        security::SESSION_COOKIE,
        28800,
    )?;
    assert_eq!(
        cookie.to_str()?,
        "__Host-crossfire=private; Path=/; Max-Age=28800; HttpOnly; SameSite=Strict; Secure"
    );
    let rate = security::RateLimit::default();
    let address = "127.0.0.1".parse()?;
    for _request in 0..120 {
        rate.admit(address, 1000)?;
    }
    assert!(rate.admit(address, 1000).is_err());
    assert!(rate.admit(address, 61000).is_ok());
    Ok(())
}
