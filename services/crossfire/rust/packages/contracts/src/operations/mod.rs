use crossfire_domain::permission::Permission;
mod agent;
mod fleet;
mod identity;
mod publication;
mod runtime;
mod wake;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Method {
    Get,
    Post,
    Put,
    Patch,
    Delete,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Authentication {
    Public,
    Human,
    Agent,
    Either,
    Fleet,
    Controller,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OperationId {
    RecordFleetNativeStop,
    CreatePublication,
    Publications,
    Publication,
    UploadPublicationFile,
    CommitPublication,
    DeletePublication,
    FleetRuntimeOperations,
    RequestFleetRuntime,
    ClaimFleetRuntime,
    ReceiptFleetRuntime,
    RuntimeObservations,
    ReportRuntime,
    RuntimeDecisions,
    CreateRuntimeDecision,
    RuntimeDecision,
    AnswerRuntimeDecision,
    PollRuntimeDecision,
    ReceiptRuntimeDecision,
    ReportFleetFailure,
    WakeRules,
    CreateWakeRule,
    WakeRule,
    ChangeWakeRule,
    DeleteWakeRule,
    WakeMetadata,
    ClaimWake,
    ValidateWake,
    AcknowledgeWake,
    CreateSession,
    CurrentSession,
    EndSession,
    Principals,
    ResolvePrincipals,
    Roles,
    Permissions,
    Members,
    Member,
    ChangeMember,
    MemberRole,
    CreateInvitation,
    Invitations,
    Invitation,
    RevokeInvitation,
    ClaimInvitation,
    RegistrationPolicy,
    Preflight,
    IntroduceEnrollment,
    Enrollments,
    Enrollment,
    DecideEnrollment,
    ExchangeEnrollment,
    Fleets,
    Fleet,
    ChangeFleet,
    ArchiveFleet,
    FleetMap,
    FleetStatistics,
    FleetAgents,
    ChangeFleetDelivery,
    ReportFleetConnection,
    FleetControl,
    FleetMessages,
    CreateFleetMessage,
    AcknowledgeFleetMessage,
    RemoveFleetAgent,
    Agents,
    Agent,
    ChangeAgent,
    WakePolicy,
    ChangeWakePolicy,
    DeliveryPolicy,
    Rooms,
    Room,
    Grants,
    Grant,
    SetGrant,
    RemoveGrant,
    GrantPermissions,
    AcceptRoomInvitation,
    OwnerConversation,
    SetGrantPermissions,
    PreviewGrants,
    ApplyGrants,
    ListenerRuns,
    ReportListener,
    WakeNotice,
    Policy,
    ChangePolicy,
    Audit,
    Release,
    Health,
}

#[derive(Debug)]
pub struct Operation<Id = OperationId> {
    pub id: Id,
    pub name: &'static str,
    pub method: Method,
    pub path: &'static str,
    pub auth: Authentication,
    pub status: u16,
    pub collection: bool,
    pub request_bytes: usize,
    pub binary: bool,
    pub permissions: &'static [Permission],
}

pub fn operations() -> impl Iterator<Item = &'static Operation> + Clone {
    [
        identity::OPERATIONS,
        fleet::OPERATIONS,
        agent::OPERATIONS,
        runtime::OPERATIONS,
        wake::OPERATIONS,
        publication::OPERATIONS,
    ]
    .into_iter()
    .flatten()
}
