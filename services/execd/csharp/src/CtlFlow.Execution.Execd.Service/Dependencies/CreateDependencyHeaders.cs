using System.Diagnostics;
using System.Globalization;
using Grpc.Core;

namespace CtlFlow.Execution.Execd.Service.Dependencies;

internal static partial class DependencyAuthentication
{
    internal static Metadata CreateDependencyHeaders(string token)
    {
        var headers = new Metadata
        {
            { "authorization", $"Bearer {token}" }
        };
        var activity = Activity.Current;
        if (activity is null)
        {
            return headers;
        }

        var flags = ((byte)activity.ActivityTraceFlags).ToString(
            "x2",
            CultureInfo.InvariantCulture);
        headers.Add(
            "traceparent",
            $"00-{activity.TraceId}-{activity.SpanId}-{flags}");
        if (!string.IsNullOrEmpty(activity.TraceStateString))
        {
            headers.Add("tracestate", activity.TraceStateString);
        }

        return headers;
    }
}
