namespace CtlFlow.Edge.Edged.Service.Proxy;

internal static partial class ApplicationProxy
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

    internal static IReadOnlySet<string> ReadConnectionHeaders(
        IHeaderDictionary headers)
    {
        var values = new HashSet<string>(
            StringComparer.OrdinalIgnoreCase);
        foreach (var header in headers.Connection)
        {
            foreach (var item in (header ?? "").Split(','))
            {
                var value = item.Trim();
                if (value.Length > 0)
                {
                    values.Add(value);
                }
            }
        }

        return values;
    }

    internal static bool IsProtectedRequestHeader(
        string name,
        IReadOnlySet<string> connectionHeaders) =>
        HopByHopHeaders.Contains(name)
        || connectionHeaders.Contains(name)
        || name.Equals("Authorization", StringComparison.OrdinalIgnoreCase)
        || name.Equals("Forwarded", StringComparison.OrdinalIgnoreCase)
        || name.Equals("Host", StringComparison.OrdinalIgnoreCase)
        || name.Equals("Cookie", StringComparison.OrdinalIgnoreCase)
        || name.Equals("Baggage", StringComparison.OrdinalIgnoreCase)
        || name.Equals("Traceparent", StringComparison.OrdinalIgnoreCase)
        || name.Equals("Tracestate", StringComparison.OrdinalIgnoreCase)
        || name.StartsWith(
            "Ctlflow-",
            StringComparison.OrdinalIgnoreCase)
        || name.StartsWith(
            "X-Forwarded-",
            StringComparison.OrdinalIgnoreCase);

    internal static bool IsProtectedResponseHeader(
        string name,
        IReadOnlySet<string> connectionHeaders) =>
        HopByHopHeaders.Contains(name)
        || connectionHeaders.Contains(name);

    internal static bool IsPlatformSessionCookie(string value)
    {
        var separator = value.IndexOf('=');
        var name = separator < 0
            ? value.Trim()
            : value[..separator].Trim();
        return string.Equals(
            name,
            SessionCookieName,
            StringComparison.Ordinal);
    }
}
