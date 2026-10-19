using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;

namespace Crossfire.AdapterSqlite;

public static class RegistrationQueries
{
    public static Result<MemberInvitation?> Claim(CrossfireDbContext context, string backendUserId)
        => Stored.Read(() => context.MemberInvitation.AsNoTracking().Where(row => row.ClaimBackendUserId == backendUserId)
            .Select(row => new MemberInvitation(row.Id, row.CreatedByMemberId, row.ClaimHash, row.RoleCode, row.PrincipalKind, row.CreatedAt, row.ExpiresAt,
                row.ConsumedByMemberId, row.RevokedAt, row.ClaimBackendUserId, row.ClaimDisplayName, row.ClaimFingerprint)).FirstOrDefault());

    public static Result<IReadOnlyList<MemberInvitation>> Abandoned(CrossfireDbContext context, long now)
        => Stored.Read<IReadOnlyList<MemberInvitation>>(() => context.MemberInvitation.AsNoTracking().Where(row => row.ClaimBackendUserId != null && row.ConsumedByMemberId == null
            && (row.RevokedAt != null || row.ExpiresAt <= now)).OrderBy(row => row.Id).Take(100)
            .Select(row => new MemberInvitation(row.Id, row.CreatedByMemberId, row.ClaimHash, row.RoleCode, row.PrincipalKind, row.CreatedAt, row.ExpiresAt,
                row.ConsumedByMemberId, row.RevokedAt, row.ClaimBackendUserId, row.ClaimDisplayName, row.ClaimFingerprint)).ToArray());

    public static MemberRegistrationPorts Ports(CrossfireDbContext context, Func<long> now, MessagingPorts messaging, RoomOperation operation)
        => new(InvitationCommands.Ports(context, now), messaging, operation, id => MemberQueries.ByBackendUserId(context, id), id => Claim(context, id),
            (principal, role, assignedBy, name) => MemberCommands.Register(context, principal, new(principal.Id, "human", role, assignedBy, now()), PrincipalValues.Pending(principal.Id, now()), new(principal.Id, "human", name)),
            timestamp => Abandoned(context, timestamp));
}
