using System.Buffers;

namespace CtlFlow.Edge.Edged.Service.Proxy;

internal static partial class ApplicationProxy
{
    internal static async Task CopyResponseBody(
        Stream source,
        HttpContext context,
        long maximumBytes,
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
                    throw new ResponseBodyTooLargeException();
                }

                await context.Response.Body.WriteAsync(
                    buffer.AsMemory(0, read),
                    cancellation);
                await context.Response.Body.FlushAsync(cancellation);
            }
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buffer);
        }
    }
}
