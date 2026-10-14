using Crossfire.Kernel;

namespace Crossfire.Domain;

public sealed record AgentDeployment(string AgentId, string FleetId, string FleetKey, string Label, string ControllerName, long ReportedAt, string InstanceKey);
public sealed record AgentDirectoryFilter(int Page, int PageSize, string? OwnerId, IReadOnlyList<string> Statuses, string Search, string Listener, IReadOnlyList<string>? AgentIds = null);
public sealed record AgentDetails(AgentView Record, ListenerActivity Activity, RuntimeSummary? NativeRuntime, AgentDeployment Deployment, bool CanRetire, IReadOnlyList<string> AllowedActions);
public sealed record AgentReadSnapshot(IReadOnlyList<AgentView> Records, IReadOnlyList<AgentDeployment> Deployments,
    IReadOnlyDictionary<string, ListenerActivity> Activity, IReadOnlyDictionary<string, RuntimeSummary?> Runtime, RetirementSnapshot Retirement);
public sealed record AgentReadPorts(AuthorizationPorts Authorization, Func<AgentDirectoryFilter, Result<Page<string>>> Page,
    Func<IReadOnlyList<string>, Result<AgentReadSnapshot>> Load);

public static class AgentReads
{
    public static IReadOnlyList<string> Actions(Actor actor, AgentView target, IReadOnlyList<string> permissions, bool canRetire)
    {
        var actions = new[] { "configure", "room-grant.manage" }.Where(action => permissions.Contains("agent." + action + ".any", StringComparer.Ordinal)
            || actor.PrincipalId == target.Agent.OwnerId && permissions.Contains("agent." + action + ".owned", StringComparer.Ordinal)).ToList();
        if (canRetire && actions.Contains("configure", StringComparer.Ordinal)) actions.Add("retire"); return actions;
    }

    public static Result<IReadOnlyList<AgentDetails>> Details(AgentReadPorts ports, FleetActor actor, IReadOnlyList<string> ids)
    {
        var permissions = actor is FleetPrincipalActor principal ? ports.Authorization.Permissions(principal.Identity.PrincipalId) : Result<IReadOnlyList<string>>.Success([]);
        if (!permissions.IsSuccess) return Result<IReadOnlyList<AgentDetails>>.Fail(permissions.Error);
        var facts = ports.Load(ids); if (!facts.IsSuccess) return Result<IReadOnlyList<AgentDetails>>.Fail(facts.Error);
        var records = facts.Value.Records.ToDictionary(value => value.Principal.Id, StringComparer.Ordinal); var deployments = facts.Value.Deployments.ToDictionary(value => value.AgentId, StringComparer.Ordinal);
        var retirement = facts.Value.Retirement.Agents.ToDictionary(value => value.AgentId, StringComparer.Ordinal);
        if (ids.Any(id => !records.ContainsKey(id) || !deployments.ContainsKey(id) || !facts.Value.Activity.ContainsKey(id))) return Results.Fail<IReadOnlyList<AgentDetails>>("unavailable", "Current agent fleet binding or activity is missing");
        return Result<IReadOnlyList<AgentDetails>>.Success(ids.Select(id =>
        {
            var eligible = retirement.TryGetValue(id, out var value) && value.FleetId == deployments[id].FleetId && FleetRetirement.Eligible(value, ports.Authorization.Now());
            return new AgentDetails(records[id], facts.Value.Activity[id], facts.Value.Runtime.GetValueOrDefault(id), deployments[id], eligible,
                actor is FleetPrincipalActor acting ? Actions(acting.Identity, records[id], permissions.Value, eligible) : []);
        }).ToArray());
    }

    public static Result<AgentDetails> Read(AgentReadPorts ports, Actor actor, string agentId)
    {
        var authority = Authorization.Agent(ports.Authorization, actor, agentId, "read");
        return authority.IsSuccess ? Details(ports, new FleetPrincipalActor(actor), [agentId]).Map(values => values[0]) : Result<AgentDetails>.Fail(authority.Error);
    }

    public static Result<Page<AgentDetails>> List(AgentReadPorts ports, Actor actor, AgentDirectoryFilter input)
    {
        var scope = OwnerScopes.Read(ports.Authorization, actor, "agent.read", input.OwnerId); if (!scope.IsSuccess) return Result<Page<AgentDetails>>.Fail(scope.Error);
        var page = ports.Page(input with { OwnerId = scope.Value });
        if (!page.IsSuccess) return Result<Page<AgentDetails>>.Fail(page.Error);
        return Details(ports, new FleetPrincipalActor(actor), page.Value.Items).Map(values => new Page<AgentDetails>(values, page.Value.PageNumber, page.Value.PageSize, page.Value.TotalItems));
    }
}
