namespace Crossfire.Domain;

public sealed record ActiveIdentity(Principal Principal, string? OwnerId);
public sealed record WakeSender(string SenderPrincipalId, bool IncludeAgents);

public static class WakePolicy
{
    public static IReadOnlyList<string> SenderBackendUserIds(AgentView agent, IReadOnlyList<ActiveIdentity> identities, IReadOnlyList<WakeSender> selected)
    {
        var selectedIds = selected.Select(sender => sender.SenderPrincipalId).ToHashSet(StringComparer.Ordinal);
        var selectedOwners = selected.Where(sender => sender.IncludeAgents).Select(sender => sender.SenderPrincipalId).ToHashSet(StringComparer.Ordinal);
        return identities.Where(identity => identity.Principal.Id != agent.Principal.Id
            && (agent.Agent.WakeMode == "everyone" || agent.Agent.WakeMode == "humans" && identity.Principal.Kind == "human"
                || selectedIds.Contains(identity.Principal.Id)
                || identity.Principal.Kind == "agent" && identity.OwnerId is not null && selectedOwners.Contains(identity.OwnerId)))
            .Select(identity => identity.Principal.BackendUserId).Order(StringComparer.Ordinal).ToArray();
    }
}
