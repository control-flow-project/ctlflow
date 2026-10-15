use crossfire_agent_core::profile::Account;
use crossfire_contracts::{origin, validation as check};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, secret::Secret};
use fleetd_domain::binding::{Binding, Claim, Identity};
use serde_json::{Value, json};
use std::collections::BTreeSet;

pub fn identity(value: &Value) -> Result<Identity> {
    let value = check::object(value, &["instanceKey", "name", "agentId", "account"], &[])?;
    let account = check::object(
        &value["account"],
        &["user_id", "access_token", "device_id"],
        &[],
    )?;
    Ok(Identity {
        instance_key: check::name(&value["instanceKey"])?.to_owned(),
        name: check::name(&value["name"])?.to_owned(),
        agent_id: check::identifier(&value["agentId"])?.to_owned(),
        account: Account {
            user_id: check::matrix_user_id(&account["user_id"])?.to_owned(),
            access_token: Secret::new(check::text(&account["access_token"], 1, 8192)?.to_owned()),
            device_id: check::text(&account["device_id"], 1, 255)?.to_owned(),
        },
    })
}
pub fn parse(value: &Value) -> Result<Binding> {
    let value = check::object(
        value,
        &[
            "server",
            "owner",
            "fleetKey",
            "fleetId",
            "controllerCredential",
            "request",
            "identities",
        ],
        &[],
    )?;
    let server = origin::parse(check::text(&value["server"], 1, 4096)?)?
        .origin()
        .ascii_serialization();
    let fleet_id = if value["fleetId"].is_null() {
        None
    } else {
        Some(check::identifier(&value["fleetId"])?.to_owned())
    };
    let credential = if value["controllerCredential"].is_null() {
        None
    } else {
        Some(Secret::new(
            check::text(&value["controllerCredential"], 1, 200)?.to_owned(),
        ))
    };
    let request = if value["request"].is_null() {
        None
    } else {
        let request = check::object(
            &value["request"],
            &["enrollmentId", "claimSecret", "digest"],
            &[],
        )?;
        Some(Claim {
            enrollment_id: check::identifier(&request["enrollmentId"])?.to_owned(),
            claim_secret: crossfire_contracts::enrollment::claim(
                &json!({"claimSecret":request["claimSecret"]}),
            )?,
            digest: digest(&request["digest"])?,
        })
    };
    let identities = check::list(&value["identities"], 0, 100)?
        .iter()
        .map(identity)
        .collect::<Result<Vec<_>>>()?;
    if identities
        .iter()
        .map(|identity| &identity.instance_key)
        .collect::<BTreeSet<_>>()
        .len()
        != identities.len()
        || identities
            .iter()
            .map(|identity| &identity.agent_id)
            .collect::<BTreeSet<_>>()
            .len()
            != identities.len()
    {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Duplicate enrolled fleet identities",
        ));
    }
    Ok(Binding {
        server,
        owner: check::matrix_user_id(&value["owner"])?.to_owned(),
        fleet_key: check::name(&value["fleetKey"])?.to_owned(),
        fleet_id,
        controller_credential: credential,
        request,
        identities,
    })
}
fn digest(value: &Value) -> Result<String> {
    let digest = check::text(value, 64, 64)?;
    if !digest
        .bytes()
        .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Invalid enrollment digest",
        ));
    }
    Ok(digest.to_owned())
}
pub fn value(binding: &Binding) -> Value {
    json!({"server":binding.server,"owner":binding.owner,"fleetKey":binding.fleet_key,"fleetId":binding.fleet_id,"controllerCredential":binding.controller_credential.as_ref().map(Secret::expose),"request":binding.request.as_ref().map(|request|json!({"enrollmentId":request.enrollment_id,"claimSecret":request.claim_secret.expose(),"digest":request.digest})),"identities":binding.identities.iter().map(|identity|json!({"instanceKey":identity.instance_key,"name":identity.name,"agentId":identity.agent_id,"account":{"user_id":identity.account.user_id,"access_token":identity.account.access_token.expose(),"device_id":identity.account.device_id}})).collect::<Vec<_>>()})
}
