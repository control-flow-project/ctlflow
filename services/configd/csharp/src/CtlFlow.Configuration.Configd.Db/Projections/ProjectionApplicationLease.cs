using CtlFlow.Configuration.Configd.Domain.Projections;

namespace CtlFlow.Configuration.Configd.Db.Projections;

public sealed class ProjectionApplicationLease : IAsyncDisposable
{
    private ConfigurationDbContext? _database;
    private IAsyncDisposable? _mutation;

    internal ProjectionApplicationLease(
        ConfigurationDbContext database,
        IAsyncDisposable mutation,
        ProjectionPlan plan,
        ProjectionPayloadLease payload)
    {
        _database = database;
        _mutation = mutation;
        Plan = plan;
        Payload = payload;
    }

    public ProjectionMetadata Projection => Plan switch
    {
        ProjectionPlan.Current current => current.Projection,
        ProjectionPlan.Changed changed => changed.Projection,
        _ => throw new InvalidOperationException(
            "Projection application plan is not ready")
    };

    public ProjectionPayloadLease Payload { get; }

    internal ProjectionPlan Plan { get; }

    internal ConfigurationDbContext Database =>
        _database ?? throw new ObjectDisposedException(
            nameof(ProjectionApplicationLease));

    public async ValueTask DisposeAsync()
    {
        Payload.Dispose();
        var database = Interlocked.Exchange(ref _database, null);
        if (database is not null)
        {
            await database.DisposeAsync();
        }

        var mutation = Interlocked.Exchange(ref _mutation, null);
        if (mutation is not null)
        {
            await mutation.DisposeAsync();
        }
    }
}
