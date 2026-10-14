use crate::identity::{Actor, Application, Member, MemberView, Page, PrincipalRole};
use crate::identity::{Agent, AgentBinding, MemberSession, Principal};
use crate::permission::Permission;
use crate::policy::InstancePolicy;
use crossfire_kernel::Result;
use crossfire_kernel::secret::Secret;

pub trait AuthorizationRepository {
    fn principal(&mut self, id: &str) -> Result<Option<Principal>>;
    fn principal_by_matrix_id(&mut self, matrix_id: &str) -> Result<Option<Principal>>;
    fn agent(&mut self, id: &str) -> Result<Option<Agent>>;
    fn agent_binding(&mut self, id: &str) -> Result<Option<AgentBinding>>;
    fn session(&mut self, secret_hash: &str) -> Result<Option<MemberSession>>;
    fn permissions(&mut self, id: &str) -> Result<Vec<Permission>>;
}

pub trait UnitOfWork: Sized {
    fn transaction<T>(&mut self, operation: impl FnOnce(&mut Self) -> Result<T>) -> Result<T>;
}

pub trait RepositoryAccess {
    type Repository;
    fn with<T>(&self, operation: impl FnOnce(&mut Self::Repository) -> Result<T>) -> Result<T>;
}

pub trait DiscoveryRepository {
    fn active_principals(&mut self) -> Result<Vec<crate::identity::ActiveIdentity>>;
    fn selected_principals(
        &mut self,
        ids: &[String],
    ) -> Result<Vec<crate::identity::PrincipalSummary>>;
}

pub struct Audit {
    pub request_id: String,
    pub actor: AuditActor,
    pub target_kind: String,
    pub target_id: String,
    pub action: String,
    pub message: String,
    pub owner_id: Option<String>,
    pub room_id: Option<String>,
    pub membership_generation: Option<String>,
    pub authorizer_id: Option<String>,
    pub added_by_id: Option<String>,
    pub permission_code: Option<String>,
    pub created_at: i64,
}

pub enum AuditActor {
    Principal(Actor),
    Controller { credential_id: String },
    System,
    Anonymous,
}

impl Audit {
    pub fn new(
        actor: &Actor,
        request_id: &str,
        target_kind: &str,
        target_id: &str,
        action: &str,
        owner_id: Option<&str>,
        now: i64,
    ) -> Self {
        Self {
            actor: AuditActor::Principal(actor.clone()),
            request_id: request_id.to_owned(),
            target_kind: target_kind.to_owned(),
            target_id: target_id.to_owned(),
            action: action.to_owned(),
            message: String::new(),
            owner_id: owner_id.map(str::to_owned),
            room_id: None,
            membership_generation: None,
            authorizer_id: None,
            added_by_id: None,
            permission_code: None,
            created_at: now,
        }
    }
}

pub trait CoreRepository: AuthorizationRepository + UnitOfWork {
    fn insert_principal(&mut self, value: &Principal) -> Result<()>;
    fn save_principal(&mut self, value: &Principal) -> Result<()>;
    fn insert_application(&mut self, value: &Application) -> Result<()>;
    fn save_application(&mut self, value: &Application) -> Result<()>;
    fn insert_role(&mut self, value: &PrincipalRole) -> Result<()>;
    fn save_role(&mut self, value: &PrincipalRole) -> Result<()>;
    fn insert_member(&mut self, value: &Member) -> Result<()>;
    fn save_member(&mut self, value: &Member) -> Result<()>;
    fn member_view(&mut self, id: &str) -> Result<Option<MemberView>>;
    fn members_page(&mut self, page: i64, page_size: i64) -> Result<Page<MemberView>>;
    fn active_administrator_count(&mut self) -> Result<i64>;
    fn schedule_owned_agents(&mut self, owner_id: &str, revoke: bool, now: i64) -> Result<()>;
    fn policy(&mut self) -> Result<Option<InstancePolicy>>;
    fn insert_policy(&mut self, value: &InstancePolicy) -> Result<()>;
    fn save_policy(&mut self, value: &InstancePolicy) -> Result<()>;
    fn audit(&mut self, value: &Audit) -> Result<()>;
    fn remove_expired_sessions(&mut self, now: i64) -> Result<()>;
    fn session_count(&mut self, member_id: &str, now: i64) -> Result<i64>;
    fn insert_session(&mut self, value: &MemberSession) -> Result<()>;
    fn remove_session(&mut self, secret_hash: &str) -> Result<()>;
}

