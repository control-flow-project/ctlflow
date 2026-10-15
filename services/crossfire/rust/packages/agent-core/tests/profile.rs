use crossfire_agent_core::{
    coordination::{self, Coordination},
    profile,
};
use crossfire_contracts::call::Call;
use crossfire_kernel::{Result, failure::ErrorCode};
use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;

fn fixture() -> Value {
    json!({"id":"00000000-0000-4000-8000-000000000000","workspace":"/workspace/owned","account":{"user_id":"@agent:local","access_token":"private-test-token","device_id":"NATIVE"},"settings":{"instance":"test","homeserver":"https://app.example","server_name":"local","owner":"@owner:local","max_upload_bytes":16777216}})
}
#[test]
fn canonical_profiles_are_exact_private_and_preserve_native_settings()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let input = fixture();
    let profile = profile::parse(&input)?;
    assert_eq!(profile::value(&profile)?, input);
    assert!(!format!("{profile:?}").contains("private-test-token"));
    for (name, value) in [
        ("id", json!("legacy")),
        ("workspace", json!("relative")),
        ("settings", json!({})),
        ("account", json!({})),
    ] {
        let mut invalid = input.clone();
        invalid[name] = value;
        assert!(profile::parse(&invalid).is_err());
    }
    let mut invalid = input.clone();
    invalid["settings"]["homeserver"] = json!("http://foreign.example");
    assert!(profile::parse(&invalid).is_err());
    invalid = input;
    invalid["legacy"] = json!(true);
    assert!(profile::parse(&invalid).is_err());
    Ok(())
}
struct PolicyFixture(Value);
impl Coordination for PolicyFixture {
    fn origin(&self) -> &str {
        "https://app.example"
    }
    async fn call(&self, _request: &Call, _stop: CancellationToken) -> Result<Value> {
        Ok(self.0.clone())
    }
}
#[tokio::test]
async fn effective_policy_cannot_be_retargeted_to_another_identity_or_owner()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let profile = profile::parse(&fixture())?;
    let source = json!({"agentId":profile.id,"matrixUserId":profile.account.user_id,"ownerMatrixId":profile.settings.owner,"maxMessageBytes":65536,"fleetIdleTimeoutSeconds":1800,"status":"active","ownerStatus":"active","ownerConversation":null,"roomGrants":[{"roomId":"!room:local","accessMode":"reply","powerLevel":null,"muted":false}],"wakeMode":"selected","senderMatrixIds":[profile.settings.owner]});
    let policy = coordination::policy(
        &PolicyFixture(source.clone()),
        &profile,
        CancellationToken::new(),
    )
    .await?;
    assert!(policy.accepts("!room:local", "@owner:local"));
    assert!(policy.can_reply("!room:local"));
    let mut changed = source.clone();
    changed["ownerMatrixId"] = json!("@different:local");
    assert_eq!(
        coordination::policy(&PolicyFixture(changed), &profile, CancellationToken::new())
            .await
            .err()
            .map(|error| error.code),
        Some(ErrorCode::Forbidden)
    );
    let mut changed = source;
    changed["status"] = json!("suspended");
    changed["senderMatrixIds"] = json!([]);
    let denied =
        coordination::policy(&PolicyFixture(changed), &profile, CancellationToken::new()).await?;
    assert!(!denied.accepts("!room:local", "@owner:local"));
    Ok(())
}
