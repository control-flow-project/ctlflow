using System.Globalization;
using System.Net;
using CtlFlow.Identity.Identityd.Domain.Invocations;
using CtlFlow.Identity.Identityd.Domain.Keys;
using CtlFlow.Identity.Identityd.Domain.Sessions;
using CtlFlow.Identity.Identityd.Service.Security.Tokens;
using CtlFlow.Identity.Identityd.Service.Security.Workloads;
using CtlFlow.Identity.Identityd.Service.Telemetry;
using static CtlFlow.Identity.Identityd.Db.Providers.IdentityDatabaseProviders;

namespace CtlFlow.Identity.Identityd.Service.Configuration;

internal static partial class IdentitydConfiguration
{
    private const int DefaultDatabasePoolSize = 16;
    private const int DefaultAuditCallTimeoutMilliseconds = 2_000;
    private const int DefaultPolicyCallTimeoutMilliseconds = 2_000;
    private const int DefaultWorkloadTokenLifetimeSeconds = 3_600;
    private const int DefaultInvocationTokenLifetimeSeconds = 60;
    private const int DefaultKeyCacheSeconds = 30;
    private const int DefaultSessionLifetimeSeconds = 43_200;

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
            "CTLFLOW_INVOCATION_KEY_CACHE_SECONDS",
            DefaultKeyCacheSeconds);
        if (keyCacheSeconds > 300)
        {
            throw new InvalidOperationException(
                "Invocation key cache cannot exceed 300 seconds");
        }
        var auditEndpoint = ParsePrivateOrigin(
            "CTLFLOW_AUDIT_URL",
            RequireEnvironment("CTLFLOW_AUDIT_URL"));
        var policyEndpoint = ParsePrivateOrigin(
            "CTLFLOW_POLICY_URL",
            RequireEnvironment("CTLFLOW_POLICY_URL"));
        var workloadTokenFile =
            RequireAbsoluteFile("CTLFLOW_WORKLOAD_TOKEN_FILE");
        var invocationTokens = CreateTokenSettings(
            "CTLFLOW_INVOCATION",
            DefaultInvocationTokenLifetimeSeconds);
        var workloadTokens = CreateTokenSettings(
            "CTLFLOW_WORKLOAD",
            DefaultWorkloadTokenLifetimeSeconds);
        var getLoginProviderAuthdCallers = ParseRequiredCallers(
            "CTLFLOW_GET_LOGIN_PROVIDER_AUTHD_CALLERS");
        var getWorkspaceAdmissionAuthdCallers = ParseRequiredCallers(
            "CTLFLOW_GET_WORKSPACE_LOGIN_PROVIDER_ADMISSION_AUTHD_CALLERS");
        var administration = LoadIdentityAdminSettings();
        ValidateProviderReadCallers(
            administration,
            getLoginProviderAuthdCallers,
            getWorkspaceAdmissionAuthdCallers);

        return new ServiceSettings(
            IPAddress.Parse(grpcUri.Host),
            grpcUri.Port,
            IPAddress.Parse(probeUri.Host),
            probeUri.Port,
            new TlsSettings(
                RequireAbsoluteFile("CTLFLOW_TLS_CERTIFICATE_PATH"),
                RequireAbsoluteFile("CTLFLOW_TLS_PRIVATE_KEY_PATH")),
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
                workloadTokens,
                RequireAbsoluteFile("CTLFLOW_WORKLOAD_JWKS_PATH"),
                TimeSpan.FromSeconds(keyCacheSeconds)),
            new TokenValidationSettings(
                workloadTokens.Issuer,
                "ctlflow-edged",
                workloadTokens.MaximumLifetime),
            invocationTokens,
            new SigningSettings(
                VerificationKeyId.Parse(
                    RequireEnvironment(
                        "CTLFLOW_INVOCATION_SIGNING_KEY_ID")),
                RequireAbsoluteFile(
                    "CTLFLOW_INVOCATION_SIGNING_PRIVATE_KEY_PATH"),
                InvocationLifetime.Parse(
                    invocationTokens.MaximumLifetime)),
            SessionLifetime.Parse(TimeSpan.FromSeconds(
                ReadPositiveInteger(
                    "CTLFLOW_SESSION_LIFETIME_SECONDS",
                    DefaultSessionLifetimeSeconds))),
            TimeSpan.FromSeconds(keyCacheSeconds),
            ParseRequiredCallers(
                "CTLFLOW_RESOLVE_PRINCIPAL_CALLERS"),
            ParseRequiredCallers(
                "CTLFLOW_LIST_PRINCIPAL_GROUPS_CALLERS"),
            ParseRequiredCallers("CTLFLOW_CREATE_SESSION_CALLERS"),
            ParseRequiredCallers("CTLFLOW_REVOKE_SESSION_CALLERS"),
            ParseRequiredCallers(
                "CTLFLOW_ISSUE_RUN_INVOCATION_CALLERS"),
            getLoginProviderAuthdCallers,
            getWorkspaceAdmissionAuthdCallers,
            administration,
            TelemetrySettings.Parse(
                RequireEnvironment("OTEL_EXPORTER_OTLP_ENDPOINT")));
    }

    private static void ValidateProviderReadCallers(
        IdentityAdminSettings administration,
        IReadOnlySet<KubernetesServiceAccountSubject> getProviderAuthd,
        IReadOnlySet<KubernetesServiceAccountSubject> getAdmissionAuthd)
    {
        if (getProviderAuthd.Overlaps(administration.GetCallers(
                IdentityAdminOperation.GetLoginProvider))
            || getAdmissionAuthd.Overlaps(administration.GetCallers(
                IdentityAdminOperation
                    .GetWorkspaceLoginProviderAdmission)))
        {
            throw new InvalidOperationException(
                "Autonomous Authd and capability callers must be disjoint");
        }
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
        var maximumLifetimeSeconds = ReadPositiveInteger(
            $"{prefix}_TOKEN_MAX_LIFETIME_SECONDS",
            defaultMaximumLifetimeSeconds);
        if (prefix == "CTLFLOW_INVOCATION"
            && maximumLifetimeSeconds > 60)
        {
            throw new InvalidOperationException(
                "Invocation-token maximum lifetime cannot exceed 60 seconds");
        }

        return new TokenValidationSettings(
            RequireEnvironment($"{prefix}_TOKEN_ISSUER"),
            RequireEnvironment($"{prefix}_TOKEN_AUDIENCE"),
            TimeSpan.FromSeconds(maximumLifetimeSeconds));
    }

    private static IReadOnlySet<KubernetesServiceAccountSubject>
        ParseRequiredCallers(string name)
    {
        var callers = new HashSet<KubernetesServiceAccountSubject>();
        foreach (var value in RequireEnvironment(name).Split(
                     ',',
                     StringSplitOptions.TrimEntries
                         | StringSplitOptions.RemoveEmptyEntries))
        {
            callers.Add(KubernetesServiceAccountSubject.Parse(value));
        }

        return callers.Count > 0
            ? callers
            : throw new InvalidOperationException(
                $"{name} must contain at least one caller");
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
                $"{name} must reference an existing absolute file path");
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
