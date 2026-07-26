using CtlFlow.Identity.Identityd.Domain.Sessions;

namespace CtlFlow.Identity.Identityd.Db.Sqlite;

internal static partial class SqliteSessionMutations
{
    private const int LockCount = 64;
    private static readonly SemaphoreSlim[] MutationLocks = CreateLocks();

    internal static async ValueTask<IAsyncDisposable> AcquireSessionMutation(
        SessionCredentialDigest credentialDigest,
        CancellationToken cancellation)
    {
        var gate = MutationLocks[GetLockIndex(credentialDigest)];
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

    private static int GetLockIndex(
        SessionCredentialDigest credentialDigest)
    {
        const uint offset = 2_166_136_261;
        const uint prime = 16_777_619;
        var hash = offset;
        foreach (var character in credentialDigest.Value)
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
