using System.Net;

namespace CtlFlow.Tenancy.Tenantd.Service.Configuration;

internal static partial class TenantdConfiguration
{
    private static AggregationSettings LoadAggregationSettings()
    {
        var uri = ParseAggregationListenUri(
            RequireEnvironment("CTLFLOW_AGGREGATION_URL"));
        var allowedClientNames = ParseAllowedClientNames(
            "CTLFLOW_AGGREGATION_ALLOWED_CLIENT_NAMES");

        return new AggregationSettings(
            IPAddress.Parse(uri.Host),
            uri.Port,
            RequireAbsoluteFile("CTLFLOW_AGGREGATION_CERT_PATH"),
            RequireAbsoluteFile("CTLFLOW_AGGREGATION_KEY_PATH"),
            RequireAbsoluteFile(
                "CTLFLOW_AGGREGATION_REQUESTHEADER_CA_PATH"),
            allowedClientNames);
    }

    private static Uri ParseAggregationListenUri(string value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri)
            || uri.Scheme != Uri.UriSchemeHttps
            || !IPAddress.TryParse(uri.Host, out _)
            || uri.Port is < 1 or > 65_535
            || uri.AbsolutePath != "/"
            || !string.IsNullOrEmpty(uri.Query)
            || !string.IsNullOrEmpty(uri.Fragment)
            || !string.IsNullOrEmpty(uri.UserInfo))
        {
            throw new InvalidOperationException(
                "CTLFLOW_AGGREGATION_URL must be an HTTPS URL with an IP host and no path");
        }

        return uri;
    }

    private static IReadOnlySet<string> ParseAllowedClientNames(
        string name)
    {
        var names = new HashSet<string>(StringComparer.Ordinal);
        foreach (var value in RequireEnvironment(name).Split(
                     ',',
                     StringSplitOptions.RemoveEmptyEntries
                        | StringSplitOptions.TrimEntries))
        {
            if (value.Length > 253
                || value.Any(character =>
                    char.IsControl(character)
                    || char.IsWhiteSpace(character)))
            {
                throw new InvalidOperationException(
                    $"{name} contains an invalid client name");
            }

            names.Add(value);
        }

        if (names.Count == 0)
        {
            throw new InvalidOperationException(
                $"{name} must contain at least one client name");
        }

        return names;
    }
}
