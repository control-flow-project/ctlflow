mod roster;
use crossfire_agent_core::{coordination::Coordination, local_state::LocalState, profile::Account};
use crossfire_contracts::{call::Call, operations::OperationId, validation as check};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity, secret::Secret};
use fleetd_domain::{
    binding::{Binding, Claim, Identity},
    controller_model::{ApprovalLink, ControllerIdentity},
    model::Configuration,
};
use fleetd_storage::binding;
use serde_json::{Value, json};
use std::{collections::BTreeSet, sync::Arc, time::Duration};
use tokio_util::sync::CancellationToken;

pub async fn prepare<C: Coordination, S: LocalState>(
    configuration: &Configuration,
    storage: &S,
    controller: &ControllerIdentity,
    enroll: bool,
    clients: impl Fn(Option<Secret>) -> Result<C>,
    approval: Arc<dyn Fn(ApprovalLink) -> Result<()> + Send + Sync>,
    stop: CancellationToken,
) -> Result<()> {
    let mut saved = binding::load(storage, configuration)?;
    if saved.server != configuration.roster.coordination.server
        || saved.owner != configuration.roster.coordination.owner
        || saved.fleet_key != configuration.roster.fleet
    {
        return Err(Failure::new(
            ErrorCode::Conflict,
            "Fleet connection differs from its saved identity; it cannot be silently replaced",
        ));
    }
    if !enroll
        && saved.fleet_id.is_some()
        && saved.controller_credential.is_some()
        && configuration.roster.instances.iter().all(|instance| {
            saved.identities.iter().any(|identity| {
                identity.instance_key == instance.key && identity.name == instance.name
            })
        })
    {
        return roster::verify(
            configuration,
            &saved,
            &clients(saved.controller_credential.clone())?,
            stop,
        )
        .await;
    }
    let input = roster::request(configuration, &saved, controller)?;
    let digest = roster::digest(configuration, &saved, controller)?;
    let public = clients(None)?;
    if let Some(claim) = saved
        .request
        .as_ref()
        .filter(|claim| claim.digest == digest)
    {
        let previous = exchange(claim, &public, stop.clone()).await?;
        if matches!(previous["status"].as_str(), Some("expired" | "rejected")) {
            saved.request = None;
            binding::save(storage, &saved)?;
        }
    }
    if saved
        .request
        .as_ref()
        .is_none_or(|claim| claim.digest != digest)
    {
        let mut call = Call::new(OperationId::Preflight);
        call.body = Some(input.clone());
        let response = public.call(&call, stop.clone()).await?;
        if response["available"] != true {
            return Err(Failure::new(
                ErrorCode::NameCollision,
                "One or more requested agent names already exist for this owner; choose unique names and deploy the complete roster again",
            ));
        }
        saved.request = Some(Claim {
            enrollment_id: identity::id(),
            claim_secret: identity::secret()?,
            digest,
        });
        binding::save(storage, &saved)?;
    }
    let claim = saved.request.clone().ok_or_else(|| {
        Failure::new(
            ErrorCode::Invalid,
            "Enrollment claim was not durably prepared",
        )
    })?;
    let mut input = input;
    input["enrollmentId"] = json!(claim.enrollment_id);
    input["claimSecret"] = json!(claim.claim_secret.expose());
    let mut call = Call::new(OperationId::IntroduceEnrollment);
    call.body = Some(input);
    let introduced = public.call(&call, stop.clone()).await?;
    let mut waiting = false;
    loop {
        if stop.is_cancelled() {
            return Err(Failure::new(
                ErrorCode::Unavailable,
                "Enrollment was cancelled without approving or replacing its saved claim",
            ));
        }
        let response = exchange(&claim, &public, stop.clone()).await?;
        match response["status"].as_str() {
            Some("expired" | "rejected") => {
                saved.request = None;
                binding::save(storage, &saved)?;
                return Err(Failure::new(
                    ErrorCode::Forbidden,
                    "Fleet enrollment was rejected or expired; start again to request a new owner review",
                ));
            }
            Some("pending") => {
                if !waiting {
                    let url = check::text(&introduced["approvalUrl"], 1, 2048)?;
                    if url
                        != format!(
                            "{}/manage/enrollments/{}",
                            saved.server, claim.enrollment_id
                        )
                    {
                        return Err(Failure::new(
                            ErrorCode::Invalid,
                            "Enrollment approval URL differs from its exact requested authority",
                        ));
                    }
                    let code = check::text(
                        &introduced["enrollment"]["enrollment"]["verificationCode"],
                        12,
                        12,
                    )?;
                    approval(ApprovalLink {
                        url: url.to_owned(),
                        code: code.to_owned(),
                    })?;
                    waiting = true;
                }
            }
            Some("ready") => {
                accept(configuration, storage, &mut saved, &response)?;
                let credential = saved.controller_credential.clone().ok_or_else(|| {
                    Failure::new(
                        ErrorCode::Forbidden,
                        "This fleet controller has not been authorized",
                    )
                })?;
                let client = clients(Some(credential))?;
                let fleet = saved.fleet_id.as_deref().ok_or_else(|| {
                    Failure::new(ErrorCode::Invalid, "Approved fleet identity is missing")
                })?;
                let mut call = Call::new(OperationId::Fleet);
                call.parameters
                    .insert("fleetId".to_owned(), fleet.to_owned());
                let current = client.call(&call, stop.clone()).await?;
                let mut call = Call::new(OperationId::ChangeFleet);
                call.parameters
                    .insert("fleetId".to_owned(), fleet.to_owned());
                call.body = Some(
                    json!({"expectedRevision":check::integer(&current["revision"],0,check::SAFE_INTEGER)?,"label":check::text(&current["label"],1,100)?,"controller":fleetd_contracts::wire::controller(controller)}),
                );
                client.call(&call, stop).await?;
                return Ok(());
            }
            _ => {
                return Err(Failure::new(
                    ErrorCode::Invalid,
                    "Unknown enrollment exchange state",
                ));
            }
        }
        tokio::select! { biased; _ = stop.cancelled() => return Err(Failure::new(ErrorCode::Unavailable,"Enrollment cancelled while awaiting explicit owner review")), _ = tokio::time::sleep(Duration::from_secs(1)) => {} }
    }
}
async fn exchange(
    claim: &Claim,
    client: &impl Coordination,
    stop: CancellationToken,
) -> Result<Value> {
    let mut call = Call::new(OperationId::ExchangeEnrollment);
    call.parameters
        .insert("enrollmentId".to_owned(), claim.enrollment_id.clone());
    call.body = Some(json!({"claimSecret":claim.claim_secret.expose()}));
    client.call(&call, stop).await
}
fn accept(
    configuration: &Configuration,
    storage: &impl LocalState,
    saved: &mut Binding,
    response: &Value,
) -> Result<()> {
    if check::matrix_user_id(&response["ownerMatrixId"])? != saved.owner {
        return Err(Failure::new(
            ErrorCode::Conflict,
            "Enrollment owner differs from its requested authority",
        ));
    }
    let fleet = check::identifier(&response["fleet"]["fleetId"])?.to_owned();
    if saved
        .fleet_id
        .as_ref()
        .is_some_and(|existing| existing != &fleet)
    {
        return Err(Failure::new(
            ErrorCode::Conflict,
            "An approved fleet identity cannot be silently replaced",
        ));
    }
    let credential = if response["fleet"]["controllerCredential"].is_null() {
        saved.controller_credential.clone()
    } else {
        Some(Secret::new(
            check::text(&response["fleet"]["controllerCredential"], 1, 8192)?.to_owned(),
        ))
    }
    .ok_or_else(|| {
        Failure::new(
            ErrorCode::Forbidden,
            "This fleet controller has not been authorized",
        )
    })?;
    let instances = check::list(
        &response["instances"],
        configuration.roster.instances.len(),
        configuration.roster.instances.len(),
    )?;
    let mut selected = Vec::new();
    let mut keys = BTreeSet::new();
    let mut agents = BTreeSet::new();
    let mut users = BTreeSet::new();
    for identity in instances {
        let key = check::name(&identity["instanceKey"])?;
        let name = check::name(&identity["name"])?;
        let agent_id = check::identifier(&identity["agentId"])?;
        let account = Account {
            user_id: check::matrix_user_id(&identity["account"]["matrixUserId"])?.to_owned(),
            access_token: Secret::new(
                check::text(&identity["account"]["accessToken"], 1, 8192)?.to_owned(),
            ),
            device_id: check::text(&identity["account"]["deviceId"], 1, 255)?.to_owned(),
        };
        if !keys.insert(key)
            || !agents.insert(agent_id)
            || !users.insert(account.user_id.clone())
            || !configuration
                .roster
                .instances
                .iter()
                .any(|instance| instance.key == key && instance.name == name)
        {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Unexpected, duplicate or incomplete approved enrollment identity",
            ));
        }
        if let Some(existing) = saved
            .identities
            .iter()
            .find(|identity| identity.instance_key == key)
        {
            if existing.agent_id != agent_id || existing.account.user_id != account.user_id {
                return Err(Failure::new(
                    ErrorCode::Conflict,
                    "An enrolled agent identity cannot be replaced",
                ));
            }
        } else {
            binding::initialize(storage, agent_id, None)?;
        }
        selected.push(Identity {
            instance_key: key.to_owned(),
            name: name.to_owned(),
            agent_id: agent_id.to_owned(),
            account,
        });
    }
    saved.identities.retain(|identity| {
        !selected
            .iter()
            .any(|current| current.instance_key == identity.instance_key)
    });
    saved.identities.extend(selected);
    saved.fleet_id = Some(fleet);
    saved.controller_credential = Some(credential);
    saved.request = None;
    binding::save(storage, saved)
}
