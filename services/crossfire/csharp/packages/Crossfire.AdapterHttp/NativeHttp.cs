using System.Buffers;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Security;
using System.Net.Sockets;
using System.Text.Json;
using Crossfire.Contracts;
using Crossfire.Kernel;

namespace Crossfire.AdapterHttp;

public sealed record NativeEndpoint(string Base, string? Token = null, int TimeoutMs = 15000);
public sealed record NativeJsonResponse(int Status, JsonDocument Document, string? ContentType = null) : IDisposable
{
    public JsonElement Body => Document.RootElement;
    public void Dispose() => Document.Dispose();
}

public static class NativeHttp
{
    public const int MaxJsonBytes = 1048576;

    public static HttpClient Client()
        => new(new SocketsHttpHandler
        {
            AllowAutoRedirect = false, UseCookies = false, UseProxy = false, AutomaticDecompression = DecompressionMethods.None,
            PooledConnectionLifetime = TimeSpan.FromMinutes(10), ConnectTimeout = TimeSpan.FromSeconds(15), ConnectCallback = Connect
        }) { Timeout = Timeout.InfiniteTimeSpan };

    private static async ValueTask<Stream> Connect(SocketsHttpConnectionContext context, CancellationToken cancellation)
    {
        var socket = new Socket(SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
        try
        {
            await socket.ConnectAsync(context.DnsEndPoint, cancellation);
            var stream = new NetworkStream(socket, ownsSocket: true);
            if (context.InitialRequestMessage.RequestUri?.Scheme != Uri.UriSchemeHttps) return stream;
            var secure = new SslStream(stream);
            try
            {
                await secure.AuthenticateAsClientAsync(new SslClientAuthenticationOptions
                { TargetHost = context.DnsEndPoint.Host, ApplicationProtocols = [SslApplicationProtocol.Http11] }, cancellation);
                return secure;
            }
            catch { await secure.DisposeAsync(); throw; }
        }
        catch { socket.Dispose(); throw; }
    }

    public static async ValueTask<Result<NativeJsonResponse>> Json(HttpClient client, NativeEndpoint endpoint, string method,
        string path, JsonElement? body = null, int maximumBytes = MaxJsonBytes, CancellationToken cancellation = default, int maximumRequestBytes = MaxJsonBytes)
    {
        if (body is not null && !Validation.Json(body.Value)) return Results.Fail<NativeJsonResponse>("invalid", "Invalid HTTP JSON request");
        byte[]? encoded = body is null ? null : WireJson.Bytes(body.Value);
        return await Send(client, endpoint, method, path, encoded, "application/json", maximumRequestBytes, maximumBytes, cancellation);
    }

    public static ValueTask<Result<NativeJsonResponse>> Binary(HttpClient client, NativeEndpoint endpoint, string method, string path,
        ReadOnlyMemory<byte> body, string contentType, int maximumRequestBytes, int maximumBytes = MaxJsonBytes, CancellationToken cancellation = default)
        => Send(client, endpoint, method, path, body, contentType, maximumRequestBytes, maximumBytes, cancellation);

    private static async ValueTask<Result<NativeJsonResponse>> Send(HttpClient client, NativeEndpoint endpoint, string method,
        string path, ReadOnlyMemory<byte>? encoded, string contentType, int maximumRequestBytes, int maximumBytes, CancellationToken cancellation)
    {
        var origin = Validation.Origin(endpoint.Base);
        if (!origin.IsSuccess) return Result<NativeJsonResponse>.Fail(origin.Error);
        if (endpoint.TimeoutMs is < 100 or > 120000 || maximumBytes is < 1 or > 67108864
            || maximumRequestBytes is < 1 or > 16777216 || contentType.Length is < 1 or > 200 || !MediaTypeHeaderValue.TryParse(contentType, out var mediaType)
            || method is not ("GET" or "POST" or "PUT" or "DELETE" or "PATCH") || !path.StartsWith('/') || path.StartsWith("//", StringComparison.Ordinal)
            || path.Length > 65536 || path.Any(value => value is '\\' or '#' || TextRules.WhiteSpace(value) || value is <= '\u001f' or '\u007f'))
            return Results.Fail<NativeJsonResponse>("invalid", "Invalid bounded HTTP request");
        if (!Uri.TryCreate(origin.Value + path, UriKind.Absolute, out var destination)
            || destination.GetLeftPart(UriPartial.Authority) != origin.Value || destination.UserInfo.Length != 0 || destination.Fragment.Length != 0)
            return Results.Fail<NativeJsonResponse>("invalid", "HTTP request must remain on its configured origin");
        if (encoded?.Length > maximumRequestBytes) return Results.Fail<NativeJsonResponse>("limit", "HTTP request exceeds its declared operation byte limit");
        if (cancellation.IsCancellationRequested) return Results.Fail<NativeJsonResponse>("native", "HTTP request failed or exceeded its deadline");
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        deadline.CancelAfter(endpoint.TimeoutMs);
        using var request = new HttpRequestMessage(new HttpMethod(method), destination);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        if (endpoint.Token is not null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", endpoint.Token);
        if (encoded is { } bytes) request.Content = new ReadOnlyMemoryContent(bytes);
        if (request.Content is not null) request.Content.Headers.ContentType = mediaType;
        try
        {
            using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, deadline.Token);
            if ((int)response.StatusCode is 301 or 302 or 303 or 307 or 308 && response.Headers.Location is not null)
                return Results.Fail<NativeJsonResponse>("native", "HTTP request failed or exceeded its deadline");
            await using var stream = await response.Content.ReadAsStreamAsync(deadline.Token);
            var collected = await Collect(stream, maximumBytes, deadline.Token);
            if (!collected.IsSuccess) return Result<NativeJsonResponse>.Fail(collected.Error);
            var document = WireJson.Document(collected.Value);
            if (!Validation.Json(document.RootElement))
            {
                document.Dispose();
                return Results.Fail<NativeJsonResponse>("native", "Invalid HTTP JSON response");
            }
            return Result<NativeJsonResponse>.Success(new((int)response.StatusCode, document, response.Content.Headers.ContentType?.MediaType));
        }
        catch (Exception error) when (error is HttpRequestException or OperationCanceledException or IOException or JsonException)
        {
            return Results.Fail<NativeJsonResponse>("native", "HTTP response is invalid or exceeds its deadline");
        }
    }

    public static async ValueTask<Result<byte[]>> Collect(Stream stream, int maximumBytes, CancellationToken cancellation = default)
    {
        if (maximumBytes < 1) throw new ArgumentOutOfRangeException(nameof(maximumBytes));
        var buffer = ArrayPool<byte>.Shared.Rent(Math.Min(16384, maximumBytes + (maximumBytes < int.MaxValue ? 1 : 0)));
        try
        {
            using var output = new MemoryStream();
            for (;;)
            {
                var count = await stream.ReadAsync(buffer.AsMemory(), cancellation);
                if (count == 0) return Result<byte[]>.Success(output.ToArray());
                if (output.Length + count > maximumBytes)
                    return Results.Fail<byte[]>("body_too_large", "HTTP response exceeds its collection resource bound");
                output.Write(buffer, 0, count);
            }
        }
        finally { ArrayPool<byte>.Shared.Return(buffer); }
    }
}
