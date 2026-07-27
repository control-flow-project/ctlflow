using System.Diagnostics;
using Grpc.Core;

namespace CtlFlow.Auth.Authd.Service.Telemetry;

internal static class TraceContexts
{
    internal static ActivityContext ReadHttpParent(HttpRequest request)
    {
        var traceParent = ReadSingleHeader(
            request.Headers,
            "traceparent",
            128);
        var traceState = ReadSingleHeader(
            request.Headers,
            "tracestate",
            512);
        return traceParent is not null
            && ActivityContext.TryParse(
                traceParent,
                traceState,
                isRemote: true,
                out var parent)
            ? parent
            : default;
    }

    internal static void InjectHttpTraceContext(
        HttpRequestMessage request,
        Activity? activity)
    {
        if (activity?.Id is not { } traceParent)
        {
            return;
        }
        request.Headers.TryAddWithoutValidation(
            "traceparent",
            traceParent);
        if (!string.IsNullOrEmpty(activity.TraceStateString))
        {
            request.Headers.TryAddWithoutValidation(
                "tracestate",
                activity.TraceStateString);
        }
    }

    internal static void InjectGrpcTraceContext(
        Metadata headers,
        Activity? activity)
    {
        if (activity?.Id is not { } traceParent)
        {
            return;
        }
        headers.Add("traceparent", traceParent);
        if (!string.IsNullOrEmpty(activity.TraceStateString))
        {
            headers.Add("tracestate", activity.TraceStateString);
        }
    }

    private static string? ReadSingleHeader(
        IHeaderDictionary headers,
        string name,
        int maximumLength)
    {
        if (!headers.TryGetValue(name, out var values)
            || values.Count != 1
            || values[0] is not { } value
            || value.Length > maximumLength)
        {
            return null;
        }
        return value;
    }
}
