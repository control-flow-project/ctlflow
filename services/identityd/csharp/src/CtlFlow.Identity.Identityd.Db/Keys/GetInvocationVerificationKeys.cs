using CtlFlow.Identity.Identityd.Db.Providers;
using CtlFlow.Identity.Identityd.Domain.Keys;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Identity.Identityd.Domain.Keys.VerificationKeys;

namespace CtlFlow.Identity.Identityd.Db.Keys;

public static partial class VerificationKeys
{
    public static async Task<VerificationKeySet>
        GetInvocationVerificationKeys(
            IdentityDatabase identityDatabase,
            CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var activity = IdentityDbTelemetry.StartOperation(
            "get_invocation_verification_keys");
        await using var database =
            await identityDatabase.Contexts.CreateDbContextAsync(cancellation);
        var queryCancellation = cancellation;
        var rows = await database.InvocationVerificationKeys
            .AsNoTracking()
            .OrderBy(key => EF.Property<string>(key, "_id"))
            .Select(key => new
            {
                Id = EF.Property<string>(key, "_id"),
                key.Algorithm,
                Modulus = EF.Property<string>(key, "_modulus"),
                Exponent = EF.Property<string>(key, "_exponent"),
                key.State,
                key.Revision
            })
            .Take(9)
            .ToListAsync(queryCancellation);
        var candidates = rows.Select(row => new VerificationKeyDetails(
            VerificationKeyId.FromStorage(row.Id),
            row.Algorithm,
            RsaModulus.FromStorage(row.Modulus),
            RsaExponent.FromStorage(row.Exponent),
            row.State,
            row.Revision)).ToArray();
        return await CreateVerificationKeySet(candidates, cancellation);
    }
}
