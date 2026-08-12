using CtlFlow.Identity.Identityd.Db.Providers;
using CtlFlow.Identity.Identityd.Domain.Auditing;
using CtlFlow.Identity.Identityd.Domain.Mutations;
using CtlFlow.Identity.Identityd.Domain.Principals;
using CtlFlow.Identity.Identityd.Domain.Resources;
using CtlFlow.Identity.Identityd.Domain.Targets;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Identity.Identityd.Db.Principals;

public static partial class Principals
{
    public static async Task<IdentityMutation<VirtualPrincipal>>
        SetVirtualPrincipalEnabled(
            IdentityDatabase identityDatabase,
            VirtualPrincipalId principalId,
            IdentityTarget fence,
            Revision expectedRevision,
            bool enabled,
            AuditContext audit,
            CancellationToken cancellation)
    {
        await using var mutation =
            await identityDatabase.AcquireMutation(cancellation);
        using var activity = IdentityDbTelemetry.StartOperation(
            "set_virtual_principal_enabled");
        await using var database =
            await identityDatabase.Contexts.CreateDbContextAsync(cancellation);
        var principalValue = principalId.Value;
        var queryCancellation = cancellation;
        var principal = await database.VirtualPrincipals.SingleOrDefaultAsync(
            candidate => EF.Property<string>(candidate, "_id")
                == principalValue,
            queryCancellation);
        var result =
            await Domain.Principals.Principals.SetVirtualPrincipalEnabled(
                principal,
                fence,
                expectedRevision,
                enabled,
                audit,
                cancellation);
        if (result.AuditIntent is not null)
        {
            await database.SaveChangesAsync(cancellation);
        }

        return result;
    }
}
