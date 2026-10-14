using Crossfire.Kernel;

namespace Crossfire.Domain;

public sealed record AgentChange(long ExpectedRevision, string? Status = null);
public sealed record AgentChangeResult(Principal Principal, Agent Agent);
public sealed record AgentPorts(AuthorizationPorts Authorization, UnitOfWork Transaction,
    Func<Principal, PrincipalApplication, Result<Unit>> Update, Func<AuditIntent, Result<Unit>> Audit);

public static class Agents
{
    public static Result<AgentChangeResult> Change(AgentPorts ports, Actor actor, string agentId, AgentChange input, string requestId)
        => ports.Transaction.Run(() =>
        {
            var current = Authorization.Agent(ports.Authorization, actor, agentId, "configure");
            if (!current.IsSuccess) return Result<AgentChangeResult>.Fail(current.Error);
            if (current.Value.Principal.Revision != input.ExpectedRevision) return Results.Fail<AgentChangeResult>("conflict", "Agent revision changed");
            if (current.Value.Principal.Status == "revoked") return Results.Fail<AgentChangeResult>("conflict", "Account revocation is permanent");
            var principal = current.Value.Principal with { Status = input.Status ?? current.Value.Principal.Status, Revision = checked(input.ExpectedRevision + 1) };
            var changed = ports.Update(principal, current.Value.Application with { NextCheckAt = ports.Authorization.Now() });
            if (!changed.IsSuccess) return Result<AgentChangeResult>.Fail(changed.Error);
            var audited = ports.Audit(new(requestId, actor.Kind, actor.PrincipalId, current.Value.Agent.OwnerId, "agent", agentId, "agent.configure"));
            return audited.IsSuccess ? Result<AgentChangeResult>.Success(new(principal, current.Value.Agent)) : Result<AgentChangeResult>.Fail(audited.Error);
        });
}
