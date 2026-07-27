using Grpc.Core;

namespace CtlFlow.Audit.Auditd.Service.Telemetry;

internal static partial class TraceContexts
{
    internal static System.Diagnostics.ActivityContext ReadParentContext(
        Metadata headers)
    {
        var traceParent = ReadSingleHeader(headers, "traceparent", 128);
        var traceState = ReadSingleHeader(headers, "tracestate", 512);
        return traceParent is not null
            && System.Diagnostics.ActivityContext.TryParse(
                traceParent,
                traceState,
                isRemote: true,
                out var parent)
            ? parent
            : default;
    }

    private static string? ReadSingleHeader(
        Metadata headers,
        string name,
        int maximumLength)
    {
        string? value = null;
        foreach (var header in headers)
        {
            if (!string.Equals(
                    header.Key,
                    name,
                    StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            if (header.IsBinary
                || value is not null
                || header.Value.Length > maximumLength)
            {
                return null;
            }

            value = header.Value;
        }

        return value;
    }
}
