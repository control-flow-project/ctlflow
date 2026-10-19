use crossfire_adapter_codex::provider::parse;
use crossfire_agent_core::owned_runtime::ProviderState;
use serde_json::json;

#[test]
fn provider_metadata_is_read_only_bounded_and_does_not_expose_accounts()
-> crossfire_kernel::Result<()> {
    assert_eq!(
        parse(&json!({"account":{"email":"private@example.test"},"requiresOpenaiAuth":true}))?,
        ProviderState::Present
    );
    assert_eq!(
        parse(&json!({"account":null,"requiresOpenaiAuth":true}))?,
        ProviderState::Missing
    );
    assert_eq!(
        parse(&json!({"account":null,"requiresOpenaiAuth":false}))?,
        ProviderState::NotRequired
    );
    for value in [
        json!(null),
        json!([]),
        json!({}),
        json!({"account":[],"requiresOpenaiAuth":true}),
        json!({"account":"private-secret","requiresOpenaiAuth":true}),
    ] {
        let result = parse(&value);
        assert!(result.is_err());
        if let Err(error) = result {
            assert!(!error.message.contains("private-secret"));
        }
    }
    Ok(())
}
