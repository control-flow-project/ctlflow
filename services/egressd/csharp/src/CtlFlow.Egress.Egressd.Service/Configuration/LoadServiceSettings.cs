using System.Globalization;
using System.Net;
using CtlFlow.Egress.Egressd.Service.Security.Tokens;
using CtlFlow.Egress.Egressd.Service.Telemetry;
using static CtlFlow.Egress.Egressd.Service.Security.Tokens.JsonWebKeys;

namespace CtlFlow.Egress.Egressd.Service.Configuration;

internal static partial class EgressdConfiguration
{
    private const int DefaultUpstreamTimeoutMilliseconds = 300_000;
    private const int MaximumUpstreamTimeoutMilliseconds = 300_000;
    private const int MaximumConcurrency = 256;

    internal static async Task<ServiceSettings> LoadServiceSettings(
        CancellationToken cancellation)
    {
        var privateListen = ParseListen(
            "CTLFLOW_PRIVATE_URL",
            RequireEnvironment("CTLFLOW_PRIVATE_URL"));
        var probeListen = ParseListen(
            "CTLFLOW_PROBE_URL",
            RequireEnvironment("CTLFLOW_PROBE_URL"));
        if (privateListen.Port == probeListen.Port)
        {
            throw new InvalidOperationException(
                "Private and probe listeners must use distinct ports");
        }

        var configuration = await ParseBinding(
            RequireAbsoluteFile("CTLFLOW_EGRESS_BINDING_PATH"),
            RequireAbsoluteFile("CTLFLOW_EGRESS_SECRETS_PATH"),
            cancellation);
        var maximumLifetimeSeconds = ReadPositiveInteger(
            "CTLFLOW_WORKLOAD_TOKEN_MAX_LIFETIME_SECONDS",
            600);
        if (maximumLifetimeSeconds > 3_600)
        {
            throw new InvalidOperationException(
                "Workload-token lifetime exceeds one hour");
        }

        var timeoutMilliseconds = ReadPositiveInteger(
            "CTLFLOW_UPSTREAM_TIMEOUT_MILLISECONDS",
            DefaultUpstreamTimeoutMilliseconds);
        if (timeoutMilliseconds > MaximumUpstreamTimeoutMilliseconds)
        {
            throw new InvalidOperationException(
                "Upstream timeout exceeds five minutes");
        }

        return new ServiceSettings(
            privateListen,
            probeListen,
            configuration,
            new TokenValidationSettings(
                RequireAbsoluteUri(
                    "CTLFLOW_WORKLOAD_TOKEN_ISSUER"),
                RequireBoundedValue(
                    "CTLFLOW_WORKLOAD_TOKEN_AUDIENCE",
                    256),
                TimeSpan.FromSeconds(maximumLifetimeSeconds)),
            await LoadFileVerificationKeys(
                RequireAbsoluteFile("CTLFLOW_WORKLOAD_JWKS_PATH"),
                cancellation),
            new ProxySettings(
                new Uri(
                    configuration.Binding.Origin.Value,
                    UriKind.Absolute),
                RequireAbsoluteFile(
                    "CTLFLOW_UPSTREAM_TLS_CA_PATH"),
                TimeSpan.FromMilliseconds(timeoutMilliseconds),
                MaximumConcurrency),
            TelemetrySettings.Parse(
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

    private static string RequireAbsoluteUri(string name)
    {
        var value = RequireEnvironment(name);
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri)
            || string.IsNullOrEmpty(uri.Scheme)
            || string.IsNullOrEmpty(uri.Host)
            || !string.IsNullOrEmpty(uri.UserInfo)
            || !string.IsNullOrEmpty(uri.Query)
            || !string.IsNullOrEmpty(uri.Fragment))
        {
            throw new InvalidOperationException($"{name} is invalid");
        }

        return value;
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

    private static string RequireBoundedValue(
        string name,
        int maximumLength)
    {
        var value = RequireEnvironment(name);
        return value.Length <= maximumLength
            && !value.Any(char.IsWhiteSpace)
            ? value
            : throw new InvalidOperationException($"{name} is invalid");
    }

    private static int ReadPositiveInteger(
        string name,
        int defaultValue)
    {
        var value = Environment.GetEnvironmentVariable(name);
        if (string.IsNullOrWhiteSpace(value))
        {
            return defaultValue;
        }
        if (!int.TryParse(
                value,
                NumberStyles.None,
                CultureInfo.InvariantCulture,
                out var parsed)
            || parsed <= 0)
        {
            throw new InvalidOperationException(
                $"{name} must be a positive integer");
        }

        return parsed;
    }
}
