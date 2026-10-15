use crate::operations::OperationId;
pub fn fields(operation: OperationId) -> &'static [&'static str] {
    use OperationId::*;
    match operation {
        Publications => &["page", "pageSize", "search", "ownerId", "agentId", "state"],
        FleetStatistics => &["hours", "page", "pageSize"],
        FleetControl => &["connectionId", "revision", "waitMs"],
        RuntimeDecisions => &["page", "pageSize", "status"],
        WakeMetadata | ValidateWake => &["runId", "sessionId"],
        Principals => &["page", "pageSize", "kind", "search", "excludeId"],
        Agents => &[
            "page", "pageSize", "ownerId", "status", "listener", "search",
        ],
        Enrollments | Audit => &["page", "pageSize", "ownerId"],
        Fleets | WakeRules => &["page", "pageSize", "ownerId", "search"],
        Rooms => &["page", "pageSize", "agentId", "search"],
        Room => &["agentId"],
        Grants => &["page", "pageSize", "roomIds"],
        FleetRuntimeOperations
        | FleetAgents
        | FleetMessages
        | Members
        | Invitations
        | ListenerRuns => &["page", "pageSize"],
        RecordFleetNativeStop
        | CreatePublication
        | Publication
        | UploadPublicationFile
        | CommitPublication
        | DeletePublication
        | RequestFleetRuntime
        | ClaimFleetRuntime
        | ReceiptFleetRuntime
        | RuntimeObservations
        | ReportRuntime
        | CreateRuntimeDecision
        | RuntimeDecision
        | AnswerRuntimeDecision
        | PollRuntimeDecision
        | ReceiptRuntimeDecision
        | ReportFleetFailure
        | CreateWakeRule
        | WakeRule
        | ChangeWakeRule
        | DeleteWakeRule
        | ClaimWake
        | AcknowledgeWake
        | CreateSession
        | CurrentSession
        | EndSession
        | ResolvePrincipals
        | Roles
        | Permissions
        | Member
        | ChangeMember
        | MemberRole
        | CreateInvitation
        | Invitation
        | RevokeInvitation
        | ClaimInvitation
        | RegistrationPolicy
        | Preflight
        | IntroduceEnrollment
        | Enrollment
        | DecideEnrollment
        | ExchangeEnrollment
        | Fleet
        | ChangeFleet
        | ArchiveFleet
        | FleetMap
        | ChangeFleetDelivery
        | ReportFleetConnection
        | CreateFleetMessage
        | AcknowledgeFleetMessage
        | RemoveFleetAgent
        | Agent
        | ChangeAgent
        | WakePolicy
        | ChangeWakePolicy
        | DeliveryPolicy
        | Grant
        | SetGrant
        | RemoveGrant
        | GrantPermissions
        | AcceptRoomInvitation
        | OwnerConversation
        | SetGrantPermissions
        | PreviewGrants
        | ApplyGrants
        | ReportListener
        | WakeNotice
        | Policy
        | ChangePolicy
        | Release
        | Health => &[],
    }
}
