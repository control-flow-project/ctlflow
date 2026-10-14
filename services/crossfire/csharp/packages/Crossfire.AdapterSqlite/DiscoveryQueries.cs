using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public static class DiscoveryQueries
{
    public static Result<Page<PrincipalSummary>> Principals(CrossfireDbContext context, DiscoveryRequest input)
        => Stored.Read(() =>
        {
            var search = input.Search.ToLowerInvariant(); var exclude = input.ExcludeId ?? "";
            var humans = input.Kind == "agent" ? 0 : context.Member.AsNoTracking()
                .Join(context.Principal.Where(row => row.Status == "active"), member => member.PrincipalId, principal => principal.Id, (member, principal) => new { member, principal })
                .LongCount(joined => joined.principal.Id != exclude && (joined.principal.MatrixUserId.ToLower().Contains(search) || joined.member.DisplayName.ToLower().Contains(search)));
            var agents = input.Kind == "human" ? 0 : context.Agent.AsNoTracking()
                .Join(context.Principal.Where(row => row.Status == "active"), agent => agent.PrincipalId, principal => principal.Id, (agent, principal) => new { agent, principal })
                .Join(context.FleetInstance.Where(row => row.RetiredAt == null), joined => joined.agent.PrincipalId, instance => instance.AgentId, (joined, instance) => new { joined.agent, joined.principal, instance })
                .Join(context.Fleet.Where(row => row.ArchivedAt == null), joined => joined.agent.OwnerId, fleet => fleet.OwnerId, (joined, fleet) => new { joined.agent, joined.principal, joined.instance, fleet })
                .Join(context.AgentName, joined => joined.agent.PrincipalId, name => name.AgentId, (joined, name) => new { joined.agent, joined.principal, joined.instance, joined.fleet, name })
                .Join(context.Principal.Where(row => row.Status == "active"), joined => joined.agent.OwnerId, owner => owner.Id, (joined, owner) => new { joined.agent, joined.principal, joined.instance, joined.fleet, joined.name, owner })
                .LongCount(joined => joined.instance.FleetKey == joined.fleet.FleetKey && joined.principal.Id != exclude
                    && (joined.principal.MatrixUserId.ToLower().Contains(search) || joined.name.Name.ToLower().Contains(search)));
            var offset = checked((input.Page - 1) * input.PageSize); var humanLimit = (int)Math.Min(input.PageSize, Math.Max(0, humans - offset));
            var entries = new List<PrincipalSummary>();
            if (humanLimit != 0) entries.AddRange(context.Member.AsNoTracking()
                .Join(context.Principal.Where(row => row.Status == "active"), member => member.PrincipalId, principal => principal.Id, (member, principal) => new { member, principal })
                .Where(joined => joined.principal.Id != exclude && (joined.principal.MatrixUserId.ToLower().Contains(search) || joined.member.DisplayName.ToLower().Contains(search)))
                .OrderBy(joined => joined.member.DisplayName).ThenBy(joined => joined.principal.Id).Skip(offset).Take(humanLimit)
                .Select(joined => new PrincipalSummary(joined.principal.Id, joined.principal.MatrixUserId, joined.principal.Kind, joined.member.DisplayName, joined.principal.Id, joined.principal.MatrixUserId)).ToArray());
            if (input.Kind != "human" && entries.Count < input.PageSize)
            {
                var agentOffset = (int)Math.Max(0, offset - humans); var agentLimit = input.PageSize - entries.Count;
                entries.AddRange(context.Agent.AsNoTracking()
                    .Join(context.Principal.Where(row => row.Status == "active"), agent => agent.PrincipalId, principal => principal.Id, (agent, principal) => new { agent, principal })
                    .Join(context.FleetInstance.Where(row => row.RetiredAt == null), joined => joined.agent.PrincipalId, instance => instance.AgentId, (joined, instance) => new { joined.agent, joined.principal, instance })
                    .Join(context.Fleet.Where(row => row.ArchivedAt == null), joined => joined.agent.OwnerId, fleet => fleet.OwnerId, (joined, fleet) => new { joined.agent, joined.principal, joined.instance, fleet })
                    .Join(context.AgentName, joined => joined.agent.PrincipalId, name => name.AgentId, (joined, name) => new { joined.agent, joined.principal, joined.instance, joined.fleet, name })
                    .Join(context.Principal.Where(row => row.Status == "active"), joined => joined.agent.OwnerId, owner => owner.Id, (joined, owner) => new { joined.agent, joined.principal, joined.instance, joined.fleet, joined.name, owner })
                    .Join(context.Member, joined => joined.agent.OwnerId, member => member.PrincipalId, (joined, member) => new { joined.agent, joined.principal, joined.instance, joined.fleet, joined.name, joined.owner, member })
                    .Where(joined => joined.instance.FleetKey == joined.fleet.FleetKey && joined.principal.Id != exclude
                        && (joined.principal.MatrixUserId.ToLower().Contains(search) || joined.name.Name.ToLower().Contains(search)))
                    .OrderBy(joined => joined.name.Name).ThenBy(joined => joined.principal.Id).Skip(agentOffset).Take(agentLimit)
                    .Select(joined => new PrincipalSummary(joined.principal.Id, joined.principal.MatrixUserId, joined.principal.Kind,
                        joined.name.Name + " (" + joined.member.DisplayName + ")", joined.agent.OwnerId, joined.owner.MatrixUserId)).ToArray());
            }
            return new Page<PrincipalSummary>(entries, input.Page, input.PageSize, checked(humans + agents));
        });

    public static Result<IReadOnlyList<PrincipalIdentity>> Identities(CrossfireDbContext context, IReadOnlyList<string> selected)
        => Stored.Read<IReadOnlyList<PrincipalIdentity>>(() =>
        {
            var ids = selected.ToArray();
            var humans = context.Member.AsNoTracking().Join(context.Principal, member => member.PrincipalId, principal => principal.Id, (member, principal) => new { member, principal })
                .Where(joined => ids.Contains(joined.principal.MatrixUserId)).Select(joined => new PrincipalIdentity(joined.principal.MatrixUserId, "human", null, joined.member.DisplayName, null)).ToArray();
            var agents = context.Agent.AsNoTracking().Join(context.Principal, agent => agent.PrincipalId, principal => principal.Id, (agent, principal) => new { agent, principal })
                .Join(context.AgentName, joined => joined.agent.PrincipalId, name => name.AgentId, (joined, name) => new { joined.agent, joined.principal, name })
                .Join(context.Principal, joined => joined.agent.OwnerId, owner => owner.Id, (joined, owner) => new { joined.agent, joined.principal, joined.name, owner })
                .Join(context.Member, joined => joined.agent.OwnerId, member => member.PrincipalId, (joined, member) => new { joined.agent, joined.principal, joined.name, joined.owner, member })
                .Where(joined => ids.Contains(joined.principal.MatrixUserId)).Select(joined => new PrincipalIdentity(joined.principal.MatrixUserId, "agent", joined.owner.MatrixUserId,
                    joined.name.Name + " (" + joined.member.DisplayName + ")", joined.member.DisplayName)).ToArray();
            return [.. humans, .. agents];
        });

    public static Result<IReadOnlyList<PrincipalSummary>> Selected(CrossfireDbContext context, IReadOnlyList<string> selected)
        => Stored.Read<IReadOnlyList<PrincipalSummary>>(() =>
        {
            var ids = selected.ToArray();
            var humans = context.Member.AsNoTracking().Join(context.Principal, member => member.PrincipalId, principal => principal.Id, (member, principal) => new { member, principal })
                .Where(joined => ids.Contains(joined.principal.Id)).Select(joined => new PrincipalSummary(joined.principal.Id, joined.principal.MatrixUserId, "human",
                    joined.member.DisplayName, joined.principal.Id, joined.principal.MatrixUserId)).ToArray();
            var agents = context.Agent.AsNoTracking().Join(context.Principal, agent => agent.PrincipalId, principal => principal.Id, (agent, principal) => new { agent, principal })
                .Join(context.AgentName, joined => joined.agent.PrincipalId, name => name.AgentId, (joined, name) => new { joined.agent, joined.principal, name })
                .Join(context.Principal, joined => joined.agent.OwnerId, owner => owner.Id, (joined, owner) => new { joined.agent, joined.principal, joined.name, owner })
                .Join(context.Member, joined => joined.agent.OwnerId, member => member.PrincipalId, (joined, member) => new { joined.agent, joined.principal, joined.name, joined.owner, member })
                .Where(joined => ids.Contains(joined.principal.Id)).Select(joined => new PrincipalSummary(joined.principal.Id, joined.principal.MatrixUserId, "agent",
                    joined.name.Name + " (" + joined.member.DisplayName + ")", joined.agent.OwnerId, joined.owner.MatrixUserId)).ToArray();
            return humans.Concat(agents).OrderBy(value => value.PrincipalId, StringComparer.Ordinal).ToArray();
        });

    public static Result<IReadOnlyList<Role>> Roles(CrossfireDbContext context, string kind)
        => Stored.Read<IReadOnlyList<Role>>(() => context.Role.AsNoTracking().Where(row => row.PrincipalKind == kind).OrderBy(row => row.Code)
            .Select(row => new Role(row.Code, row.PrincipalKind, row.Label)).ToArray());

    public static Result<IReadOnlyList<Permission>> Permissions(CrossfireDbContext context)
        => Stored.Read<IReadOnlyList<Permission>>(() => context.Permission.AsNoTracking().OrderBy(row => row.Code)
            .Select(row => new Permission(row.Code, row.GrantScope, row.Description)).ToArray());

    public static DiscoveryPorts Ports(CrossfireDbContext context, Func<long> now)
        => new(AuthorizationQueries.Ports(context, now), input => Principals(context, input), ids => Identities(context, ids), ids => Selected(context, ids),
            kind => Roles(context, kind), () => Permissions(context));
}
