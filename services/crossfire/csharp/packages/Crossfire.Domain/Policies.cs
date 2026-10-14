using System.Text;
using Crossfire.Kernel;

namespace Crossfire.Domain;

public sealed record PolicyPorts(AuthorizationPorts Authorization, UnitOfWork Transaction,
    Func<Result<InstancePolicy?>> Find, Func<InstancePolicy, Result<Unit>> Update, Func<AuditIntent, Result<Unit>> Audit);

public static class Policies
{
    public static Result<InstancePolicy> Read(PolicyPorts ports, Actor actor)
    {
        var authority = Authorization.Require(ports.Authorization, actor, "principal.read");
        if (!authority.IsSuccess) return Result<InstancePolicy>.Fail(authority.Error);
        var policy = ports.Find();
        return !policy.IsSuccess ? Result<InstancePolicy>.Fail(policy.Error) : policy.Value is not null
            ? Result<InstancePolicy>.Success(policy.Value) : Results.Fail<InstancePolicy>("unavailable", "Instance policy is not initialized");
    }

    public static Result<long> Change(PolicyPorts ports, Actor actor, InstancePolicy input, long expectedRevision, string requestId)
    {
        if (input.MaxOwnerAgents is < 1 or > 100 || input.MaxAgents < input.MaxOwnerAgents || input.MaxAgents > 1000
            || input.MaxPending is < 1 or > 1000 || input.EnrollmentSeconds is < 60 or > 3600 || input.ReconcileSeconds is < 30 or > 3600
            || input.MaxMessageBytes is < 4096 or > 4194304 || input.FleetIdleTimeoutSeconds is < 0 or > 604800
            || input.SignupMode is not ("invitation" or "open") || input.InvitationIssuers is not ("administrators" or "members")
            || Encoding.UTF8.GetByteCount(input.AgentInstructions) > 8192 || input.AgentInstructions.Any(value => value is <= '\u0008' or '\u000b' or '\u000c' or >= '\u000e' and <= '\u001f' or '\u007f'))
            return Results.Fail<long>("invalid", "Invalid bounded instance policy");
        return ports.Transaction.Run(() =>
        {
            var authority = Authorization.Require(ports.Authorization, actor, "policy.manage");
            if (!authority.IsSuccess) return Result<long>.Fail(authority.Error);
            var current = ports.Find();
            if (!current.IsSuccess) return Result<long>.Fail(current.Error);
            if (current.Value is null || current.Value.Revision != expectedRevision) return Results.Fail<long>("conflict", "Policy revision changed");
            var next = input with { Id = "instance", Revision = checked(expectedRevision + 1) };
            var changed = ports.Update(next);
            if (!changed.IsSuccess) return Result<long>.Fail(changed.Error);
            var audit = ports.Audit(new(requestId, actor.Kind, actor.PrincipalId, null, "instance-policy", "instance", "instance-policy.configure"));
            return audit.IsSuccess ? Result<long>.Success(next.Revision) : Result<long>.Fail(audit.Error);
        });
    }
}
