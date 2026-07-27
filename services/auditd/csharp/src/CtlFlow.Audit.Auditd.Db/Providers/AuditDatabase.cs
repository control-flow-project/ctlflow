using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Audit.Auditd.Db.Providers;

public sealed class AuditDatabase : IAsyncDisposable
{
    private readonly AuditMutationCoordinator _mutations;

    internal AuditDatabase(
        IDbContextFactory<AuditDbContext> contexts,
        AuditMutationCoordinator mutations)
    {
        Contexts = contexts;
        _mutations = mutations;
    }

    public IDbContextFactory<AuditDbContext> Contexts { get; }

    internal ValueTask<IAsyncDisposable> AcquireMutation(
        CancellationToken cancellation) =>
        _mutations.Acquire(cancellation);

    public async ValueTask DisposeAsync()
    {
        _mutations.Dispose();
        if (Contexts is IAsyncDisposable asyncDisposable)
        {
            await asyncDisposable.DisposeAsync();
        }
        else if (Contexts is IDisposable disposable)
        {
            disposable.Dispose();
        }
    }
}
