using System.Net;
using System.Text.Json;

namespace CtlFlow.Execution.Execd.Service.Kubernetes;

internal sealed class KubernetesResponseLease(
    HttpStatusCode statusCode,
    byte[] content) : IDisposable
{
    private byte[]? _content = content;

    internal HttpStatusCode StatusCode { get; } = statusCode;

    internal JsonDocument ParseJson()
    {
        var content = _content
            ?? throw new ObjectDisposedException(
                nameof(KubernetesResponseLease));
        if (content.Length == 0)
        {
            throw new InvalidDataException(
                "Kubernetes returned an empty response");
        }

        return JsonDocument.Parse(content);
    }

    public void Dispose()
    {
        var content = Interlocked.Exchange(ref _content, null);
        if (content is not null)
        {
            Array.Clear(content);
        }
    }
}
