using System.Text.Json;
using CtlFlow.Egress.Egressd.Domain.Rules;

namespace CtlFlow.Egress.Egressd.Service.Configuration;

internal static partial class EgressdConfiguration
{
    internal static async Task<IReadOnlySet<HeaderName>> ParseHeaderNames(
        JsonElement rule,
        string propertyName,
        bool requestHeaders,
        CancellationToken cancellation)
    {
        var headers = new HashSet<HeaderName>();
        foreach (var item in ReadArray(
            rule,
            propertyName,
            0,
            128).EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.String
                || item.GetString() is not { } value)
            {
                throw new InvalidDataException(
                    $"{propertyName} is invalid");
            }

            var header = await HeaderName.Parse(value, cancellation);
            if (IsProtectedHeader(header.Value, requestHeaders)
                || !headers.Add(header))
            {
                throw new InvalidOperationException(
                    $"{propertyName} is invalid");
            }
        }

        return headers;
    }
}
