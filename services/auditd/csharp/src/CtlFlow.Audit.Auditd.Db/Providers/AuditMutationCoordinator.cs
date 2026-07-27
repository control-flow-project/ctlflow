namespace CtlFlow.Audit.Auditd.Db.Providers;

internal sealed class AuditMutationCoordinator : IDisposable
{
    private readonly SemaphoreSlim _gate = new(1, 1);

    internal async ValueTask<IAsyncDisposable> Acquire(
        CancellationToken cancellation)
    {
        await _gate.WaitAsync(cancellation);
        return new MutationLease(_gate);
    }

    public void Dispose() => _gate.Dispose();

    private sealed class MutationLease(SemaphoreSlim gate) : IAsyncDisposable
    {
        private SemaphoreSlim? _gate = gate;

        public ValueTask DisposeAsync()
        {
            Interlocked.Exchange(ref _gate, null)?.Release();
            return ValueTask.CompletedTask;
        }
    }
}
