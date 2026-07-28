using System.Globalization;
using System.Net;
using CtlFlow.Packages.Pkgd.Service.Security.Operators;
using CtlFlow.Packages.Pkgd.Service.Security.Tokens;
using CtlFlow.Packages.Pkgd.Service.Security.Workloads;
using CtlFlow.Packages.Pkgd.Service.Telemetry;
using static CtlFlow.Packages.Pkgd.Db.Providers.PackageDatabaseProviders;

namespace CtlFlow.Packages.Pkgd.Service.Configuration;

internal static partial class PkgdConfiguration
{
    private const int DefaultDatabasePoolSize = 16;
    private const int DefaultDependencyTimeoutMilliseconds = 2_000;
    private const int DefaultWorkloadTokenLifetimeSeconds = 3_600;
    private const int DefaultInvocationTokenLifetimeSeconds = 60;
    private static readonly TimeSpan KeyCacheLifetime = TimeSpan.FromSeconds(30);

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
        var workloadTokenFile =
            RequireAbsoluteFile("CTLFLOW_WORKLOAD_TOKEN_FILE");
        var getPackageCallers = CreateOperationCallerSettings(
            ParseRequiredCallers(
                "CTLFLOW_GET_PACKAGE_AUTONOMOUS_CALLERS"),
            EmptyCallers());
        var createAppCallers = CreateOperationCallerSettings(
            EmptyCallers(),
            ParseRequiredCallers(
                "CTLFLOW_CREATE_APP_CAPABILITY_CALLERS"));
        var getAppCallers = CreateOperationCallerSettings(
            ParseRequiredCallers(
                "CTLFLOW_GET_APP_AUTONOMOUS_CALLERS"),
            ParseRequiredCallers(
                "CTLFLOW_GET_APP_CAPABILITY_CALLERS"));
        var setAppCallers = CreateOperationCallerSettings(
            EmptyCallers(),
            ParseRequiredCallers(
                "CTLFLOW_SET_APP_PACKAGE_GENERATION_CAPABILITY_CALLERS"));
        EnsureAdmissionPathsAreDisjoint(
            [getPackageCallers, createAppCallers, getAppCallers, setAppCallers]);

