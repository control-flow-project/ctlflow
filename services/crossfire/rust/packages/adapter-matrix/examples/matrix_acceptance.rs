use crossfire_adapter_http::NativeHttp;
use crossfire_adapter_matrix::account::{Authority, Configuration};
use crossfire_contracts::origin::segment;
use crossfire_domain::{
    matrix::{AccessMode, Membership, RoomAccess, RoomAdmission, RoomPower},
    port::MatrixIdentity,
};
use crossfire_kernel::secret::Secret;
use reqwest::Method;
use serde::Deserialize;
use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;

const API: &str = "/_matrix/client/v3";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Input {
    origin: String,
    server_name: String,
    jwt_secret: String,
    registration_secret: String,
    owner: String,
    owner_token: String,
    outsider: String,
    agent: String,
}

struct Checks {
    count: usize,
}
impl Checks {
    fn require(&mut self, condition: bool, label: &str) -> Result<(), Box<dyn std::error::Error>> {
        if !condition {
            return Err(format!("Native Matrix acceptance failed: {label}").into());
        }
        self.count += 1;
        Ok(())
    }
}

fn field(value: &Value, name: &str) -> Result<String, Box<dyn std::error::Error>> {
    value
        .get(name)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| "Missing native response field".into())
}

#[tokio::main(worker_threads = 2)]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let input: Input = crossfire_test_support::input::private_configuration(16_384)?;
    let matrix = Authority::new(Configuration {
        origin: input.origin.clone(),
        server_name: input.server_name,
        jwt_secret: Secret::new(input.jwt_secret),
        registration_secret: Secret::new(input.registration_secret),
        service_matrix_id: input.owner.clone(),
    })?;
    let cancellation = CancellationToken::new();
    let http = NativeHttp::new(&input.origin, cancellation.clone())?;
    let token = Secret::new(input.owner_token);
    let mut checks = Checks { count: 0 };
    checks.require(
        matrix.identify(&token).await? == input.owner,
        "the native owner session identifies its actual user",
    )?;
    checks.require(
        !matrix.exists(&input.agent).await?,
        "a missing native agent is not silently adopted",
    )?;
    let password = Secret::new("native-acceptance-private-password-at-least-32-bytes".to_owned());
    let account = matrix
        .provision(&input.agent, &password, "RUST_NATIVE_ACCEPTANCE")
        .await?;
    checks.require(
        account.user_id == input.agent,
        "provisioning preserves the selected identity",
    )?;
    checks.require(
        matrix.identify(&account.access_token).await? == input.agent,
        "the provisioned native token identifies its agent",
    )?;
    checks.require(
        matrix.exists(&input.agent).await?,
        "native existence is observed after registration",
    )?;
    let repeated = matrix
        .provision(&input.agent, &password, "RUST_NATIVE_ACCEPTANCE")
        .await?;
    checks.require(
        repeated.user_id == input.agent,
        "repeat provisioning uses the same account",
    )?;
    checks.require(
        matrix
            .provision(
                &input.agent,
                &Secret::new("incorrect-password-with-32-characters".to_owned()),
                "RUST_NATIVE_ACCEPTANCE",
            )
            .await
            .is_err(),
        "an existing account cannot be adopted with another password",
    )?;
    matrix
        .set_display_name(&input.agent, "Specialist (Native Owner)")
        .await?;
    checks.require(
        matrix.profile_name(&input.agent).await?.as_deref() == Some("Specialist (Native Owner)"),
        "native display names remain meaningful",
    )?;
    let room = matrix
        .owner_conversation(&input.owner, &input.agent, None, None)
        .await?;
    matrix
        .verify_owner_conversation(&input.owner, &input.agent, &room)
        .await?;
    checks.require(
        matrix.joined(&input.agent).await?.contains(&room),
        "the agent joined its private owner conversation",
    )?;
    checks.require(
        matrix
            .owner_conversation(&input.owner, &input.agent, None, None)
            .await?
            == room,
        "repeat owner conversation creation preserves the native room",
    )?;
    checks.require(
        matrix
            .owner_conversation(&input.outsider, &input.agent, Some(&room), None)
            .await
            .is_err(),
        "another owner cannot adopt the private room",
    )?;
    let event = matrix
        .send_notice(
            &input.agent,
            &room,
            "rust-notice-one",
            "Private owner notice",
            &input.owner,
        )
        .await?;
    checks.require(
        matrix
            .send_notice(
                &input.agent,
                &room,
                "rust-notice-one",
                "Private owner notice",
                &input.owner,
            )
            .await?
            == event,
        "native transaction identity prevents duplicate notice publication",
    )?;
    let notice = matrix.event(&input.owner, &room, &event).await?;
    checks.require(
        notice.sender_matrix_id == input.agent
            && notice.body.as_deref() == Some("Private owner notice"),
        "native event content and authorship survive",
    )?;
    checks.require(
        notice.mentions == [input.owner.clone()] && notice.control,
        "owner notices carry actual mention metadata and the exact control marker",
    )?;
    let quote = http.ok(Some(&token), Method::PUT, &format!("{API}/rooms/{}/send/m.room.message/rust-quoted-name", segment(&room)),
        Some(&json!({"msgtype":"m.text","body":"The quoted name @native-specialist is not a control."}))).await?;
    let quote = matrix
        .event(&input.agent, &room, &field(&quote, "event_id")?)
        .await?;
    checks.require(
        quote.mentions.is_empty() && !quote.control,
        "quoted text alone never becomes a directed control",
    )?;
    let group = http
        .ok(
            Some(&token),
            Method::POST,
            &format!("{API}/createRoom"),
            Some(&json!({"preset":"private_chat","name":"Native grant acceptance"})),
        )
        .await?;
    let group = field(&group, "room_id")?;
    matrix.invite(&input.owner, &group, &input.agent).await?;
    let invitation = matrix
        .invitation(&input.agent, &group)
        .await?
        .ok_or("Missing native invitation")?;
    checks.require(
        invitation.sender_matrix_id == input.owner && invitation.room_id == group,
        "invitation authority is observed natively",
    )?;
    let access = matrix
        .set_room_access(
            &input.owner,
            &input.agent,
            &group,
            RoomAccess {
                mode: AccessMode::Reply,
                power_level: 0,
            },
            Some(&RoomAdmission::Invitation {
                event_id: invitation.event_id,
                sender_matrix_id: input.owner.clone(),
            }),
        )
        .await?;
    checks.require(
        access.membership == Membership::Join && access.power == RoomPower::Level(0),
        "the exact invitation joins the agent at its requested authority",
    )?;
    checks.require(
        matrix.joined(&input.agent).await?.contains(&group),
        "native joined-room state reflects the grant",
    )?;
    checks.require(
        matrix.room(&input.agent, &group).await?.room_id == group,
        "room facts refer to the immutable native room ID",
    )?;
    matrix.leave(&input.agent, &group).await?;
    checks.require(
        !matrix.joined(&input.agent).await?.contains(&group),
        "leave removes native membership",
    )?;
    let direct = http
        .ok(
            Some(&token),
            Method::GET,
            &format!("{API}/user/{}/account_data/m.direct", segment(&input.owner)),
            None,
        )
        .await?;
    checks.require(
        direct
            .get(&input.agent)
            .and_then(Value::as_array)
            .is_some_and(|rooms| rooms.iter().any(|value| value.as_str() == Some(&room))),
        "owner account data records the private conversation",
    )?;
    matrix.invite(&input.owner, &room, &input.outsider).await?;
    checks.require(
        matrix
            .verify_owner_conversation(&input.owner, &input.agent, &room)
            .await
            .is_err(),
        "a third-party invitation invalidates owner-only privacy",
    )?;
    matrix.close();
    checks.require(
        matrix.as_user(&input.owner).await.is_err(),
        "closed authority cannot reuse a cached native token",
    )?;
    cancellation.cancel();
    println!(
        "{{\"status\":\"passed\",\"assertions\":{},\"provider\":\"pinned native Conduit\"}}",
        checks.count
    );
    Ok(())
}
