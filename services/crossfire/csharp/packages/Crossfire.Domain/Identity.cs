using Crossfire.Kernel;

namespace Crossfire.Domain;

public sealed record Principal(string Id, string MatrixUserId, string Kind, string Status, long Revision, long CreatedAt);
public sealed record Member(string PrincipalId, string PrincipalKind, string DisplayName);
public sealed record Agent(string PrincipalId, string PrincipalKind, string OwnerId, string WakeMode);
public sealed record MemberSession(string SecretHash, string MemberId, string CsrfSecret, string NativeAccessToken, long CreatedAt, long ExpiresAt);
public sealed record AgentView(Principal Principal, Agent Agent, string Name, PrincipalApplication Application, Principal Owner, Member OwnerMember);
public sealed record FleetIdentity(string Id, string OwnerId, string FleetKey, long? ArchivedAt);
public sealed record FleetBinding(string OwnerId, string FleetKey, string InstanceKey, string AgentId, long? RetiredAt);
public abstract record Authentication;
public sealed record NativeAuthentication(string MatrixUserId) : Authentication;
public sealed record ManagementAuthentication(string SessionHash) : Authentication;
public sealed record Actor(string PrincipalId, string Kind, Authentication? Authentication);

public sealed record AuthorizationPorts(
    Func<string, Result<Principal?>> Principal,
    Func<string, Result<MemberSession?>> Session,
    Func<string, Result<Agent?>> Agent,
    Func<string, Result<AgentView?>> AgentView,
    Func<string, Result<FleetBinding?>> Binding,
    Func<string, string, Result<FleetIdentity?>> Fleet,
    Func<string, Result<IReadOnlyList<string>>> Permissions,
    Func<long> Now);
