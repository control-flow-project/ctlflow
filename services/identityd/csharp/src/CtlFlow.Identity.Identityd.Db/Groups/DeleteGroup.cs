using CtlFlow.Identity.Identityd.Db.Providers;
using CtlFlow.Identity.Identityd.Domain.Auditing;
using CtlFlow.Identity.Identityd.Domain.Groups;
using CtlFlow.Identity.Identityd.Domain.Mutations;
using CtlFlow.Identity.Identityd.Domain.Targets;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Identity.Identityd.Db.Groups;

public static partial class Groups
{
    public static async Task<IdentityRemoval> DeleteGroup(
        IdentityDatabase identityDatabase,
        GroupId groupId,
        IdentityTarget target,
        AuditContext audit,
        CancellationToken cancellation)
    {
        await using var mutation =
            await identityDatabase.AcquireMutation(cancellation);
        using var activity = IdentityDbTelemetry.StartOperation("delete_group");
        await using var database =
            await identityDatabase.Contexts.CreateDbContextAsync(cancellation);
        var groupValue = groupId.Value;
        var queryCancellation = cancellation;
        var existing = await database.Groups.SingleOrDefaultAsync(
            candidate => EF.Property<string>(candidate, "_id") == groupValue,
            queryCancellation);
        var result = await Domain.Groups.Groups.DeleteGroup(
            existing,
            groupId,
            target,
            audit,
            cancellation);
        if (result.AuditIntent is null)
        {
            return result;
        }

        var accountMembers = await database.AccountGroupMemberships
            .Where(candidate => EF.Property<string>(candidate, "_groupId")
                == groupValue)
            .ToListAsync(queryCancellation);
        var virtualMembers = await database.VirtualPrincipalGroupMemberships
            .Where(candidate => EF.Property<string>(candidate, "_groupId")
                == groupValue)
            .ToListAsync(queryCancellation);
        database.AccountGroupMemberships.RemoveRange(accountMembers);
        database.VirtualPrincipalGroupMemberships.RemoveRange(virtualMembers);
        database.Groups.Remove(existing!);
        await database.SaveChangesAsync(cancellation);
        return result;
    }
}
