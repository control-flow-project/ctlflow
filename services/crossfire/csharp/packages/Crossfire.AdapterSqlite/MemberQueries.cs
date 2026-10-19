using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public static class MemberQueries
{
    public static Result<Principal?> ByBackendUserId(CrossfireDbContext context, string matrixId)
        => Stored.Read(() => context.Principal.AsNoTracking().Where(row => row.BackendUserId == matrixId)
            .Select(row => new Principal(row.Id, row.BackendUserId, row.Kind, row.Status, row.Revision, row.CreatedAt)).SingleOrDefault());

    public static Result<MemberView?> Find(CrossfireDbContext context, string id)
        => Stored.Read(() => context.Member.AsNoTracking().Where(row => row.PrincipalId == id)
            .Join(context.Principal, member => member.PrincipalId, principal => principal.Id, (member, principal) => new { member, principal })
            .Join(context.PrincipalRole, joined => joined.member.PrincipalId, role => role.PrincipalId, (joined, role) => new { joined.member, joined.principal, role })
            .Join(context.PrincipalApplication, joined => joined.member.PrincipalId, application => application.PrincipalId, (joined, application) =>
                new MemberView(new Principal(joined.principal.Id, joined.principal.BackendUserId, joined.principal.Kind, joined.principal.Status, joined.principal.Revision, joined.principal.CreatedAt),
                    new Member(joined.member.PrincipalId, joined.member.PrincipalKind, joined.member.DisplayName),
                    new PrincipalRole(joined.role.PrincipalId, joined.role.PrincipalKind, joined.role.RoleCode, joined.role.AssignedByMemberId, joined.role.AssignedAt),
                    new PrincipalApplication(application.PrincipalId, application.AppliedRevision, application.AppliedIntentHash, application.AppliedStatus, application.NativeDisplayName,
                        application.LastAttemptAt, application.LastSuccessAt, application.NextCheckAt, application.ErrorCode, application.ErrorMessage))).SingleOrDefault());

    public static Result<Page<MemberView>> List(CrossfireDbContext context, int page, int pageSize)
    {
        var offset = checked((page - 1) * pageSize);
        var count = Stored.Read(() => context.Member.LongCount());
        if (!count.IsSuccess) return Result<Page<MemberView>>.Fail(count.Error);
        var records = Stored.Read(() => context.Member.AsNoTracking()
            .Join(context.Principal, member => member.PrincipalId, principal => principal.Id, (member, principal) => new { member, principal })
            .Join(context.PrincipalRole, joined => joined.member.PrincipalId, role => role.PrincipalId, (joined, role) => new { joined.member, joined.principal, role })
            .Join(context.PrincipalApplication, joined => joined.member.PrincipalId, application => application.PrincipalId, (joined, application) => new { joined.member, joined.principal, joined.role, application })
            .OrderBy(joined => joined.principal.CreatedAt).ThenBy(joined => joined.principal.Id).Skip(offset).Take(pageSize)
            .Select(joined => new MemberView(new Principal(joined.principal.Id, joined.principal.BackendUserId, joined.principal.Kind, joined.principal.Status, joined.principal.Revision, joined.principal.CreatedAt),
                new Member(joined.member.PrincipalId, joined.member.PrincipalKind, joined.member.DisplayName),
                new PrincipalRole(joined.role.PrincipalId, joined.role.PrincipalKind, joined.role.RoleCode, joined.role.AssignedByMemberId, joined.role.AssignedAt),
                new PrincipalApplication(joined.application.PrincipalId, joined.application.AppliedRevision, joined.application.AppliedIntentHash, joined.application.AppliedStatus,
                    joined.application.NativeDisplayName, joined.application.LastAttemptAt, joined.application.LastSuccessAt, joined.application.NextCheckAt,
                    joined.application.ErrorCode, joined.application.ErrorMessage))).ToArray());
        return records.Map(values => new Page<MemberView>(values, page, pageSize, count.Value));
    }

    public static Result<long> Administrators(CrossfireDbContext context)
        => Stored.Read(() => context.PrincipalRole.AsNoTracking().Where(row => row.RoleCode == "administrator")
            .Join(context.Principal, role => role.PrincipalId, principal => principal.Id, (role, principal) => principal)
            .Where(principal => principal.Status == "active").LongCount());
}
