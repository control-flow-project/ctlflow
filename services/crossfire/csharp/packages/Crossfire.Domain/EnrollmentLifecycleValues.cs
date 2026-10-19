using Crossfire.Kernel;

namespace Crossfire.Domain;

public sealed record EnrollmentRequest(string Id, string OwnerId, string FleetKey, string ControllerName, string ControllerCredentialHash,
    string VerificationCode, string ClaimHash, string RosterDigest, string Status, long Revision, long CreatedAt, long ExpiresAt,
    string? DecidedByMemberId, long? DecidedAt);
public sealed record EnrollmentItem(string RequestId, string InstanceKey, string RequestedName, string Outcome, string? AgentId);
public sealed record EnrollmentItemReview(EnrollmentItem Item, string? CurrentName, CoordinationPolicy CoordinationPolicy);
public sealed record EnrollmentReview(EnrollmentRequest Request, MemberView Owner, IReadOnlyList<EnrollmentItemReview> Instances);
public sealed record EnrollmentIntroduction(string EnrollmentId, string ClaimSecret, EnrollmentRoster Roster);
public sealed record EnrollmentDecision(long ExpectedRevision, string Decision, string VerificationCode);
public sealed record EnrollmentDecisionResult(string EnrollmentId, string Status, long Revision);
public sealed record AgentCredential(string AgentId, string ProvisioningPassword, string? AccessToken, long UpdatedAt);
public sealed record ExchangedInstance(string InstanceKey, string Name, string AgentId, string Status, string? ErrorCode, BackendAccount? Account);
public sealed record ExchangedFleet(string FleetId, string? ControllerCredential);
public sealed record EnrollmentExchange(string Status, string OwnerBackendUserId, ExchangedFleet? Fleet, IReadOnlyList<ExchangedInstance> Instances);
public sealed record EnrollmentPorts(EnrollmentAdmissionPorts Admission, UnitOfWork Transaction, RoomGrantPorts Rooms, WakePorts Wake,
    Func<string, Result<EnrollmentRequest?>> Find, Func<string, Result<IReadOnlyList<EnrollmentItem>>> Items,
    Func<string, Result<IReadOnlyList<EnrollmentPolicy>>> Policies, Func<long, Result<IReadOnlyList<EnrollmentRequest>>> Expired,
    Func<Result<long>> PendingCount, Func<EnrollmentRequest, bool, Result<Unit>> Save,
    Func<EnrollmentItem, bool, Result<Unit>> SaveItem, Func<EnrollmentItem, RequestedFleetPolicy, Result<Unit>> SavePolicy,
    Func<string, IReadOnlyDictionary<string, string>, Result<Unit>> SaveMetadata,
    Func<string, Result<IReadOnlyDictionary<string, string>>> Metadata,
    Func<AgentName, bool, Result<Unit>> SaveName, Func<string, Result<Unit>> RemoveName, Func<string, Result<Unit>> ReleaseNames,
    Func<Principal, string, string?, Result<Unit>> Register, Func<Agent, AgentCredential, Result<Unit>> RegisterAgent,
    Func<Principal, long, Result<Unit>> SavePrincipal, Func<string, Result<AgentCredential?>> Credential,
    Func<FleetRecord, bool, Result<Unit>> SaveFleet, Func<FleetBinding, bool, Result<Unit>> SaveBinding,
    Func<FleetCredential, Result<Unit>> SaveFleetCredential,
    Func<string, IReadOnlyDictionary<string, string>, Result<Unit>> SaveFleetMetadata,
    Func<string, RoomPolicy, Result<Unit>> ApprovePolicy,
    Func<string, Result<IReadOnlyList<WakeSender>>> WakeSenders, MessagingPorts Messaging);
