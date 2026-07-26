using CtlFlow.Tenancy.Tenantd.Domain.Tenants;

namespace CtlFlow.Tenancy.Tenantd.Db.Sqlite;

internal static partial class SqliteTenantMutations
{
    private const int LockCount = 64;
    private static readonly SemaphoreSlim[] MutationLocks = CreateLocks();

    internal static async ValueTask<IAsyncDisposable> AcquireTenantMutation(
        TenantId tenantId,
        CancellationToken cancellation)
    {
        var gate = MutationLocks[GetLockIndex(tenantId)];
        await gate.WaitAsync(cancellation);
        return new MutationLease(gate);
    }

    private static SemaphoreSlim[] CreateLocks()
    {
        var locks = new SemaphoreSlim[LockCount];
        for (var index = 0; index < locks.Length; index++)
        {
            locks[index] = new SemaphoreSlim(1, 1);
        }

        return locks;
    }

    private static int GetLockIndex(TenantId tenantId)
    {
        const uint offset = 2_166_136_261;
        const uint prime = 16_777_619;
        var hash = offset;
        foreach (var character in tenantId.Value)
        {
            hash = unchecked((hash ^ character) * prime);
        }

        return (int)(hash & (LockCount - 1));
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
