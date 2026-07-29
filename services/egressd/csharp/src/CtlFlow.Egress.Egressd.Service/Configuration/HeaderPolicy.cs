namespace CtlFlow.Egress.Egressd.Service.Configuration;

internal static partial class EgressdConfiguration
{
    private static readonly IReadOnlySet<string> HopByHopHeaders =
        new HashSet<string>(
            [
                "connection",
                "keep-alive",
                "proxy-authenticate",
                "proxy-authorization",
                "te",
                "trailer",
                "transfer-encoding",
                "upgrade"
            ],
            StringComparer.Ordinal);

    internal static bool IsProtectedHeader(
        string name,
        bool requestHeaders) =>
        HopByHopHeaders.Contains(name)
        || name == "host"
        || name == "baggage"
        || name == "traceparent"
        || name == "tracestate"
        || requestHeaders && name == "content-length"
        || name == "forwarded"
        || name.StartsWith("x-forwarded-", StringComparison.Ordinal)
        || name.StartsWith("ctlflow-", StringComparison.Ordinal);
}