        return new ServiceSettings(
            IPAddress.Parse(grpcUri.Host),
            grpcUri.Port,
            IPAddress.Parse(probeUri.Host),
            probeUri.Port,
            new TlsSettings(
                RequireAbsoluteFile("CTLFLOW_TLS_CERTIFICATE_PATH"),
                RequireAbsoluteFile("CTLFLOW_TLS_PRIVATE_KEY_PATH"),
                RequireAbsoluteFile(
                    "CTLFLOW_KUBERNETES_CLIENT_CA_PATH")),
            database,
            CreateDependencySettings<AuditSettings>(
                "AUDIT",
                workloadTokenFile,
                static (grpc, token, timeout) =>
                    new AuditSettings(grpc, token, timeout)),
            CreateDependencySettings<IdentitySettings>(
                "IDENTITY",
                workloadTokenFile,
                static (grpc, token, timeout) =>
                    new IdentitySettings(grpc, token, timeout)),
            CreateDependencySettings<PolicySettings>(
                "POLICY",
                workloadTokenFile,
                static (grpc, token, timeout) =>
                    new PolicySettings(grpc, token, timeout)),
            new WorkloadTokenSettings(
                CreateTokenSettings(
                    "CTLFLOW_WORKLOAD",
                    DefaultWorkloadTokenLifetimeSeconds),
                RequireAbsoluteFile("CTLFLOW_WORKLOAD_JWKS_PATH"),
                KeyCacheLifetime),
            CreateTokenSettings(
                "CTLFLOW_INVOCATION",
                DefaultInvocationTokenLifetimeSeconds),
            ParseOperatorSubjects("CTLFLOW_OPERATOR_SUBJECTS"),
            getPackageCallers,
            createAppCallers,
            getAppCallers,
            setAppCallers,
            TelemetrySettings.Parse(
                RequireEnvironment("OTEL_EXPORTER_OTLP_ENDPOINT")));
    }

    private static T CreateDependencySettings<T>(
        string dependency,
        string workloadTokenFile,
        Func<PrivateGrpcSettings, string, TimeSpan, T> create)
    {
        var prefix = $"CTLFLOW_{dependency}";
        var endpoint = ParsePrivateOrigin(
            $"{prefix}_URL",
            RequireEnvironment($"{prefix}_URL"));
        var grpc = new PrivateGrpcSettings(
            endpoint,
            RequireDnsName($"{prefix}_TLS_SERVER_NAME"),
            RequireAbsoluteFile($"{prefix}_TLS_CA_PATH"));
        var timeout = TimeSpan.FromMilliseconds(ReadPositiveInteger(
            $"{prefix}_CALL_TIMEOUT_MILLISECONDS",
            DefaultDependencyTimeoutMilliseconds));
        return create(grpc, workloadTokenFile, timeout);
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
            maximumLifetime);
    }

    private static IReadOnlySet<KubernetesServiceAccountSubject>
        ParseRequiredCallers(string name)
    {
        var callers = ParseCallers(name, RequireEnvironment(name));
        if (callers.Count == 0)
        {
            throw new InvalidOperationException(
                $"{name} must contain at least one caller");
        }

        return callers;
    }

    private static IReadOnlySet<KubernetesServiceAccountSubject> ParseCallers(
        string name,
        string value)
    {
        var callers = new HashSet<KubernetesServiceAccountSubject>();
        foreach (var item in value.Split(
                     ',',
                     StringSplitOptions.TrimEntries
                         | StringSplitOptions.RemoveEmptyEntries))
        {
            if (!callers.Add(KubernetesServiceAccountSubject.Parse(item)))
            {
                throw new InvalidOperationException(
                    $"{name} contains a duplicate caller");
            }
        }

        return callers;
    }

    private static OperationCallerSettings CreateOperationCallerSettings(
        IReadOnlySet<KubernetesServiceAccountSubject> autonomousCallers,
        IReadOnlySet<KubernetesServiceAccountSubject> capabilityCallers)
    {
        if (autonomousCallers.Overlaps(capabilityCallers))
        {
            throw new InvalidOperationException(
                "An operation caller cannot use two admission paths");
        }

        return new OperationCallerSettings(
            autonomousCallers,
            capabilityCallers);
    }

    private static void EnsureAdmissionPathsAreDisjoint(
        IReadOnlyList<OperationCallerSettings> operations)
    {
        var autonomous = new HashSet<KubernetesServiceAccountSubject>();
        var capability = new HashSet<KubernetesServiceAccountSubject>();
        foreach (var operation in operations)
        {
            autonomous.UnionWith(operation.AutonomousCallers);
            capability.UnionWith(operation.CapabilityCallers);
        }

        if (autonomous.Overlaps(capability))
        {
            throw new InvalidOperationException(
                "Autonomous and capability callers must be disjoint");
        }
    }

    private static IReadOnlySet<KubernetesServiceAccountSubject>
        EmptyCallers() =>
        new HashSet<KubernetesServiceAccountSubject>();

    private static IReadOnlySet<KubernetesOperatorSubject>
        ParseOperatorSubjects(string name)
    {
        var subjects = new HashSet<KubernetesOperatorSubject>();
        foreach (var item in RequireEnvironment(name).Split(
                     ',',
                     StringSplitOptions.TrimEntries
                         | StringSplitOptions.RemoveEmptyEntries))
        {
            if (!subjects.Add(KubernetesOperatorSubject.Parse(item)))
            {
                throw new InvalidOperationException(
                    $"{name} contains a duplicate subject");
            }
        }

        if (subjects.Count == 0)
        {
            throw new InvalidOperationException(
                $"{name} must contain at least one subject");
        }

        return subjects;
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

    private static string RequireDnsName(string name)
    {
        var value = RequireEnvironment(name);
        if (value.Length is > 253
            || Uri.CheckHostName(value) != UriHostNameType.Dns)
        {
            throw new InvalidOperationException(
                $"{name} must be a DNS name");
        }

        return value;
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
