using Crossfire.Kernel;
using System.Text.Json;

namespace Crossfire.Domain;

public sealed record MessagingPorts(
    Func<string, BackendDescription> Describe,
    Func<string, string, CancellationToken, ValueTask<Result<string>>> Authenticate,
    Func<string, string> AgentUserId,
    Func<string> ServiceUserId,
    Func<string, string> LocalLabel,
    Func<MemberSignup, Result<string>> RegistrationUserId,
    Func<string, string, BackendAccount> AgentAccount,
    Func<string, CancellationToken, ValueTask<Result<string>>> Identify,
    Func<string, CancellationToken, ValueTask<Result<bool>>> Exists,
    Func<string, string, JsonElement?, CancellationToken, ValueTask<Result<BackendAccount>>> Provision,
    Func<string, CancellationToken, ValueTask<Result<Unit>>> Deactivate,
    Func<string, CancellationToken, ValueTask<Result<Unit>>> Discard,
    Func<string, CancellationToken, ValueTask<Result<string?>>> ProfileName,
    Func<string, string, CancellationToken, ValueTask<Result<Unit>>> SetDisplayName,
    Func<string, CancellationToken, ValueTask<Result<IReadOnlyList<string>>>> Joined,
    Func<string, string, string?, string?, CancellationToken, ValueTask<Result<string>>> OwnerConversation,
    Func<string, string, string, CancellationToken, ValueTask<Result<Unit>>> VerifyOwnerConversation,
    Func<string, string, string, CancellationToken, ValueTask<Result<Unit>>> MarkDirect,
    Func<string, string, string?, CancellationToken, ValueTask<Result<RoomFacts>>> Room,
    Func<string, string, string, CancellationToken, ValueTask<Result<RoomMembership>>> Membership,
    Func<string, string, CancellationToken, ValueTask<Result<RoomInvitation?>>> Invitation,
    Func<string, string, string, RoomAccessIntent, CancellationToken, ValueTask<Result<RoomFacts>>> AuthorizeRoomAccess,
    Func<string, string, string, RoomAccessIntent, RoomAdmission?, CancellationToken, ValueTask<Result<RoomMembership>>> SetRoomAccess,
    Func<string, string, CancellationToken, ValueTask<Result<Unit>>> Leave,
    Func<string, string, string, CancellationToken, ValueTask<Result<BackendEvent>>> Event,
    Func<string, string, string, string, string, CancellationToken, ValueTask<Result<string>>> SendNotice);

public delegate ValueTask<Result<Unit>> RoomOperation(string roomId,
    Func<CancellationToken, ValueTask<Result<Unit>>> operation, CancellationToken cancellation);
public sealed record RoomReconcilePorts(RoomGrantPorts Grants, MessagingPorts Messaging, Func<Result<InstancePolicy?>> Policy,
    Func<string, Result<PrincipalApplication?>> Account, RoomOperation Operation);
