using System.Globalization;
using System.Net;
using CtlFlow.Audit.Auditd.Service.Security;
using CtlFlow.Audit.Auditd.Service.Security.Tokens;
using CtlFlow.Audit.Auditd.Service.Security.Workloads;
using CtlFlow.Audit.Auditd.Service.Telemetry;
using static CtlFlow.Audit.Auditd.Db.Providers.AuditDatabaseProviders;

namespace CtlFlow.Audit.Auditd.Service.Configuration;

internal static partial class AuditdConfiguration
{
    private const int DefaultDatabasePoolSize = 16;
    private const int DefaultWorkloadTokenLifetimeSeconds = 3_600;
    private const int DefaultKeyCacheSeconds = 30;

    internal static async Task<ServiceSettings> LoadServiceSettings(
        CancellationToken cancellation)
    {
        var grpcUri = ParseListenUri(
            "CTLFLOW_GRPC_URL",
            RequireEnvironment("CTLFLOW_GRPC_URL"),
            Uri.UriSchemeHttps);
        var probeUri = ParseListenUri(
            "CTLFLOW_PROBE_URL",
            RequireEnvironment("CTLFLOW_PROBE_URL"),
            Uri.UriSchemeHttp);
        if (grpcUri.Port == probeUri.Port)
        {
            throw new InvalidOperationException(
                "gRPC and probe listeners must use distinct ports");
        }

        var database = await ParseDatabaseConfiguration(
            RequireEnvironment("CTLFLOW_DATABASE_PROVIDER"),
            RequireEnvironment("CTLFLOW_DATABASE_PATH"),
            ReadPositiveInteger(
                "CTLFLOW_DATABASE_POOL_SIZE",
                DefaultDatabasePoolSize).ToString(
                    CultureInfo.InvariantCulture),
            cancellation);
        var keyCacheSeconds = ReadPositiveInteger(
            "CTLFLOW_WORKLOAD_KEY_CACHE_SECONDS",
            DefaultKeyCacheSeconds);
        if (keyCacheSeconds > 300)
        {
            throw new InvalidOperationException(
                "Workload key cache cannot exceed 300 seconds");
        }

        var sourceMappings = new AuditSourceMappings(
            ReadSourceSubject("CTLFLOW_SOURCE_TENANTD_SUBJECT"),
            ReadSourceSubject("CTLFLOW_SOURCE_IDENTITYD_SUBJECT"),
            ReadSourceSubject("CTLFLOW_SOURCE_PKGD_SUBJECT"),
            ReadSourceSubject("CTLFLOW_SOURCE_CONFIGD_SUBJECT"),
            ReadSourceSubject("CTLFLOW_SOURCE_EXECD_SUBJECT"));
        if (sourceMappings.Count != 5)
        {
            throw new InvalidOperationException(
                "Exactly five audit sources are required");
        }

        return new ServiceSettings(
            IPAddress.Parse(grpcUri.Host),
            grpcUri.Port,
            IPAddress.Parse(probeUri.Host),
            probeUri.Port,
            new TlsSettings(
                RequireAbsoluteFile("CTLFLOW_TLS_CERTIFICATE_PATH"),
                RequireAbsoluteFile("CTLFLOW_TLS_PRIVATE_KEY_PATH")),
            database,
            new WorkloadTokenSettings(
                new TokenValidationSettings(
                    RequireEnvironment("CTLFLOW_WORKLOAD_TOKEN_ISSUER"),
                    RequireEnvironment("CTLFLOW_WORKLOAD_TOKEN_AUDIENCE"),
                    TimeSpan.FromSeconds(ReadPositiveInteger(
                        "CTLFLOW_WORKLOAD_TOKEN_MAX_LIFETIME_SECONDS",
                        DefaultWorkloadTokenLifetimeSeconds))),
                RequireAbsoluteFile("CTLFLOW_WORKLOAD_JWKS_PATH"),
                TimeSpan.FromSeconds(keyCacheSeconds)),
            sourceMappings,
            TelemetrySettings.Parse(
                RequireEnvironment("OTEL_EXPORTER_OTLP_ENDPOINT")));
    }

    private static Uri ParseListenUri(
        string name,
        string value,
        string expectedScheme)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri)
            || uri.Scheme != expectedScheme
            || !IPAddress.TryParse(uri.Host, out _)
            || uri.Port is < 1 or > 65_535
            || uri.AbsolutePath != "/"
            || !string.IsNullOrEmpty(uri.Query)
            || !string.IsNullOrEmpty(uri.Fragment)
            || !string.IsNullOrEmpty(uri.UserInfo))
        {
            throw new InvalidOperationException(
                $"{name} must use {expectedScheme} with an IP host and no path");
        }

        return uri;
    }

    private static KubernetesServiceAccountSubject ReadSourceSubject(
        string name) =>
        KubernetesServiceAccountSubject.Parse(RequireEnvironment(name));

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
                $"{name} must reference an existing absolute file path");
        }

        return Path.GetFullPath(value);
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

        return int.TryParse(
                value,
                NumberStyles.None,
                CultureInfo.InvariantCulture,
                out var parsed)
            && parsed > 0
            ? parsed
            : throw new InvalidOperationException(
                $"{name} must be a positive integer");
    }
}
