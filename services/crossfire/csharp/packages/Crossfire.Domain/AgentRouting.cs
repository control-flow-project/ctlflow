using Crossfire.Kernel;

namespace Crossfire.Domain;

public sealed record WakeSelectionView(PrincipalSummary Identity, bool IncludeAgents);
public sealed record WakePolicyView(string AgentId, long Revision, string Mode, IReadOnlyList<WakeSelectionView> Senders);
public sealed record AgentDeliveryPolicy(AgentView Record, string? OwnerConversation, IReadOnlyList<RoomGrant> Grants, IReadOnlyList<string> Senders, long MaxMessageBytes, long FleetIdleTimeoutSeconds);
public sealed record AgentRoutingPorts(RoomGrantPorts Grants, DiscoveryPorts Discovery,
    Func<Result<InstancePolicy?>> Policy, Func<Result<IReadOnlyList<ActiveIdentity>>> Identities, Func<string, Result<IReadOnlyList<WakeSender>>> Senders,
    Func<string, Result<IReadOnlyList<RoomGrantApplication>>> Applications);

public static class AgentRouting
{
    public static Result<IReadOnlyList<string>> Senders(AgentRoutingPorts ports, AgentView target)
    {
        var identities = ports.Identities(); if (!identities.IsSuccess) return Result<IReadOnlyList<string>>.Fail(identities.Error);
        var selected = ports.Senders(target.Principal.Id);
        return selected.Map(values => WakePolicy.SenderMatrixIds(target, identities.Value, values));
    }

    public static Result<WakePolicyView> Wake(AgentRoutingPorts ports, Actor actor, string agentId)
    {
        var target = Authorization.Agent(ports.Grants.Authorization, actor, agentId, "read"); if (!target.IsSuccess) return Result<WakePolicyView>.Fail(target.Error);
        var selections = ports.Senders(agentId); if (!selections.IsSuccess) return Result<WakePolicyView>.Fail(selections.Error);
        var identities = ports.Discovery.Selected(selections.Value.Select(value => value.SenderPrincipalId).ToArray());
        var includes = selections.Value.ToDictionary(value => value.SenderPrincipalId, value => value.IncludeAgents, StringComparer.Ordinal);
        return identities.Map(values => new WakePolicyView(agentId, target.Value.Principal.Revision, target.Value.Agent.WakeMode, values.Select(value => new WakeSelectionView(value, includes[value.PrincipalId])).ToArray()));
    }

    public static Result<AgentDeliveryPolicy> Delivery(AgentRoutingPorts ports, Actor actor, string agentId)
    {
        var target = Authorization.Agent(ports.Grants.Authorization, actor, agentId, "read"); if (!target.IsSuccess) return Result<AgentDeliveryPolicy>.Fail(target.Error);
        var policy = ports.Policy(); if (!policy.IsSuccess) return Result<AgentDeliveryPolicy>.Fail(policy.Error);
        if (policy.Value is null) return Results.Fail<AgentDeliveryPolicy>("unavailable", "Instance delivery policy is not initialized");
        var grants = ports.Grants.Grants(agentId); if (!grants.IsSuccess) return Result<AgentDeliveryPolicy>.Fail(grants.Error);
        var applied = ports.Applications(agentId); if (!applied.IsSuccess) return Result<AgentDeliveryPolicy>.Fail(applied.Error);
        var senders = Senders(ports, target.Value); if (!senders.IsSuccess) return Result<AgentDeliveryPolicy>.Fail(senders.Error);
        var conversation = ports.Grants.OwnerConversationRoom(agentId); if (!conversation.IsSuccess) return Result<AgentDeliveryPolicy>.Fail(conversation.Error);
        var joined = applied.Value.Where(value => value.Membership == "join" && value.ErrorCode is null).ToDictionary(value => value.RoomId, StringComparer.Ordinal);
        var eligible = grants.Value.Where(value => value.AccessMode != "none" && joined.GetValueOrDefault(value.RoomId)?.ObservedGeneration == value.Generation).ToArray();
        if (conversation.Value is not null && target.Value.Principal.Status == "active" && target.Value.Owner.Status == "active"
            && !eligible.Any(value => value.RoomId == conversation.Value && value.AccessMode == "reply" && !value.Muted))
            return Results.Fail<AgentDeliveryPolicy>("unavailable", "The established private owner conversation is not ready");
        return Result<AgentDeliveryPolicy>.Success(new(target.Value, eligible.Any(value => value.RoomId == conversation.Value) ? conversation.Value : null,
            eligible, senders.Value, policy.Value.MaxMessageBytes, policy.Value.FleetIdleTimeoutSeconds));
    }
}
