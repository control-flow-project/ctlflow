namespace CtlFlow.Execution.Execd.Service.Kubernetes;

internal static partial class KubernetesApis
{
    private const int MaximumKubernetesResponseBytes = 1_048_576;

    private static async Task<byte[]> ReadBoundedResponse(
        HttpContent content,
        CancellationToken cancellation)
    {
        if (content.Headers.ContentLength
            is > MaximumKubernetesResponseBytes)
        {
            throw new InvalidDataException(
                "Kubernetes response exceeds its bound");
        }

        await using var source = await content.ReadAsStreamAsync(cancellation);
        using var destination = new MemoryStream();
        var buffer = new byte[16_384];
        while (true)
        {
            var read = await source.ReadAsync(buffer, cancellation);
            if (read == 0)
            {
                return destination.ToArray();
            }

            if (destination.Length + read
                > MaximumKubernetesResponseBytes)
            {
                throw new InvalidDataException(
                    "Kubernetes response exceeds its bound");
            }

            await destination.WriteAsync(
                buffer.AsMemory(0, read),
                cancellation);
        }
    }
}
