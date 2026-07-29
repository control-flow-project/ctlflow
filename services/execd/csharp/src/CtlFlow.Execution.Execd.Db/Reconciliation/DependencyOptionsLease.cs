namespace CtlFlow.Execution.Execd.Db.Reconciliation;

public sealed class DependencyOptionsLease(byte[] content) : IDisposable
{
    private byte[]? _content = content;

    public ReadOnlyMemory<byte> Content =>
        _content
        ?? throw new ObjectDisposedException(
            nameof(DependencyOptionsLease));

    public void Dispose()
    {
        var content = Interlocked.Exchange(ref _content, null);
        if (content is not null)
        {
            Array.Clear(content);
        }
    }
}
