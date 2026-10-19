using Crossfire.Kernel;

namespace Crossfire.Domain;

public static class Authorization
{
    public static Result<Principal> ActiveActor(AuthorizationPorts ports, Actor actor)
    {
        var found = ports.Principal(actor.PrincipalId);
        if (!found.IsSuccess) return Result<Principal>.Fail(found.Error);
        var principal = found.Value;
        if (principal is null || principal.Kind != actor.Kind || principal.Status != "active")
            return Results.Fail<Principal>("forbidden", "An active registered identity is required");
        if (actor.Authentication is NativeAuthentication native && native.BackendUserId != principal.BackendUserId)
            return Results.Fail<Principal>("unauthorized", "Native session identity changed");
        if (actor.Kind == "human" && actor.Authentication is not NativeAuthentication)
        {
            if (actor.Authentication is not ManagementAuthentication management)
                return Results.Fail<Principal>("unauthorized", "A verified human session is required");
            var session = ports.Session(management.SessionHash);
            if (!session.IsSuccess) return Result<Principal>.Fail(session.Error);
            if (session.Value is null || session.Value.MemberId != actor.PrincipalId || session.Value.ExpiresAt <= ports.Now())
                return Results.Fail<Principal>("unauthorized", "Management session expired or ended");
        }
        if (actor.Kind == "agent")
        {
            var agent = ports.Agent(actor.PrincipalId);
            if (!agent.IsSuccess) return Result<Principal>.Fail(agent.Error);
            if (agent.Value is null) return Results.Fail<Principal>("forbidden", "Agent identity is not registered");
            var owner = ports.Principal(agent.Value.OwnerId);
            if (!owner.IsSuccess) return Result<Principal>.Fail(owner.Error);
            if (owner.Value is null || owner.Value.Status != "active")
                return Results.Fail<Principal>("forbidden", "Agent owner must be active");
            var binding = ports.Binding(actor.PrincipalId);
            if (!binding.IsSuccess) return Result<Principal>.Fail(binding.Error);
            if (binding.Value is null || binding.Value.RetiredAt is not null)
                return Results.Fail<Principal>("forbidden", "Agent requires a current approved fleet controller");
            var fleet = ports.Fleet(binding.Value.OwnerId, binding.Value.FleetKey);
            if (!fleet.IsSuccess) return Result<Principal>.Fail(fleet.Error);
            if (fleet.Value is null || fleet.Value.ArchivedAt is not null)
                return Results.Fail<Principal>("forbidden", "Agent fleet is archived");
        }
        return Result<Principal>.Success(principal);
    }

    public static Result<Principal> Require(AuthorizationPorts ports, Actor actor, string permission)
    {
        var principal = ActiveActor(ports, actor);
        if (!principal.IsSuccess) return principal;
        var permissions = ports.Permissions(actor.PrincipalId);
        return !permissions.IsSuccess ? Result<Principal>.Fail(permissions.Error)
            : permissions.Value.Contains(permission, StringComparer.Ordinal) ? principal
            : Results.Fail<Principal>("forbidden", "Permission required: " + permission);
    }

    public static Result<AgentView> Agent(AuthorizationPorts ports, Actor actor, string agentId, string action)
    {
        if (action is not ("read" or "configure" or "room-grant.manage"))
            return Results.Fail<AgentView>("invalid", "Invalid agent authorization action");
        var principal = ActiveActor(ports, actor);
        if (!principal.IsSuccess) return Result<AgentView>.Fail(principal.Error);
        var agent = ports.AgentView(agentId);
        if (!agent.IsSuccess) return Result<AgentView>.Fail(agent.Error);
        if (agent.Value is null) return Results.Fail<AgentView>("missing", "Agent not found");
        var binding = ports.Binding(agentId);
        if (!binding.IsSuccess) return Result<AgentView>.Fail(binding.Error);
        if (binding.Value is null || binding.Value.RetiredAt is not null)
            return Results.Fail<AgentView>("missing", "Current fleet-managed agent not found");
        var fleet = ports.Fleet(binding.Value.OwnerId, binding.Value.FleetKey);
        if (!fleet.IsSuccess) return Result<AgentView>.Fail(fleet.Error);
        if (fleet.Value is null || fleet.Value.ArchivedAt is not null)
            return Results.Fail<AgentView>("missing", "Current fleet-managed agent not found");
        var permissions = ports.Permissions(actor.PrincipalId);
        if (!permissions.IsSuccess) return Result<AgentView>.Fail(permissions.Error);
        var allowed = permissions.Value.Contains("agent." + action + ".any", StringComparer.Ordinal)
            || agent.Value.Agent.OwnerId == actor.PrincipalId && permissions.Value.Contains("agent." + action + ".owned", StringComparer.Ordinal)
            || action == "read" && agentId == actor.PrincipalId && permissions.Value.Contains("agent.read.self", StringComparer.Ordinal);
        return allowed ? Result<AgentView>.Success(agent.Value) : Results.Fail<AgentView>("missing", "Agent not found");
    }
}
