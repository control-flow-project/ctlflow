using System.Buffers;
using System.Net;

namespace CtlFlow.Egress.Egressd.Service.Proxy;

internal sealed class BoundedRequestContent(
    Stream source,
    long? declaredLength,
    long maximumBytes) : HttpContent
{
    private int _exceededMaximum;
    private readonly TaskCompletionSource _completion =
        new(TaskCreationOptions.RunContinuationsAsynchronously);

    internal bool ExceededMaximum =>
        Volatile.Read(ref _exceededMaximum) != 0;

    internal Task Completion => _completion.Task;

    protected override bool TryComputeLength(out long length)
    {
        if (declaredLength is { } value)
        {
            length = value;
            return true;
        }
        length = 0;
        return false;
    }

    protected override Task SerializeToStreamAsync(
        Stream stream,
        TransportContext? context) =>
        CopyToStream(stream, CancellationToken.None);

    protected override Task SerializeToStreamAsync(
        Stream stream,
        TransportContext? context,
        CancellationToken cancellationToken) =>
        CopyToStream(stream, cancellationToken);

    private async Task CopyToStream(
        Stream destination,
        CancellationToken cancellation)
    {
        var buffer = ArrayPool<byte>.Shared.Rent(64 * 1024);
        long total = 0;
        try
        {
            while (true)
            {
                var read = await source.ReadAsync(
                    buffer.AsMemory(0, buffer.Length),
                    cancellation);
                if (read == 0)
                {
                    return;
                }
                total += read;
                if (total > maximumBytes)
                {
                    Volatile.Write(ref _exceededMaximum, 1);
                    throw new RequestBodyTooLargeException();
                }
                await destination.WriteAsync(
                    buffer.AsMemory(0, read),
                    cancellation);
            }
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buffer);
            _completion.TrySetResult();
        }
    }
}
