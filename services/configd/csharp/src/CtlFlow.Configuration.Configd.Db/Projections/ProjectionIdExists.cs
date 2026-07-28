using CtlFlow.Configuration.Configd.Db.Providers;
using CtlFlow.Configuration.Configd.Domain.Identifiers;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Configuration.Configd.Db.Projections;

public static partial class Projections
{
    internal static async Task<bool> ProjectionIdExists(
        ConfigurationDatabase configurationDatabase,
        ProjectionId projectionId,
        CancellationToken cancellation)
    {
        await using var database =
            await configurationDatabase.Contexts.CreateDbContextAsync(
                cancellation);
        var id = projectionId.Value;
        var queryCancellation = cancellation;
        return await database.Projections
            .AsNoTracking()
            .AnyAsync(
                value =>
                    EF.Property<string>(value, "_projectionId") == id,
                queryCancellation);
    }
}
