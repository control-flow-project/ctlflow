use crossfire_adapter_pi::provider::parse;
use crossfire_agent_core::owned_runtime::ProviderState;
use serde_json::json;

#[test]
fn provider_metadata_checks_only_the_selected_model_without_disclosing_secrets()
-> crossfire_kernel::Result<()> {
    let state = json!({"model":{"provider":"fixture","id":"selected"}});
    assert_eq!(
        parse(
            &state,
            &json!({"models":[{"provider":"fixture","id":"selected","apiKey":"private-secret"}]})
        )?,
        ProviderState::Present
    );
    assert_eq!(
        parse(
            &state,
            &json!({"models":[{"provider":"other","id":"selected"}]})
        )?,
        ProviderState::Missing
    );
    for value in [
        json!(null),
        json!({}),
        json!({"models":[null]}),
        json!({"models":[{"id":"selected","apiKey":"private-secret"}]}),
    ] {
        let result = parse(&state, &value);
        assert!(result.is_err());
        if let Err(error) = result {
            assert!(!error.message.contains("private-secret"));
        }
    }
    Ok(())
}
