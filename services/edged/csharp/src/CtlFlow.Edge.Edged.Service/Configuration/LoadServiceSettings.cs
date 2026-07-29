using System.Globalization;
using System.Net;
using CtlFlow.Edge.Edged.Service.Telemetry;

namespace CtlFlow.Edge.Edged.Service.Configuration;

internal static partial class EdgedConfiguration
{
    private const int DefaultIdentityTimeoutMilliseconds = 2_000;
    private const int DefaultApplicationTimeoutMilliseconds = 3_600_000;
    private const int MaximumApplicationTimeoutMilliseconds = 3_600_000;
    private const int MaximumConcurrency = 256;

    internal static async Task<ServiceSettings> LoadServiceSettings(
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

        var binding = await ParseBinding(
            RequireEnvironment("CTLFLOW_EDGED_BINDING"),
            cancellation);
        var identityGrpc = new PrivateGrpcSettings(
            ParsePrivateOrigin(
                "CTLFLOW_IDENTITY_URL",
                RequireEnvironment("CTLFLOW_IDENTITY_URL")),
            RequireDnsName("CTLFLOW_IDENTITY_TLS_SERVER_NAME"),
            RequireAbsoluteFile("CTLFLOW_IDENTITY_TLS_CA_PATH"));
        var applicationTimeout = ReadPositiveInteger(
            "CTLFLOW_APPLICATION_TIMEOUT_MILLISECONDS",
            DefaultApplicationTimeoutMilliseconds);
        if (applicationTimeout > MaximumApplicationTimeoutMilliseconds)
        {
            throw new InvalidOperationException(
                "CTLFLOW_APPLICATION_TIMEOUT_MILLISECONDS exceeds one hour");
        }

        return new ServiceSettings(
            publicListen,
            probeListen,
            binding,
            new IdentitySettings(
                identityGrpc,
                RequireAbsoluteFile("CTLFLOW_WORKLOAD_TOKEN_FILE"),
                TimeSpan.FromMilliseconds(ReadPositiveInteger(
                    "CTLFLOW_IDENTITY_CALL_TIMEOUT_MILLISECONDS",
                    DefaultIdentityTimeoutMilliseconds))),
            new ProxySettings(
                new Uri(
                    $"http://127.0.0.1:{binding.ApplicationPort.Value}",
                    UriKind.Absolute),
                TimeSpan.FromMilliseconds(applicationTimeout),
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
