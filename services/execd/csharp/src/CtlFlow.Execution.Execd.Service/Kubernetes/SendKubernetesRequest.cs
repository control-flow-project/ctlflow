using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Net.Http.Headers;

namespace CtlFlow.Execution.Execd.Service.Kubernetes;

internal static partial class KubernetesApis
{
    internal static async Task<KubernetesResponseLease>
        SendKubernetesRequest(
            KubernetesApi api,
            HttpMethod method,
            string relativePath,
            ReadOnlyMemory<byte> body,
            string? contentType,
            string operation,
            CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(
            cancellation);
        timeout.CancelAfter(api.Settings.CallTimeout);
        using var request = new HttpRequestMessage(
            method,
            new Uri(relativePath, UriKind.Relative));
        var token = (await File.ReadAllTextAsync(
            api.Settings.TokenFilePath,
            cancellation)).Trim();
        if (token.Length is < 1 or > 16_384)
        {
            throw new KubernetesUnavailableException(
                new InvalidDataException(
                    "Kubernetes token is invalid"));
        }

        request.Headers.Authorization =
            new AuthenticationHeaderValue("Bearer", token);
        if (!body.IsEmpty)
        {
            request.Content = new ReadOnlyMemoryContent(body);
            request.Content.Headers.ContentType =
                MediaTypeHeaderValue.Parse(
                    contentType
                    ?? throw new InvalidOperationException(
                        "Kubernetes request content type is required"));
        }

        var started = Stopwatch.GetTimestamp();
        using var activity = api.Telemetry.StartKubernetesOperation(operation);
        AddTraceContext(request, activity);
        var outcome = "UNAVAILABLE";
        try
        {
            using var response = await api.Client.SendAsync(
                request,
                HttpCompletionOption.ResponseHeadersRead,
                timeout.Token);
            outcome = MapOutcome(response.StatusCode);
            return new KubernetesResponseLease(
                response.StatusCode,
                await ReadBoundedResponse(
                    response.Content,
                    timeout.Token));
        }
        catch (OperationCanceledException) when (
            cancellation.IsCancellationRequested)
        {
            outcome = "CANCELLED";
            throw;
        }
        catch (OperationCanceledException exception)
        {
            throw new KubernetesUnavailableException(exception);
        }
        catch (Exception exception) when (
            exception is HttpRequestException
                or IOException
                or InvalidDataException)
        {
            throw new KubernetesUnavailableException(exception);
        }
        finally
        {
            api.Telemetry.RecordKubernetesOperation(
                activity,
                operation,
                outcome,
                started);
        }
    }

    private static void AddTraceContext(
        HttpRequestMessage request,
        Activity? activity)
    {
        if (activity is null)
        {
            return;
        }

        var flags = ((byte)activity.ActivityTraceFlags).ToString(
            "x2",
            CultureInfo.InvariantCulture);
        request.Headers.TryAddWithoutValidation(
            "traceparent",
            $"00-{activity.TraceId}-{activity.SpanId}-{flags}");
        if (!string.IsNullOrEmpty(activity.TraceStateString))
        {
            request.Headers.TryAddWithoutValidation(
                "tracestate",
                activity.TraceStateString);
        }
    }

    private static string MapOutcome(HttpStatusCode status) =>
        status switch
        {
            HttpStatusCode.OK or HttpStatusCode.Created => "OK",
            HttpStatusCode.NotFound => "NOT_FOUND",
            HttpStatusCode.Conflict => "ALREADY_EXISTS",
            HttpStatusCode.Unauthorized => "UNAUTHENTICATED",
            HttpStatusCode.Forbidden => "PERMISSION_DENIED",
            _ => "UNAVAILABLE"
        };
}
