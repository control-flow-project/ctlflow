using CtlFlow.Auth.Authd.Service.Configuration;
using CtlFlow.Auth.Authd.Service.Dependencies;
using CtlFlow.Auth.Authd.Service.Oidc;
using CtlFlow.Auth.Authd.Service.Telemetry;
using static CtlFlow.Auth.Authd.Service.Telemetry.TraceContexts;

namespace CtlFlow.Auth.Authd.Service.Egress;

internal static partial class EgressRequests
{
    private const int MaximumResponseBytes = 256 * 1024;

    internal static async Task<EgressResponse> SendEgressRequest(
        HttpClient client,
        AuthdTelemetry telemetry,
        ProviderRegistration provider,
        Uri providerEndpoint,
        HttpMethod method,
        string operation,
        HttpContent? content,
        string? authorization,
        CancellationToken cancellation)
    {
        var relative = providerEndpoint.PathAndQuery.TrimStart('/');
        var bindingUri = new Uri(provider.EgressOrigin, relative);
        using var request = new HttpRequestMessage(method, bindingUri);
        request.Headers.Host = providerEndpoint.Authority;
        request.Headers.Accept.ParseAdd("application/json");
        if (authorization is not null)
        {
            request.Headers.TryAddWithoutValidation(
                "Authorization",
                authorization);
        }
        request.Content = content;
        if (CalculateHeaderBytes(request) > 16 * 1024)
        {
            throw new OidcRejectedException();
        }

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(
            cancellation);
        timeout.CancelAfter(TimeSpan.FromSeconds(5));
        using var activity = telemetry.StartDependency(
            operation,
            "egressd");
        InjectHttpTraceContext(request, activity);
        var started = System.Diagnostics.Stopwatch.GetTimestamp();
        var outcome = "unavailable";
        try
        {
            using var response = await client.SendAsync(
                request,
                HttpCompletionOption.ResponseHeadersRead,
                timeout.Token);
            if (response.StatusCode
                != System.Net.HttpStatusCode.OK
                && (int)response.StatusCode < 500)
            {
                outcome = "rejected";
                throw new OidcRejectedException();
            }
            if (response.StatusCode
                != System.Net.HttpStatusCode.OK)
            {
                throw new DependencyUnavailableException("egressd");
            }

            var body = await ReadBoundedBody(
                response.Content,
                timeout.Token);
            outcome = "ok";
            return new EgressResponse(
                response.Content.Headers.ContentType?.ToString(),
                body);
        }
        catch (OperationCanceledException) when (
            cancellation.IsCancellationRequested)
        {
            outcome = "cancelled";
            throw;
        }
        catch (OidcRejectedException)
        {
            outcome = "rejected";
            throw;
        }
        catch (Exception exception) when (
            exception is HttpRequestException
                or IOException
                or OperationCanceledException)
        {
            throw new DependencyUnavailableException(
                "egressd",
                exception);
        }
        finally
        {
            telemetry.RecordDependency(
                activity,
                operation,
                "egressd",
                outcome,
                started);
        }
    }

    private static int CalculateHeaderBytes(HttpRequestMessage request)
    {
        var total = 0;
        foreach (var header in request.Headers)
        {
            foreach (var value in header.Value)
            {
                total = checked(
                    total + header.Key.Length + value.Length + 4);
            }
        }
        if (request.Content is not null)
        {
            foreach (var header in request.Content.Headers)
            {
                foreach (var value in header.Value)
                {
                    total = checked(
                        total + header.Key.Length + value.Length + 4);
                }
            }
        }
        return total;
    }

    private static async Task<byte[]> ReadBoundedBody(
        HttpContent content,
        CancellationToken cancellation)
    {
        if (content.Headers.ContentLength > MaximumResponseBytes)
        {
            throw new OidcRejectedException();
        }

        await using var stream =
            await content.ReadAsStreamAsync(cancellation);
        var buffer = new byte[MaximumResponseBytes + 1];
        var read = 0;
        while (read < buffer.Length)
        {
            var count = await stream.ReadAsync(
                buffer.AsMemory(read),
                cancellation);
            if (count == 0)
            {
                break;
            }
            read += count;
        }
        if (read > MaximumResponseBytes)
        {
            throw new OidcRejectedException();
        }

        return buffer.AsSpan(0, read).ToArray();
    }
}
