using Crossfire.AdapterFilesystem;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Crossfire.AdapterSqlite;

public sealed class ManagementStorage : IDisposable
{
    private readonly ServiceProvider services;
    private readonly IDbContextFactory<CrossfireDbContext> contexts;
    private int disposed;
    public string Database { get; }

    public ManagementStorage(string database)
    {
        Database = PrivateFiles.Database(database);
        services = new ServiceCollection().AddPooledDbContextFactory<CrossfireDbContext>(options => DatabaseConnections.Configure(options, Database)).BuildServiceProvider();
        contexts = services.GetRequiredService<IDbContextFactory<CrossfireDbContext>>();
    }

    public CrossfireDbContext Open()
    {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref disposed) != 0, this);
        PrivateFiles.Database(Database);
        var context = contexts.CreateDbContext();
        try { context.Database.OpenConnection(); return context; }
        catch { context.Dispose(); throw; }
    }

    public void Dispose()
    {
        if (Interlocked.Exchange(ref disposed, 1) == 0) services.Dispose();
    }
}
