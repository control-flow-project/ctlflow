using System.Globalization;
using System.Net;
using CtlFlow.Tenancy.Tenantd.Service.Security.Operators;
using CtlFlow.Tenancy.Tenantd.Service.Security.Tokens;
using CtlFlow.Tenancy.Tenantd.Service.Security.Workloads;
using CtlFlow.Tenancy.Tenantd.Service.Telemetry;
using static CtlFlow.Tenancy.Tenantd.Db.Providers.TenantDatabaseProviders;

namespace CtlFlow.Tenancy.Tenantd.Service.Configuration;

internal static partial class TenantdConfiguration
{
    private const int DefaultDatabasePoolSize = 16;
    private const int DefaultAuditCallTimeoutMilliseconds = 2_000;
    private const int DefaultIdentityCallTimeoutMilliseconds = 2_000;
    private const int DefaultPolicyCallTimeoutMilliseconds = 2_000;
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
        var auditEndpoint = ParsePrivateOrigin(
            "CTLFLOW_AUDIT_URL",
            RequireEnvironment("CTLFLOW_AUDIT_URL"));
        var identityEndpoint = ParsePrivateOrigin(
            "CTLFLOW_IDENTITY_URL",
            RequireEnvironment("CTLFLOW_IDENTITY_URL"));
        var policyEndpoint = ParsePrivateOrigin(
            "CTLFLOW_POLICY_URL",
            RequireEnvironment("CTLFLOW_POLICY_URL"));
        var workloadTokenFile =
            RequireAbsoluteFile("CTLFLOW_WORKLOAD_TOKEN_FILE");
        var getTenantCallers = CreateOperationCallerSettings(
            ParseRequiredCallers(
                "CTLFLOW_GET_TENANT_AUTONOMOUS_CALLERS"),
            ParseOptionalCallers(
                "CTLFLOW_GET_TENANT_CAPABILITY_CALLERS"));
        var updateTenantCallers = CreateOperationCallerSettings(
            EmptyCallers(),
            ParseOptionalCallers(
                "CTLFLOW_UPDATE_TENANT_CAPABILITY_CALLERS"));
        var createWorkspaceCallers = CreateOperationCallerSettings(
            EmptyCallers(),
            ParseOptionalCallers(
                "CTLFLOW_CREATE_WORKSPACE_CAPABILITY_CALLERS"));
        var getWorkspaceCallers = CreateOperationCallerSettings(
            ParseRequiredCallers(
                "CTLFLOW_GET_WORKSPACE_AUTONOMOUS_CALLERS"),
            ParseOptionalCallers(
                "CTLFLOW_GET_WORKSPACE_CAPABILITY_CALLERS"));
        var listWorkspaceCallers = CreateOperationCallerSettings(
            EmptyCallers(),
            ParseOptionalCallers(
                "CTLFLOW_LIST_WORKSPACES_CAPABILITY_CALLERS"));
        var updateWorkspaceCallers = CreateOperationCallerSettings(
            EmptyCallers(),
            ParseOptionalCallers(
                "CTLFLOW_UPDATE_WORKSPACE_CAPABILITY_CALLERS"));
        var setWorkspaceStateCallers = CreateOperationCallerSettings(
            EmptyCallers(),
            ParseOptionalCallers(
                "CTLFLOW_SET_WORKSPACE_STATE_CAPABILITY_CALLERS"));
        var resolveTenantCallers = CreateOperationCallerSettings(
            ParseRequiredCallers(
                "CTLFLOW_RESOLVE_TENANT_AUTONOMOUS_CALLERS"),
            EmptyCallers());
        var resolveWorkspaceCallers = CreateOperationCallerSettings(
            ParseRequiredCallers(
                "CTLFLOW_RESOLVE_WORKSPACE_AUTONOMOUS_CALLERS"),
            EmptyCallers());
        EnsureAdmissionPathsAreDisjoint(
            [
                getTenantCallers,
                updateTenantCallers,
                createWorkspaceCallers,
                getWorkspaceCallers,
                listWorkspaceCallers,
                updateWorkspaceCallers,
                setWorkspaceStateCallers,
                resolveTenantCallers,
                resolveWorkspaceCallers
            ]);

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
            new AuditSettings(
                new PrivateGrpcSettings(
                    auditEndpoint,
                    RequireDnsName("CTLFLOW_AUDIT_TLS_SERVER_NAME"),
                    RequireAbsoluteFile("CTLFLOW_AUDIT_TLS_CA_PATH")),
                workloadTokenFile,
                TimeSpan.FromMilliseconds(ReadPositiveInteger(
                    "CTLFLOW_AUDIT_CALL_TIMEOUT_MILLISECONDS",
                    DefaultAuditCallTimeoutMilliseconds))),
            new IdentitySettings(
                new PrivateGrpcSettings(
                    identityEndpoint,
                    RequireDnsName("CTLFLOW_IDENTITY_TLS_SERVER_NAME"),
                    RequireAbsoluteFile("CTLFLOW_IDENTITY_TLS_CA_PATH")),
                workloadTokenFile,
                TimeSpan.FromMilliseconds(ReadPositiveInteger(
                    "CTLFLOW_IDENTITY_CALL_TIMEOUT_MILLISECONDS",
                    DefaultIdentityCallTimeoutMilliseconds))),
            new PolicySettings(
                new PrivateGrpcSettings(
                    policyEndpoint,
                    RequireDnsName("CTLFLOW_POLICY_TLS_SERVER_NAME"),
                    RequireAbsoluteFile("CTLFLOW_POLICY_TLS_CA_PATH")),
                workloadTokenFile,
                TimeSpan.FromMilliseconds(ReadPositiveInteger(
                    "CTLFLOW_POLICY_CALL_TIMEOUT_MILLISECONDS",
                    DefaultPolicyCallTimeoutMilliseconds))),
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
            getTenantCallers,
            updateTenantCallers,
            createWorkspaceCallers,
            getWorkspaceCallers,
            listWorkspaceCallers,
            updateWorkspaceCallers,
            setWorkspaceStateCallers,
            resolveTenantCallers,
            resolveWorkspaceCallers,
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

    private static IReadOnlySet<KubernetesServiceAccountSubject>
        ParseOptionalCallers(string name)
    {
        var value = Environment.GetEnvironmentVariable(name);
        return string.IsNullOrWhiteSpace(value)
            ? EmptyCallers()
            : ParseCallers(name, value);
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
            callers.Add(KubernetesServiceAccountSubject.Parse(item));
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
        var autonomous =
            new HashSet<KubernetesServiceAccountSubject>();
        var capability =
            new HashSet<KubernetesServiceAccountSubject>();
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
        EmptyCallers()
    {
        return new HashSet<KubernetesServiceAccountSubject>();
    }

    private static IReadOnlySet<KubernetesOperatorSubject>
        ParseOperatorSubjects(string name)
    {
        var subjects = new HashSet<KubernetesOperatorSubject>();
        foreach (var item in RequireEnvironment(name).Split(
                     ',',
                     StringSplitOptions.TrimEntries
                         | StringSplitOptions.RemoveEmptyEntries))
        {
            subjects.Add(KubernetesOperatorSubject.Parse(item));
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
