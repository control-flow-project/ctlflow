using System.Net;
using static CtlFlow.Auth.Authd.Service.Configuration.ProviderProjections;

namespace CtlFlow.Auth.Authd.Service.Configuration;

internal static partial class AuthdConfiguration
{
    internal static async Task<AuthdSettings> LoadServiceSettings(
        CancellationToken cancellation)
    {
        var publicListen = ParseListen(
            "CTLFLOW_PUBLIC_URL",
            RequireEnvironment("CTLFLOW_PUBLIC_URL"));
        var probeListen = ParseListen(
            "CTLFLOW_PROBE_URL",
            RequireEnvironment("CTLFLOW_PROBE_URL"));
        if (publicListen.Port == probeListen.Port)
        {
            throw new InvalidOperationException(
                "Public and probe listeners must use distinct ports");
        }

        var providerPath =
            RequireAbsoluteFile("CTLFLOW_PROVIDER_CONFIG_PATH");
        var secretPath =
            RequireAbsoluteFile("CTLFLOW_PROVIDER_SECRET_PATH");
        if (string.Equals(
                providerPath,
                secretPath,
                StringComparison.Ordinal))
        {
            throw new InvalidOperationException(
                "Provider projections must be disjoint");
        }

        var projection = await LoadProviderProjection(
            providerPath,
            secretPath,
            cancellation);
        var identityEndpoint = ParsePrivateOrigin(
            "CTLFLOW_IDENTITY_URL",
            RequireEnvironment("CTLFLOW_IDENTITY_URL"));
        var tenantEndpoint = ParsePrivateOrigin(
            "CTLFLOW_TENANT_URL",
            RequireEnvironment("CTLFLOW_TENANT_URL"));
        return new AuthdSettings(
            publicListen,
            probeListen,
            projection,
            new PrivateGrpcSettings(
                identityEndpoint,
                RequireDnsName("CTLFLOW_IDENTITY_TLS_SERVER_NAME"),
                RequireAbsoluteFile("CTLFLOW_IDENTITY_TLS_CA_PATH")),
            new PrivateGrpcSettings(
                tenantEndpoint,
                RequireDnsName("CTLFLOW_TENANT_TLS_SERVER_NAME"),
                RequireAbsoluteFile("CTLFLOW_TENANT_TLS_CA_PATH")),
            new WorkloadSettings(
                RequireAbsoluteFile("CTLFLOW_WORKLOAD_TOKEN_FILE")),
            Telemetry.TelemetrySettings.Parse(
                RequireEnvironment("OTEL_EXPORTER_OTLP_ENDPOINT")));
    }

    private static ListenSettings ParseListen(string name, string value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri)
            || uri.Scheme != Uri.UriSchemeHttp
            || !IPAddress.TryParse(uri.Host, out var address)
            || uri.Port is < 1 or > 65_535
            || uri.AbsolutePath != "/"
            || !string.IsNullOrEmpty(uri.Query)
            || !string.IsNullOrEmpty(uri.Fragment)
            || !string.IsNullOrEmpty(uri.UserInfo))
        {
            throw new InvalidOperationException(
                $"{name} must use HTTP with an IP host and no path");
        }

        return new ListenSettings(address, uri.Port);
    }

    private static Uri ParsePrivateOrigin(string name, string value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri)
            || uri.Scheme != Uri.UriSchemeHttps
            || string.IsNullOrEmpty(uri.Host)
            || uri.Port is < 1 or > 65_535
            || uri.AbsolutePath != "/"
            || !string.IsNullOrEmpty(uri.Query)
            || !string.IsNullOrEmpty(uri.Fragment)
            || !string.IsNullOrEmpty(uri.UserInfo))
        {
            throw new InvalidOperationException(
                $"{name} must be a private HTTPS origin");
        }

        return uri;
    }

    private static string RequireEnvironment(string name)
    {
        var value = Environment.GetEnvironmentVariable(name);
        return string.IsNullOrWhiteSpace(value)
            ? throw new InvalidOperationException($"{name} is required")
            : value;
    }

    private static string RequireAbsoluteFile(string name)
    {
        var value = RequireEnvironment(name);
        if (!Path.IsPathFullyQualified(value) || !File.Exists(value))
        {
            throw new InvalidOperationException(
                $"{name} must reference an existing absolute file");
        }

        return Path.GetFullPath(value);
    }

    private static string RequireDnsName(string name)
    {
        var value = RequireEnvironment(name);
        if (value.Length > 253
            || Uri.CheckHostName(value) != UriHostNameType.Dns)
        {
            throw new InvalidOperationException(
                $"{name} must be a DNS name");
        }

        return value;
    }
}
