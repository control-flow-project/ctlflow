using CtlFlow.Configuration.Configd.Db.Providers;
using CtlFlow.Configuration.Configd.Domain.Identifiers;
using CtlFlow.Configuration.Configd.Domain.Projections;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Configuration.Configd.Db.Projections;

public static partial class Projections
{
    internal static async Task<bool> ProjectionTargetWasSelected(
        ConfigurationDatabase configurationDatabase,
        ProjectionId projectionId,
        ProjectionTarget target,
        CancellationToken cancellation)
    {
        await using var database =
            await configurationDatabase.Contexts.CreateDbContextAsync(
                cancellation);
        var id = projectionId.Value;
        var versionId = target switch
        {
            ProjectionTarget.Configuration configuration =>
                configuration.VersionId.Value,
            ProjectionTarget.Secret secret => secret.VersionId.Value,
            _ => throw new InvalidOperationException(
                "Projection target is invalid")
        };
        var queryCancellation = cancellation;
        return await database.ProjectionTargets
            .AsNoTracking()
            .AnyAsync(
                value =>
                    EF.Property<string>(value, "_projectionId") == id
                    && EF.Property<string>(value, "_targetVersionId")
                        == versionId,
                queryCancellation);
    }
}
