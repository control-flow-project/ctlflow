using Crossfire.AdapterSqlite;
using Microsoft.EntityFrameworkCore.Design;

namespace Crossfire.EfHost;

public sealed class CrossfireDbContextFactory : IDesignTimeDbContextFactory<CrossfireDbContext>
{
    public CrossfireDbContext CreateDbContext(string[] arguments) => new(DatabaseConnections.Options(":memory:"));
}
