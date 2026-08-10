using CtlFlow.Identity.Identityd.Db.Providers;
using CtlFlow.Identity.Identityd.Domain.Accounts;
using CtlFlow.Identity.Identityd.Domain.Auditing;
using CtlFlow.Identity.Identityd.Domain.Mutations;
using CtlFlow.Identity.Identityd.Domain.Principals;
using CtlFlow.Identity.Identityd.Domain.Targets;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Identity.Identityd.Db.Principals;

public static partial class Principals
{
    public static async Task<IdentityMutation<VirtualPrincipal>>
        CreateVirtualPrincipal(
            IdentityDatabase identityDatabase,
            VirtualPrincipalId principalId,
            AccountId subjectAccountId,
            IdentityTarget fence,
            AuditContext audit,
            CancellationToken cancellation)
    {
        await using var mutation = await identityDatabase.AcquireMutation(
            $"virtual-principal:{principalId.Value}",
            cancellation);
        using var activity = IdentityDbTelemetry.StartOperation(
            "create_virtual_principal");
        await using var database =
            await identityDatabase.Contexts.CreateDbContextAsync(cancellation);
        var principalValue = principalId.Value;
        var queryCancellation = cancellation;
        var existing = await database.VirtualPrincipals.SingleOrDefaultAsync(
            candidate => EF.Property<string>(candidate, "_id")
                == principalValue,
            queryCancellation);
        var subject = await PrincipalQueries.LoadPrincipalFacts(
            identityDatabase,
            subjectAccountId.Principal,
            fence,
            cancellation);
        var result =
            await Domain.Principals.Principals.CreateVirtualPrincipal(
                existing,
                subject,
                principalId,
                subjectAccountId,
                fence,
                audit,
                cancellation);
        database.VirtualPrincipals.Add(result.Value);
        await database.SaveChangesAsync(cancellation);
        return result;
    }
}
