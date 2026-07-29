using CtlFlow.Egress.Egressd.Service.Security.Tokens;

namespace CtlFlow.Egress.Egressd.Service.Security.Workloads;

internal static partial class WorkloadAuthentication
{
    internal static ValueTask<string> ReadProxyAuthorization(
        IHeaderDictionary headers,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        var values = headers["Proxy-Authorization"];
        if (values.Count != 1 || values[0] is not { } value)
        {
            throw new TokenValidationException();
        }

        const string prefix = "Bearer ";
        if (!value.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)
            || value.Length == prefix.Length
            || value[prefix.Length..].Any(char.IsWhiteSpace))
        {
            throw new TokenValidationException();
        }

        return ValueTask.FromResult(value[prefix.Length..]);
    }
}
