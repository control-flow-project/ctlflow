using System.Diagnostics;
using Grpc.Core;

namespace CtlFlow.Identity.Identityd.Service.Telemetry;

internal static partial class TraceContexts
{
    internal static void AddTraceContext(
        Metadata headers,
        Activity? activity)
    {
        if (activity?.Id is { } traceParent)
        {
            headers.Add("traceparent", traceParent);
        }

        if (!string.IsNullOrEmpty(activity?.TraceStateString))
        {
            headers.Add("tracestate", activity.TraceStateString);
        }
    }
}
