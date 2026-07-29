using CtlFlow.Egress.Egressd.Domain.Rules;

namespace CtlFlow.Egress.Egressd.Service.Proxy;

internal static partial class EgressProxy
{
    private static readonly IReadOnlySet<string> HopByHopHeaders =
        new HashSet<string>(
            [
                "Connection",
                "Keep-Alive",
                "Proxy-Authenticate",
                "Proxy-Authorization",
                "TE",
                "Trailer",
                "Transfer-Encoding",
                "Upgrade"
            ],
            StringComparer.OrdinalIgnoreCase);

    internal static bool IsProtectedRuntimeHeader(
        string name,
        IReadOnlySet<string> connectionHeaders) =>
        HopByHopHeaders.Contains(name)
        || connectionHeaders.Contains(name)
        || name.Equals("Host", StringComparison.OrdinalIgnoreCase)
        || name.Equals(
            "Proxy-Authorization",
            StringComparison.OrdinalIgnoreCase)
        || name.Equals("Forwarded", StringComparison.OrdinalIgnoreCase)
        || name.Equals("Baggage", StringComparison.OrdinalIgnoreCase)
        || name.Equals("Traceparent", StringComparison.OrdinalIgnoreCase)
        || name.Equals("Tracestate", StringComparison.OrdinalIgnoreCase)
        || name.StartsWith(
            "Ctlflow-",
            StringComparison.OrdinalIgnoreCase)
        || name.StartsWith(
            "X-Forwarded-",
            StringComparison.OrdinalIgnoreCase);

    internal static bool IsAdmitted(
        IReadOnlySet<HeaderName> admitted,
        string name) =>
        admitted.Any(value =>
            value.Value.Equals(name, StringComparison.OrdinalIgnoreCase));

    internal static IReadOnlySet<string> ReadConnectionHeaders(
        IEnumerable<string?> values)
    {
        var result = new HashSet<string>(
            StringComparer.OrdinalIgnoreCase);
        foreach (var header in values)
        {
            foreach (var item in (header ?? "").Split(','))
            {
                var value = item.Trim();
                if (value.Length > 0)
                {
                    result.Add(value);
                }
            }
        }
        return result;
    }
}
