using System.Globalization;
using CtlFlow.Tenancy.Tenantd.Db.Sqlite;

namespace CtlFlow.Tenancy.Tenantd.Db.Providers;

public static partial class TenantDatabaseProviders
{
    public static async ValueTask<DatabaseConfiguration> ParseDatabaseConfiguration(
        string provider,
        string location,
        string poolSize,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (!string.Equals(provider, "sqlite", StringComparison.Ordinal))
        {
            throw new ArgumentException(
                "Database provider must name an implemented provider",
                nameof(provider));
        }

        if (!int.TryParse(
                poolSize,
                NumberStyles.None,
                CultureInfo.InvariantCulture,
                out var parsedPoolSize))
        {
            throw new ArgumentException(
                "Database pool size must be an integer",
                nameof(poolSize));
        }

        return new DatabaseConfiguration.Sqlite(
            await DatabaseFilePath.Parse(location, cancellation),
            await DatabasePoolSize.Parse(parsedPoolSize, cancellation));
    }
}
