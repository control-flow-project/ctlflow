using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public static class InvitationCommands
{
    public static Result<Unit> Insert(CrossfireDbContext context, MemberInvitation invitation)
    {
        context.MemberInvitation.Add(new() { Id = invitation.Id, CreatedByMemberId = invitation.CreatedByMemberId, ClaimHash = invitation.ClaimHash,
            RoleCode = invitation.RoleCode, PrincipalKind = invitation.PrincipalKind, CreatedAt = invitation.CreatedAt, ExpiresAt = invitation.ExpiresAt,
            ConsumedByMemberId = invitation.ConsumedByMemberId, RevokedAt = invitation.RevokedAt, ClaimMatrixUserId = invitation.ClaimMatrixUserId,
            ClaimDisplayName = invitation.ClaimDisplayName, ClaimFingerprint = invitation.ClaimFingerprint });
        context.SaveChanges(); return Results.Done();
    }

    public static Result<Unit> Update(CrossfireDbContext context, MemberInvitation invitation)
    {
        var id = invitation.Id;
        var row = context.MemberInvitation.Single(value => value.Id == id);
        row.CreatedByMemberId = invitation.CreatedByMemberId; row.ClaimHash = invitation.ClaimHash; row.RoleCode = invitation.RoleCode;
        row.PrincipalKind = invitation.PrincipalKind; row.CreatedAt = invitation.CreatedAt; row.ExpiresAt = invitation.ExpiresAt;
        row.ConsumedByMemberId = invitation.ConsumedByMemberId; row.RevokedAt = invitation.RevokedAt;
        row.ClaimMatrixUserId = invitation.ClaimMatrixUserId; row.ClaimDisplayName = invitation.ClaimDisplayName; row.ClaimFingerprint = invitation.ClaimFingerprint;
        context.SaveChanges(); return Results.Done();
    }

    public static InvitationPorts Ports(CrossfireDbContext context, Func<long> now)
        => new(AuthorizationQueries.Ports(context, now), new SqliteUnitOfWork(context), () => PolicyQueries.Find(context),
            id => InvitationQueries.Find(context, id), value => Insert(context, value), value => Update(context, value),
            (page, size, creator) => InvitationQueries.List(context, page, size, creator), intent => MemberCommands.Audit(context, intent, now),
            Identity.Identifier, Identity.Secret, Identity.Hash, Identity.Matches);
}
