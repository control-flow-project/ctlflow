using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public static class InvitationQueries
{
    public static Result<MemberInvitation?> Find(CrossfireDbContext context, string id)
        => Stored.Read(() => context.MemberInvitation.AsNoTracking().Where(row => row.Id == id)
            .Select(row => new MemberInvitation(row.Id, row.CreatedByMemberId, row.ClaimHash, row.RoleCode, row.PrincipalKind, row.CreatedAt,
                row.ExpiresAt, row.ConsumedByMemberId, row.RevokedAt, row.ClaimMatrixUserId, row.ClaimDisplayName, row.ClaimFingerprint)).SingleOrDefault());

    public static Result<Page<MemberInvitation>> List(CrossfireDbContext context, int page, int pageSize, string? creator)
    {
        var offset = checked((page - 1) * pageSize);
        var count = Stored.Read(() => context.MemberInvitation.Where(row => creator == null || row.CreatedByMemberId == creator).LongCount());
        if (!count.IsSuccess) return Result<Page<MemberInvitation>>.Fail(count.Error);
        return Stored.Read(() => context.MemberInvitation.AsNoTracking().Where(row => creator == null || row.CreatedByMemberId == creator)
            .OrderByDescending(row => row.CreatedAt).ThenBy(row => row.Id).Skip(offset).Take(pageSize)
            .Select(row => new MemberInvitation(row.Id, row.CreatedByMemberId, row.ClaimHash, row.RoleCode, row.PrincipalKind, row.CreatedAt,
                row.ExpiresAt, row.ConsumedByMemberId, row.RevokedAt, row.ClaimMatrixUserId, row.ClaimDisplayName, row.ClaimFingerprint)).ToArray())
            .Map(values => new Page<MemberInvitation>(values, page, pageSize, count.Value));
    }
}
