using Crossfire.Kernel;

namespace Crossfire.Domain;

public static class EnrollmentCoordination
{
    public static Result<bool> Matches(EnrollmentPorts ports, string agentId, RequestedFleetPolicy requested)
    {
        var agent = ports.Admission.Fleet.Authorization.Agent(agentId);
        if (!agent.IsSuccess) return Result<bool>.Fail(agent.Error);
        var policy = ports.Rooms.FleetPolicy(agentId);
        if (!policy.IsSuccess) return Result<bool>.Fail(policy.Error);
        var senders = ports.WakeSenders(agentId);
        if (!senders.IsSuccess) return Result<bool>.Fail(senders.Error);
        return Result<bool>.Success(agent.Value is not null && policy.Value?.ApprovedByMemberId == agent.Value.OwnerId
            && agent.Value.WakeMode == requested.WakeMode && policy.Value.Permissions.Count == requested.Permissions.Count
            && policy.Value.Permissions.All(requested.Permissions.Contains)
            && senders.Value.Count == requested.Senders.Count
            && senders.Value.All(sender => requested.Senders.Any(selection => selection.PrincipalId == sender.SenderPrincipalId && selection.IncludeAgents == sender.IncludeAgents)));
    }

    public static Result<Unit> Apply(EnrollmentPorts ports, Actor actor, string agentId, RequestedFleetPolicy requested, string requestId)
    {
        var current = ports.Admission.Fleet.Authorization.AgentView(agentId);
        if (!current.IsSuccess) return Result<Unit>.Fail(current.Error);
        if (current.Value is null || actor.Kind != "human" || current.Value.Agent.OwnerId != actor.PrincipalId
            || current.Value.Principal.Status != "active" || current.Value.Owner.Status != "active")
            return Results.Fail<Unit>("forbidden", "Only the active owner may approve fleet coordination");
        if (requested.ExpectedAgentRevision is not null && requested.ExpectedAgentRevision != current.Value.Principal.Revision)
            return Results.Fail<Unit>("conflict", "Agent configuration changed; submit a new fleet request");
        var valid = WakeChanges.Validate(ports.Admission.Fleet.Authorization, agentId, requested.WakeMode, requested.Senders);
        if (!valid.IsSuccess) return valid;
        var matches = Matches(ports, agentId, requested);
        if (!matches.IsSuccess) return Result<Unit>.Fail(matches.Error);
        if (matches.Value) return Results.Done();
        var wake = ports.Wake.Replace(agentId, requested.WakeMode, requested.Senders, checked(current.Value.Principal.Revision + 1));
        if (!wake.IsSuccess) return wake;
        var saved = ports.ApprovePolicy(agentId, new(actor.PrincipalId, requested.Permissions));
        if (!saved.IsSuccess) return saved;
        var grants = ports.Rooms.Grants(agentId);
        if (!grants.IsSuccess) return Result<Unit>.Fail(grants.Error);
        foreach (var grant in grants.Value)
        {
            var conversation = ports.Rooms.PrivateConversation(grant.RoomId);
            if (!conversation.IsSuccess) return Result<Unit>.Fail(conversation.Error);
            if (grant.AccessMode == "none" || conversation.Value is not null) continue;
            var assigned = RoomPermissions.ApplyFleet(ports.Rooms, grant);
            if (!assigned.IsSuccess) return assigned;
            var changed = ports.Rooms.Save(grant with { Revision = checked(grant.Revision + 1), UpdatedAt = ports.Admission.Fleet.Authorization.Now() }, false);
            if (!changed.IsSuccess) return changed;
        }
        return ports.Admission.Fleet.Audit(new(requestId, actor.Kind, actor.PrincipalId, actor.PrincipalId, "agent", agentId, "fleet.coordination-policy.approve"));
    }
}
