use crate::validation as check;
use crossfire_domain::messaging::{Account, BackendConfiguration, BackendDescription};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, secret::Secret};
use serde_json::{Map, Value, json};

pub fn backend_data(value: &Value) -> Result<Map<String, Value>> {
    value
        .as_object()
        .filter(|value| crossfire_domain::backend_data::valid(value))
        .cloned()
        .ok_or_else(|| Failure::new(ErrorCode::Invalid, "Expected a bounded backend object"))
}
pub fn native_access(value: &Value) -> Result<Option<Map<String, Value>>> {
    if value.is_null() {
        Ok(None)
    } else {
        backend_data(value).map(Some)
    }
}
pub fn configuration(value: &Value) -> Result<BackendConfiguration> {
    let fields = check::object(value, &["type", "parameters"], &[])?;
    Ok(BackendConfiguration {
        backend_type: check::name(&fields["type"])?.to_owned(),
        parameters: backend_data(&fields["parameters"])?,
    })
}
pub fn configuration_value(value: &BackendConfiguration) -> Value {
    json!({"type":value.backend_type,"parameters":value.parameters})
}
pub fn account(value: &Value) -> Result<Account> {
    let fields = check::object(value, &["userId", "accessToken", "native"], &[])?;
    Ok(Account {
        user_id: check::backend_user_id(&fields["userId"])?.to_owned(),
        access_token: Secret::new(check::text(&fields["accessToken"], 1, 8192)?.to_owned()),
        native: backend_data(&fields["native"])?,
    })
}
pub fn account_value(value: &Account) -> Value {
    json!({"userId":value.user_id,"accessToken":value.access_token.expose(),"native":value.native})
}
pub fn description_value(value: &BackendDescription) -> Value {
    json!({"type":value.backend_type,"label":value.label,"chatUrl":value.chat_url,"signupUrl":value.signup_url,"signupInstructions":value.signup_instructions,"configuration":configuration_value(&value.configuration)})
}
