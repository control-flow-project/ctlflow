using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public static class AuthorizationQueries
{
    public static AuthorizationPorts Ports(CrossfireDbContext context, Func<long> now)
        => new(id => Principal(context, id), hash => Session(context, hash), id => Agent(context, id),
            id => AgentView(context, id), id => Binding(context, id),
            (owner, key) => Fleet(context, owner, key), id => Permissions(context, id), now);

    public static Result<Principal?> Principal(CrossfireDbContext context, string id)
        => Stored.Read(() => context.Principal.AsNoTracking().Where(row => row.Id == id)
            .Select(row => new Principal(row.Id, row.MatrixUserId, row.Kind, row.Status, row.Revision, row.CreatedAt)).SingleOrDefault());

    public static Result<MemberSession?> Session(CrossfireDbContext context, string hash)
        => Stored.Read(() => context.MemberSession.AsNoTracking().Where(row => row.SecretHash == hash)
            .Select(row => new MemberSession(row.SecretHash, row.MemberId, row.CsrfSecret, row.NativeAccessToken, row.CreatedAt, row.ExpiresAt)).SingleOrDefault());

    public static Result<Agent?> Agent(CrossfireDbContext context, string id)
        => Stored.Read(() => context.Agent.AsNoTracking().Where(row => row.PrincipalId == id)
            .Select(row => new Agent(row.PrincipalId, row.PrincipalKind, row.OwnerId, row.WakeMode)).SingleOrDefault());

    public static Result<FleetBinding?> Binding(CrossfireDbContext context, string id)
        => Stored.Read(() => context.FleetInstance.AsNoTracking().Where(row => row.AgentId == id)
            .Select(row => new FleetBinding(row.OwnerId, row.FleetKey, row.InstanceKey, row.AgentId, row.RetiredAt)).SingleOrDefault());

    public static Result<FleetIdentity?> Fleet(CrossfireDbContext context, string owner, string key)
        => Stored.Read(() => context.Fleet.AsNoTracking().Where(row => row.OwnerId == owner && row.FleetKey == key)
            .Select(row => new FleetIdentity(row.Id, row.OwnerId, row.FleetKey, row.ArchivedAt)).SingleOrDefault());

    public static Result<IReadOnlyList<string>> Permissions(CrossfireDbContext context, string id)
        => Stored.Read<IReadOnlyList<string>>(() => context.PrincipalRole.AsNoTracking().Where(row => row.PrincipalId == id)
            .Join(context.RolePermission, role => role.RoleCode, permission => permission.RoleCode, (role, permission) => permission.PermissionCode)
            .OrderBy(code => code).ToArray());

    public static Result<AgentView?> AgentView(CrossfireDbContext context, string id)
        => AgentViews(context, [id]).Map(values => values.SingleOrDefault());

    public static Result<IReadOnlyList<AgentView>> AgentViews(CrossfireDbContext context, IReadOnlyList<string> requested)
    {
        var ids = requested.ToArray();
        return Stored.Read<IReadOnlyList<AgentView>>(() => context.Agent.AsNoTracking().Where(row => ids.Contains(row.PrincipalId))
            .Join(context.Principal, agent => agent.PrincipalId, principal => principal.Id, (agent, principal) => new { agent, principal })
            .Join(context.AgentName, joined => joined.agent.PrincipalId, name => name.AgentId, (joined, name) => new { joined.agent, joined.principal, name })
            .Join(context.PrincipalApplication, joined => joined.agent.PrincipalId, application => application.PrincipalId, (joined, application) => new { joined.agent, joined.principal, joined.name, application })
            .Join(context.Principal, joined => joined.agent.OwnerId, owner => owner.Id, (joined, owner) => new { joined.agent, joined.principal, joined.name, joined.application, owner })
            .Join(context.Member, joined => joined.agent.OwnerId, member => member.PrincipalId, (joined, member) => new { joined.agent, joined.principal, joined.name, joined.application, joined.owner, member })
            .Select(joined => new AgentView(new Principal(joined.principal.Id, joined.principal.MatrixUserId, joined.principal.Kind, joined.principal.Status, joined.principal.Revision, joined.principal.CreatedAt),
                new Agent(joined.agent.PrincipalId, joined.agent.PrincipalKind, joined.agent.OwnerId, joined.agent.WakeMode), joined.name.Name,
                new PrincipalApplication(joined.application.PrincipalId, joined.application.AppliedRevision, joined.application.AppliedIntentHash, joined.application.AppliedStatus,
                    joined.application.NativeDisplayName, joined.application.LastAttemptAt, joined.application.LastSuccessAt, joined.application.NextCheckAt, joined.application.ErrorCode, joined.application.ErrorMessage),
                new Principal(joined.owner.Id, joined.owner.MatrixUserId, joined.owner.Kind, joined.owner.Status, joined.owner.Revision, joined.owner.CreatedAt),
                new Member(joined.member.PrincipalId, joined.member.PrincipalKind, joined.member.DisplayName))).ToArray());
    }
}
