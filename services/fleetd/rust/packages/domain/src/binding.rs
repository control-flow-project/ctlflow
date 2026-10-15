use crossfire_agent_core::profile::Account;
use crossfire_kernel::secret::Secret;

#[derive(Clone, Debug)]
pub struct Identity {
    pub instance_key: String,
    pub name: String,
    pub agent_id: String,
    pub account: Account,
}
#[derive(Clone, Debug)]
pub struct Claim {
    pub enrollment_id: String,
    pub claim_secret: Secret,
    pub digest: String,
}
#[derive(Clone, Debug)]
pub struct Binding {
    pub server: String,
    pub owner: String,
    pub fleet_key: String,
    pub fleet_id: Option<String>,
    pub controller_credential: Option<Secret>,
    pub request: Option<Claim>,
    pub identities: Vec<Identity>,
}
