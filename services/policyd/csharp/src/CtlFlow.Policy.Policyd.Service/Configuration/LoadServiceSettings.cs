using System.Globalization;
using System.Net;
using CtlFlow.Policy.Policyd.Domain.Catalog;
using CtlFlow.Policy.Policyd.Domain.Operations;
using CtlFlow.Policy.Policyd.Service.Security.Tokens;
using CtlFlow.Policy.Policyd.Service.Security.Workloads;
using CtlFlow.Policy.Policyd.Service.Telemetry;
using static CtlFlow.Policy.Policyd.Db.Providers.PolicyDatabaseProviders;

namespace CtlFlow.Policy.Policyd.Service.Configuration;

internal static partial class PolicydConfiguration
{
    private const int DefaultDatabasePoolSize = 16;
    private const int DefaultIdentityCallTimeoutMilliseconds = 2_000;
    private const int DefaultExecutionCallTimeoutMilliseconds = 2_000;
    private const int DefaultWorkloadTokenLifetimeSeconds = 3_600;
    private const int DefaultInvocationTokenLifetimeSeconds = 60;
    private static readonly TimeSpan WorkloadKeyCacheLifetime =
        TimeSpan.FromSeconds(30);

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
                DefaultDatabasePoolSize).ToString(CultureInfo.InvariantCulture),
            cancellation);
        var identityEndpoint = ParsePrivateOrigin(
            "CTLFLOW_IDENTITY_URL",
            RequireEnvironment("CTLFLOW_IDENTITY_URL"));
        var workloadTokenFile =
            RequireAbsoluteFile("CTLFLOW_WORKLOAD_TOKEN_FILE");
        var ownerCallers = new OwnerCallerSettings(
            ParseCaller("CTLFLOW_TENANTD_CALLER"),
            ParseCaller("CTLFLOW_PKGD_CALLER"),
            ParseCaller("CTLFLOW_CONFIGD_CALLER"),
            ParseCaller("CTLFLOW_EXECD_CALLER"),
            ParseCaller("CTLFLOW_IDENTITYD_CALLER"));
        EnsureDistinctOwnerCallers(ownerCallers);

        return new ServiceSettings(
            IPAddress.Parse(grpcUri.Host),
            grpcUri.Port,
            IPAddress.Parse(probeUri.Host),
            probeUri.Port,
            new TlsSettings(
                RequireAbsoluteFile("CTLFLOW_TLS_CERTIFICATE_PATH"),
                RequireAbsoluteFile("CTLFLOW_TLS_PRIVATE_KEY_PATH")),
            database,
            new IdentitySettings(
                new PrivateGrpcSettings(
                    identityEndpoint,
                    RequireDnsName("CTLFLOW_IDENTITY_TLS_SERVER_NAME"),
                    RequireAbsoluteFile("CTLFLOW_IDENTITY_TLS_CA_PATH")),
                workloadTokenFile,
                TimeSpan.FromMilliseconds(ReadPositiveInteger(
                    "CTLFLOW_IDENTITY_CALL_TIMEOUT_MILLISECONDS",
                    DefaultIdentityCallTimeoutMilliseconds))),
            new WorkloadTokenSettings(
                CreateTokenSettings(
                    "CTLFLOW_WORKLOAD",
                    DefaultWorkloadTokenLifetimeSeconds),
                RequireAbsoluteFile("CTLFLOW_WORKLOAD_JWKS_PATH"),
                WorkloadKeyCacheLifetime),
            CreateTokenSettings(
                "CTLFLOW_INVOCATION",
                DefaultInvocationTokenLifetimeSeconds),
            ownerCallers,
            new ExecutionSettings(
                new PrivateGrpcSettings(
                    ParsePrivateOrigin(
                        "CTLFLOW_EXECUTION_URL",
                        RequireEnvironment("CTLFLOW_EXECUTION_URL")),
                    RequireDnsName("CTLFLOW_EXECUTION_TLS_SERVER_NAME"),
                    RequireAbsoluteFile("CTLFLOW_EXECUTION_TLS_CA_PATH")),
                TimeSpan.FromMilliseconds(ReadPositiveInteger(
                    "CTLFLOW_EXECUTION_CALL_TIMEOUT_MILLISECONDS",
                    DefaultExecutionCallTimeoutMilliseconds))),
            RequireAbsoluteFile("CTLFLOW_OPERATION_CATALOG_PATH"),
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

    private static TokenValidationSettings CreateTokenSettings(
        string prefix,
        int defaultMaximumLifetimeSeconds)
    {
        var lifetime = TimeSpan.FromSeconds(ReadPositiveInteger(
            $"{prefix}_TOKEN_MAX_LIFETIME_SECONDS",
            defaultMaximumLifetimeSeconds));
        if (prefix == "CTLFLOW_INVOCATION"
            && lifetime > TimeSpan.FromSeconds(60))
        {
            throw new InvalidOperationException(
                "Invocation-token maximum lifetime cannot exceed 60 seconds");
        }
        return new TokenValidationSettings(
            RequireEnvironment($"{prefix}_TOKEN_ISSUER"),
            RequireEnvironment($"{prefix}_TOKEN_AUDIENCE"),
            lifetime);
    }

    private static KubernetesServiceAccountSubject ParseCaller(string name) =>
        KubernetesServiceAccountSubject.Parse(RequireEnvironment(name));

    private static void EnsureDistinctOwnerCallers(
        OwnerCallerSettings callers)
    {
        var values = new[]
        {
            callers.Tenantd,
            callers.Pkgd,
            callers.Configd,
            callers.Execd,
            callers.Identityd
        };
        if (values.Distinct().Count() != values.Length)
        {
            throw new InvalidOperationException(
                "Operation owners must map to distinct workload callers");
        }
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

    private static string RequireEnvironment(string name)
    {
        var value = Environment.GetEnvironmentVariable(name);
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new InvalidOperationException($"{name} is required");
        }
        return value;
    }

    private static string RequireAbsoluteFile(string name)
    {
        var value = RequireEnvironment(name);
        if (!Path.IsPathFullyQualified(value))
        {
            throw new InvalidOperationException(
                $"{name} must be an absolute file path");
        }
        return Path.GetFullPath(value);
    }

    private static string RequireDnsName(string name)
    {
        var value = RequireEnvironment(name);
        if (value.Length is < 1 or > 253
            || Uri.CheckHostName(value) != UriHostNameType.Dns
            || !string.Equals(
                value,
                value.ToLowerInvariant(),
                StringComparison.Ordinal))
        {
            throw new InvalidOperationException(
                $"{name} must be a lower-case DNS name");
        }
        return value;
    }
}
