using Crossfire.Kernel;

namespace Crossfire.Domain;

public sealed record AgentName(string Name, string? RequestId, string? InstanceKey, string? AgentId);
public sealed record EnrollmentExisting(string InstanceKey, string AgentId, string Name, long Revision, bool Retired, bool Operational);
public sealed record RequestedFleetPolicy(string WakeMode, IReadOnlyList<WakeSelection> Senders, IReadOnlyList<string> Permissions, long? ExpectedAgentRevision);
public sealed record EnrollmentPolicy(string InstanceKey, RequestedFleetPolicy Policy);
public sealed record VerifiedRoster(string OwnerId, long OwnerRevision, IReadOnlyList<EnrollmentExisting> Existing, IReadOnlyList<EnrollmentPolicy> Policies);
public sealed record EnrollmentCapacity(InstancePolicy Policy, long OwnerLimit, long OwnerCount, long InstanceCount, long Remaining);
public sealed record EnrollmentAdmissionPorts(FleetPorts Fleet, Func<string, Result<Principal?>> PrincipalByMatrixId,
    Func<string, Result<MemberView?>> Member, Func<string, string, Result<FleetRecord?>> ByKey,
    Func<string, string, string, Result<FleetBinding?>> Binding, Func<string, Result<AgentName?>> Name,
    Func<string, Result<string?>> AgentToken, Func<Result<InstancePolicy?>> Policy,
    Func<string?, Result<long>> ActiveAgents, Func<string?, Result<long>> PendingIdentities,
    Func<string, CancellationToken, ValueTask<Result<string>>> Identify);

public static class EnrollmentValidation
{
    public static Result<Unit> Controller(ControllerDescription controller)
        => TextRules.Blank(controller.Name) || controller.Name.Length > 100 || controller.Metadata.Count > 16
            || controller.Metadata.Any(entry => !IdentitySyntax.Name(entry.Key) || entry.Value.Length > 256)
            ? Results.Fail<Unit>("invalid", "Invalid controller descriptor") : Results.Done();

    public static Result<Unit> Roster(EnrollmentRoster roster)
    {
        if (!IdentitySyntax.MatrixUser(roster.OwnerMatrixId) || !IdentitySyntax.Name(roster.FleetKey) || roster.Instances.Count is < 1 or > 100
            || roster.Instances.Any(value => !IdentitySyntax.Name(value.InstanceKey) || !IdentitySyntax.Name(value.Name))
            || roster.Instances.Select(value => value.InstanceKey).Distinct(StringComparer.Ordinal).Count() != roster.Instances.Count
            || roster.Instances.Select(value => value.Name).Distinct(StringComparer.Ordinal).Count() != roster.Instances.Count)
            return Results.Fail<Unit>("invalid", "Supply one owner and a unique roster of valid lowercase names and instance keys");
        var controller = Controller(roster.Controller);
        if (!controller.IsSuccess) return controller;
        foreach (var instance in roster.Instances)
        {
            var policy = instance.CoordinationPolicy;
            if (policy.WakeMode is not ("humans" or "everyone" or "selected") || policy.Senders.Count > 2000
                || policy.Senders.Select(value => value.MatrixUserId).Distinct(StringComparer.Ordinal).Count() != policy.Senders.Count
                || policy.WakeMode == "everyone" && policy.Senders.Count != 0 || policy.Senders.Any(value => !IdentitySyntax.MatrixUser(value.MatrixUserId))
                || policy.Permissions.Count > 1 || policy.Permissions.Any(value => value != "room.agent.invite"))
                return Results.Fail<Unit>("invalid", "Supply a valid wake mode, unique selected Matrix identities and supported room permissions");
        }
        return Results.Done();
    }
}
