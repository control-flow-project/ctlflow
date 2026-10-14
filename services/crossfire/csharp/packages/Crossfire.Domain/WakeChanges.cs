using Crossfire.Kernel;

namespace Crossfire.Domain;

public sealed record WakeSelection(string PrincipalId, bool IncludeAgents);
public sealed record WakeChange(long ExpectedRevision, string Mode, IReadOnlyList<WakeSelection> Senders);
public sealed record WakeChangeResult(string Mode, IReadOnlyList<WakeSelection> Senders, long Revision);
public sealed record WakePorts(AuthorizationPorts Authorization, UnitOfWork Transaction,
    Func<string, string, IReadOnlyList<WakeSelection>, long, Result<Unit>> Replace, Func<AuditIntent, Result<Unit>> Audit);

public static class WakeChanges
{
    public static Result<Unit> Validate(AuthorizationPorts ports, string? agentId, string mode, IReadOnlyList<WakeSelection> senders)
    {
        if (mode is not ("humans" or "everyone" or "selected") || mode == "everyone" && senders.Count != 0
            || senders.Count > 2000 || senders.Select(sender => sender.PrincipalId).Distinct(StringComparer.Ordinal).Count() != senders.Count
            || senders.Any(sender => sender.PrincipalId == agentId)) return Results.Fail<Unit>("invalid", "Invalid selected sender list");
        foreach (var selection in senders)
        {
            var sender = ports.Principal(selection.PrincipalId);
            if (!sender.IsSuccess) return Result<Unit>.Fail(sender.Error);
            if (sender.Value is not { Status: "active" }) return Results.Fail<Unit>("invalid", "Select active registered identities");
            if (sender.Value.Kind == "agent")
            {
                if (selection.IncludeAgents) return Results.Fail<Unit>("invalid", "Only people can include their agents");
                var selected = ports.AgentView(selection.PrincipalId);
                if (!selected.IsSuccess) return Result<Unit>.Fail(selected.Error);
                if (selected.Value?.Owner.Status != "active") return Results.Fail<Unit>("invalid", "Selected agent owner is not active");
            }
        }
        return Results.Done();
    }

    public static Result<WakeChangeResult> Change(WakePorts ports, Actor actor, string agentId, WakeChange input, string requestId)
        => ports.Transaction.Run(() =>
        {
            var current = Authorization.Agent(ports.Authorization, actor, agentId, "configure");
            if (!current.IsSuccess) return Result<WakeChangeResult>.Fail(current.Error);
            if (current.Value.Principal.Revision != input.ExpectedRevision) return Results.Fail<WakeChangeResult>("conflict", "Agent revision changed");
            if (current.Value.Principal.Status == "revoked") return Results.Fail<WakeChangeResult>("conflict", "Account revocation is permanent");
            var valid = Validate(ports.Authorization, agentId, input.Mode, input.Senders);
            if (!valid.IsSuccess) return Result<WakeChangeResult>.Fail(valid.Error);
            var revision = checked(input.ExpectedRevision + 1);
            var changed = ports.Replace(agentId, input.Mode, input.Senders, revision);
            if (!changed.IsSuccess) return Result<WakeChangeResult>.Fail(changed.Error);
            var audited = ports.Audit(new(requestId, actor.Kind, actor.PrincipalId, current.Value.Owner.Id, "agent", agentId, "agent.wake-policy.configure"));
            return audited.IsSuccess ? Result<WakeChangeResult>.Success(new(input.Mode, input.Senders.OrderBy(sender => sender.PrincipalId, StringComparer.Ordinal).ToArray(), revision))
                : Result<WakeChangeResult>.Fail(audited.Error);
        });
}
