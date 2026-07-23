using System.Globalization;
using System.Net;
using CtlFlow.Tenancy.Tenantd.Db.Sqlite;
using CtlFlow.Tenancy.Tenantd.Domain.Caching;
using CtlFlow.Tenancy.Tenantd.Service.Security.Tokens;
using CtlFlow.Tenancy.Tenantd.Service.Security.Workloads;
using CtlFlow.Tenancy.Tenantd.Service.Telemetry;

namespace CtlFlow.Tenancy.Tenantd.Service.Configuration;

internal static partial class TenantdConfiguration
{
    private const int DefaultDatabasePoolSize = 16;
    private const int DefaultCacheLifetimeSeconds = 30;
    private const int DefaultWorkloadTokenLifetimeSeconds = 3_600;
    private const int DefaultInvocationTokenLifetimeSeconds = 60;
    private static readonly TimeSpan KeyCacheLifetime = TimeSpan.FromSeconds(30);

    internal static async Task<ServiceSettings> LoadServiceSettings(
        CancellationToken cancellation)
    {
        var grpcUri = ParseListenUri(
            "CTLFLOW_GRPC_URL",
            RequireEnvironment("CTLFLOW_GRPC_URL"));
        var probeUri = ParseListenUri(
            "CTLFLOW_PROBE_URL",
            RequireEnvironment("CTLFLOW_PROBE_URL"));
        if (grpcUri.Port == probeUri.Port)
        {
            throw new InvalidOperationException(
                "CTLFLOW_GRPC_URL and CTLFLOW_PROBE_URL must use distinct ports");
        }
        var databasePath = await DatabaseFilePath.Parse(
            RequireEnvironment("CTLFLOW_DATABASE_PATH"),
            cancellation);
        var databasePoolSize = await DatabasePoolSize.Parse(
            ReadPositiveInteger(
                "CTLFLOW_DATABASE_POOL_SIZE",
                DefaultDatabasePoolSize),
            cancellation);
        var cacheLifetime = await CacheLifetime.Parse(
            ReadPositiveInteger(
                "CTLFLOW_CACHE_TTL_SECONDS",
                DefaultCacheLifetimeSeconds),
            cancellation);
        var workloadTokens = CreateTokenSettings(
            "CTLFLOW_WORKLOAD",
            DefaultWorkloadTokenLifetimeSeconds);
        var invocationTokens = CreateTokenSettings(
            "CTLFLOW_INVOCATION",
            DefaultInvocationTokenLifetimeSeconds);
        var callers = ParseCallers(
            RequireEnvironment("CTLFLOW_RESOLVE_TENANT_CALLERS"));
        var telemetry = TelemetrySettings.Parse(
            RequireEnvironment("OTEL_EXPORTER_OTLP_ENDPOINT"));

        return new ServiceSettings(
            IPAddress.Parse(grpcUri.Host),
            grpcUri.Port,
            IPAddress.Parse(probeUri.Host),
            probeUri.Port,
            databasePath,
            databasePoolSize,
            cacheLifetime,
            workloadTokens,
            invocationTokens,
            callers,
            telemetry);
    }

    private static Uri ParseListenUri(string name, string value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri)
            || uri.Scheme != Uri.UriSchemeHttp
            || !IPAddress.TryParse(uri.Host, out _)
            || uri.Port is < 1 or > 65_535
            || uri.AbsolutePath != "/"
            || !string.IsNullOrEmpty(uri.Query)
            || !string.IsNullOrEmpty(uri.Fragment)
            || !string.IsNullOrEmpty(uri.UserInfo))
        {
            throw new InvalidOperationException(
                $"{name} must be an HTTP URL with an IP host and no path");
        }

        return uri;
    }

    private static TokenValidationSettings CreateTokenSettings(
        string prefix,
        int defaultMaximumLifetimeSeconds)
    {
        var maximumLifetime = TimeSpan.FromSeconds(
            ReadPositiveInteger(
                $"{prefix}_TOKEN_MAX_LIFETIME_SECONDS",
                defaultMaximumLifetimeSeconds));

        if (prefix == "CTLFLOW_INVOCATION"
            && maximumLifetime > TimeSpan.FromSeconds(60))
        {
            throw new InvalidOperationException(
                "Invocation-token maximum lifetime cannot exceed 60 seconds");
        }

        return new TokenValidationSettings(
            RequireEnvironment($"{prefix}_TOKEN_ISSUER"),
            RequireEnvironment($"{prefix}_TOKEN_AUDIENCE"),
            RequireAbsoluteFile($"{prefix}_JWKS_PATH"),
            maximumLifetime,
            KeyCacheLifetime);
    }

    private static IReadOnlySet<KubernetesServiceAccountSubject> ParseCallers(
        string value)
    {
        var callers = new HashSet<KubernetesServiceAccountSubject>();

        foreach (var item in value.Split(',', StringSplitOptions.TrimEntries))
        {
            callers.Add(KubernetesServiceAccountSubject.Parse(item));
        }

        if (callers.Count == 0)
        {
            throw new InvalidOperationException(
                "CTLFLOW_RESOLVE_TENANT_CALLERS must contain at least one caller");
        }

        return callers;
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
        if (!Path.IsPathFullyQualified(value) || !File.Exists(value))
        {
            throw new InvalidOperationException(
                $"{name} must reference an existing absolute file path");
        }

        return Path.GetFullPath(value);
    }

    private static int ReadPositiveInteger(string name, int defaultValue)
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
