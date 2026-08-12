namespace CtlFlow.Identity.Identityd.Db.Sqlite;

internal static partial class SqliteIdentityMutations
{
    private static readonly SemaphoreSlim MutationLock = new(1, 1);

    internal static async ValueTask<IAsyncDisposable> AcquireIdentityMutation(
        CancellationToken cancellation)
    {
        await MutationLock.WaitAsync(cancellation);
        return new MutationLease(MutationLock);
    }

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
