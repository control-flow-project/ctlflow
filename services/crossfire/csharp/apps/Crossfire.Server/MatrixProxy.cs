using System.Net;
using Crossfire.AdapterHttp;

namespace Crossfire.Server;

public sealed class MatrixProxy : IDisposable
{
    private readonly HttpClient client = NativeHttp.Client();
    private static readonly HashSet<string> HopHeaders = new(["Connection", "Keep-Alive", "Proxy-Authenticate", "Proxy-Authorization", "TE", "Trailer", "Transfer-Encoding", "Upgrade"], StringComparer.OrdinalIgnoreCase);

    public async Task Forward(HttpContext http, string origin, string host, string rawTarget)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(http.RequestAborted); deadline.CancelAfter(TimeSpan.FromSeconds(110));
        using var request = new HttpRequestMessage(new(http.Request.Method), new Uri(origin + rawTarget, new UriCreationOptions { DangerousDisablePathAndQueryCanonicalization = true }));
        var incoming = http.Request; var hasBody = incoming.ContentLength is > 0 || incoming.Headers.ContainsKey("Transfer-Encoding");
        if (hasBody) request.Content = new StreamContent(incoming.Body, 65536);
        var excluded = new HashSet<string>(HopHeaders, StringComparer.OrdinalIgnoreCase);
        foreach (var token in incoming.Headers.Connection.ToString().Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)) excluded.Add(token);
        foreach (var header in incoming.Headers)
        {
            if (excluded.Contains(header.Key) || header.Key.Equals("Host", StringComparison.OrdinalIgnoreCase) || header.Key.Equals("Forwarded", StringComparison.OrdinalIgnoreCase)
                || header.Key.StartsWith("X-Forwarded-", StringComparison.OrdinalIgnoreCase)) continue;
            if (!request.Headers.TryAddWithoutValidation(header.Key, header.Value.ToArray())) request.Content?.Headers.TryAddWithoutValidation(header.Key, header.Value.ToArray());
        }
        request.Headers.Host = host;
        try
        {
            using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, deadline.Token);
            http.Response.StatusCode = (int)response.StatusCode;
            var excludedResponse = new HashSet<string>(HopHeaders, StringComparer.OrdinalIgnoreCase);
            foreach (var connection in response.Headers.Connection) excludedResponse.Add(connection);
            foreach (var header in response.Headers.Concat(response.Content.Headers))
                if (!excludedResponse.Contains(header.Key)) http.Response.Headers[header.Key] = header.Value.ToArray();
            if (http.Request.Method == "HEAD" || response.StatusCode is HttpStatusCode.NoContent or HttpStatusCode.NotModified) return;
            await response.Content.CopyToAsync(http.Response.Body, deadline.Token);
        }
        catch (Exception error) when (error is HttpRequestException or OperationCanceledException or IOException)
        {
            if (http.Response.HasStarted) http.Abort(); else { http.Response.Headers.Clear(); http.Response.StatusCode = 502; }
        }
    }
    public void Dispose() => client.Dispose();
}
