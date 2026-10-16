using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public static class AgentDirectoryQueries
{
    public static Result<Page<string>> Page(CrossfireDbContext context, AgentDirectoryFilter input, long now)
    {
        var reporting = input.Listener == "all" ? Result<IReadOnlyList<string>>.Success([]) : Reporting(context, now, false);
        if (!reporting.IsSuccess) return Result<Page<string>>.Fail(reporting.Error);
        var online = input.Listener is "online" or "disconnecting" ? Reporting(context, now, true) : Result<IReadOnlyList<string>>.Success([]);
        if (!online.IsSuccess) return Result<Page<string>>.Fail(online.Error);
        var activity = (input.Listener == "online" ? online.Value : input.Listener == "disconnecting" ? reporting.Value.Except(online.Value, StringComparer.Ordinal) : reporting.Value).ToArray();
        var include = input.Listener is "online" or "disconnecting"; var exclude = input.Listener == "offline";
        var selected = input.AgentIds?.ToArray() ?? []; var hasSelection = input.AgentIds is not null;
        var statuses = input.Statuses.ToArray(); var search = "%" + input.Search + "%"; var owner = input.OwnerId; var offset = checked((input.Page - 1) * input.PageSize); var size = input.PageSize;
        var count = Stored.Read(() => context.Agent.AsNoTracking().Join(context.Principal, agent => agent.PrincipalId, principal => principal.Id, (agent, principal) => new { agent, principal })
            .Join(context.AgentName, joined => joined.agent.PrincipalId, name => name.AgentId, (joined, name) => new { joined.agent, joined.principal, name })
            .Join(context.FleetInstance.Where(row => row.RetiredAt == null), joined => joined.agent.PrincipalId, instance => instance.AgentId, (joined, instance) => new { joined.agent, joined.principal, joined.name, instance })
            .Join(context.Fleet.Where(row => row.ArchivedAt == null), joined => joined.agent.OwnerId, fleet => fleet.OwnerId, (joined, fleet) => new { joined.agent, joined.principal, joined.name, joined.instance, fleet })
            .Where(joined => joined.instance.FleetKey == joined.fleet.FleetKey && (owner == null || joined.agent.OwnerId == owner) && statuses.Contains(joined.principal.Status)
                && (!hasSelection || selected.Contains(joined.agent.PrincipalId)) && (!include || joined.principal.Status == "active" && activity.Contains(joined.agent.PrincipalId)) && (!exclude || joined.principal.Status != "active" || !activity.Contains(joined.agent.PrincipalId))
                && (EF.Functions.Like(joined.principal.MatrixUserId, search) || EF.Functions.Like(joined.name.Name, search))).LongCount());
        if (!count.IsSuccess) return Result<Page<string>>.Fail(count.Error);
        return Stored.Read(() => context.Agent.AsNoTracking().Join(context.Principal, agent => agent.PrincipalId, principal => principal.Id, (agent, principal) => new { agent, principal })
            .Join(context.AgentName, joined => joined.agent.PrincipalId, name => name.AgentId, (joined, name) => new { joined.agent, joined.principal, name })
            .Join(context.FleetInstance.Where(row => row.RetiredAt == null), joined => joined.agent.PrincipalId, instance => instance.AgentId, (joined, instance) => new { joined.agent, joined.principal, joined.name, instance })
            .Join(context.Fleet.Where(row => row.ArchivedAt == null), joined => joined.agent.OwnerId, fleet => fleet.OwnerId, (joined, fleet) => new { joined.agent, joined.principal, joined.name, joined.instance, fleet })
            .Where(joined => joined.instance.FleetKey == joined.fleet.FleetKey && (owner == null || joined.agent.OwnerId == owner) && statuses.Contains(joined.principal.Status)
                && (!hasSelection || selected.Contains(joined.agent.PrincipalId)) && (!include || joined.principal.Status == "active" && activity.Contains(joined.agent.PrincipalId)) && (!exclude || joined.principal.Status != "active" || !activity.Contains(joined.agent.PrincipalId))
                && (EF.Functions.Like(joined.principal.MatrixUserId, search) || EF.Functions.Like(joined.name.Name, search)))
            .OrderBy(joined => joined.principal.CreatedAt).ThenBy(joined => joined.principal.Id).Skip(offset).Take(size).Select(joined => joined.agent.PrincipalId).ToArray())
            .Map(values => new Page<string>(values, input.Page, input.PageSize, count.Value));
    }

    public static Result<IReadOnlyList<string>> Reporting(CrossfireDbContext context, long now, bool onlineOnly)
    {
        var since = now - ControllerAdmission.HeartbeatExpiryMs;
        return Stored.Read<IReadOnlyList<string>>(() => context.ListenerRun.AsNoTracking().Where(row => row.StoppedAt == null && row.LastSeenAt > since && (!onlineOnly || row.DisconnectRequestedAt == null))
            .Join(context.FleetInstance.Where(row => row.RetiredAt == null), run => run.AgentId, binding => binding.AgentId, (run, binding) => new { run, binding })
            .Join(context.Fleet.Where(row => row.ArchivedAt == null && row.DeliveryEnabled == 1), joined => joined.run.ControllerFleetId, fleet => fleet.Id, (joined, fleet) => new { joined.run, joined.binding, fleet })
            .Join(context.Principal.Where(row => row.Status == "active"), joined => joined.fleet.OwnerId, owner => owner.Id, (joined, owner) => new { joined.run, joined.binding, joined.fleet })
            .Join(context.FleetConnection.Where(row => row.ClosedAt == null && row.ExpiresAt > now), joined => joined.fleet.Id, connection => connection.FleetId, (joined, connection) => new { joined.run, joined.binding, joined.fleet, connection })
            .Join(context.FleetCredential.Where(row => row.RevokedAt == null), joined => joined.run.ControllerCredentialId, credential => credential.Id, (joined, credential) => new { joined.run, joined.binding, joined.fleet, joined.connection, credential })
            .Where(joined => joined.binding.OwnerId == joined.fleet.OwnerId && joined.binding.FleetKey == joined.fleet.FleetKey && joined.run.ControllerConnectionId == joined.connection.ConnectionId
                && joined.run.ControllerCredentialId == joined.connection.CredentialId && joined.credential.FleetId == joined.fleet.Id)
            .Select(joined => joined.run.AgentId).Distinct().ToArray());
    }

    public static Result<IReadOnlyList<AgentDeployment>> Deployments(CrossfireDbContext context, IReadOnlyList<string> requested)
    {
        var ids = requested.ToArray();
        return Stored.Read<IReadOnlyList<AgentDeployment>>(() => context.FleetInstance.AsNoTracking().Where(row => row.RetiredAt == null && ids.Contains(row.AgentId))
            .Join(context.Fleet.Where(row => row.ArchivedAt == null), instance => instance.OwnerId, fleet => fleet.OwnerId, (instance, fleet) => new { instance, fleet })
            .Where(joined => joined.instance.FleetKey == joined.fleet.FleetKey).OrderBy(joined => joined.instance.AgentId)
            .Select(joined => new AgentDeployment(joined.instance.AgentId, joined.fleet.Id, joined.fleet.FleetKey, joined.fleet.Label, joined.fleet.ControllerName, joined.fleet.UpdatedAt, joined.instance.InstanceKey)).ToArray());
    }
}