pub trait MatrixIdentity {
    fn identify(
        &self,
        native_token: &Secret,
    ) -> impl std::future::Future<Output = Result<String>> + Send;
}

pub trait FleetRepository: CoreRepository {
    fn fleet_instance(
        &mut self,
        owner: &str,
        fleet: &str,
        instance: &str,
    ) -> Result<Option<crate::fleet::values::Instance>>;
    fn fleet_instance_by_agent(
        &mut self,
        agent: &str,
    ) -> Result<Option<crate::fleet::values::Instance>>;
    fn save_fleet_instance(&mut self, instance: &crate::fleet::values::Instance) -> Result<()>;
    fn fleet(&mut self, id: &str) -> Result<Option<crate::fleet::values::Fleet>>;
    fn fleet_by_key(
        &mut self,
        owner_id: &str,
        fleet_key: &str,
    ) -> Result<Option<crate::fleet::values::Fleet>>;
    fn fleet_credential(&mut self, id: &str) -> Result<Option<crate::fleet::values::Credential>>;
    fn fleet_connection(&mut self, id: &str) -> Result<Option<crate::fleet::values::Connection>>;
    fn save_fleet(&mut self, value: &crate::fleet::values::Fleet) -> Result<()>;
    fn insert_fleet(&mut self, value: &crate::fleet::values::Fleet) -> Result<()>;
    fn insert_fleet_credential(&mut self, value: &crate::fleet::values::Credential) -> Result<()>;
    fn insert_fleet_instance(&mut self, value: &crate::fleet::values::Instance) -> Result<()>;
    fn current_fleet_instances(
        &mut self,
        fleet: &crate::fleet::values::Fleet,
    ) -> Result<Vec<crate::fleet::values::Instance>>;
    fn save_fleet_connection(&mut self, value: &crate::fleet::values::Connection) -> Result<()>;
}

pub trait AgentRepository: CoreRepository {
    fn agent_name(&mut self, agent_id: &str) -> Result<Option<String>>;
    fn insert_agent(&mut self, value: &Agent) -> Result<()>;
    fn save_agent(&mut self, value: &Agent) -> Result<()>;
    fn application(&mut self, principal_id: &str) -> Result<Option<Application>>;
    fn agent_view(&mut self, id: &str) -> Result<Option<crate::identity::AgentView>>;
    fn wake_senders(&mut self, agent_id: &str) -> Result<Vec<crate::wake::Sender>>;
    fn replace_wake_senders(
        &mut self,
        agent_id: &str,
        senders: &[crate::wake::Sender],
    ) -> Result<()>;
}

pub trait ListenerRepository: FleetRepository + crate::statistics::StatisticsRepository {
    fn listener_run(&mut self, id: &str) -> Result<Option<crate::listener::Run>>;
    fn save_listener_run(&mut self, value: &crate::listener::Run, insert: bool) -> Result<()>;
    fn active_listener_count(&mut self, agent_id: &str, since: i64, now: i64) -> Result<i64>;
}
pub trait CredentialRepository: AgentRepository {
    fn agent_credential(
        &mut self,
        agent_id: &str,
    ) -> Result<Option<crate::identity::AgentCredential>>;
    fn insert_agent_credential(
        &mut self,
        credential: &crate::identity::AgentCredential,
    ) -> Result<()>;
    fn save_agent_credential(
        &mut self,
        credential: &crate::identity::AgentCredential,
    ) -> Result<()>;
}
