using System.Globalization;
using System.Net;
using System.Text.Json;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Service.Security.Operators;
using CtlFlow.Execution.Execd.Service.Security.Tokens;
using CtlFlow.Execution.Execd.Service.Security.Workloads;
using CtlFlow.Execution.Execd.Service.Telemetry;
using static CtlFlow.Execution.Execd.Db.Providers.ExecutionDatabaseProviders;

namespace CtlFlow.Execution.Execd.Service.Configuration;

internal static partial class ExecdConfiguration
{
    private const int DefaultDatabasePoolSize = 16;
    private const int DefaultDependencyTimeoutMilliseconds = 2_000;
    private const int DefaultKubernetesTimeoutMilliseconds = 5_000;
    private const int DefaultReconcileIntervalMilliseconds = 250;
    private const int DefaultWorkloadTokenLifetimeSeconds = 3_600;
    private const int DefaultInvocationTokenLifetimeSeconds = 60;
    private const int MinimumProjectedWorkloadTokenLifetimeSeconds = 600;
    private static readonly TimeSpan KeyCacheLifetime =
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
                DefaultDatabasePoolSize).ToString(
                    CultureInfo.InvariantCulture),
            cancellation);
        var workloadTokenFile =
            RequireAbsoluteFile("CTLFLOW_WORKLOAD_TOKEN_FILE");
        var kubernetesEndpoint = ParsePrivateOrigin(
            "CTLFLOW_KUBERNETES_API_URL",
            RequireEnvironment("CTLFLOW_KUBERNETES_API_URL"));
        var identity = CreateDependencySettings(
            "IDENTITY",
            workloadTokenFile,
            static (grpc, token, timeout) =>
                new IdentitySettings(grpc, token, timeout));
        var telemetry = TelemetrySettings.Parse(
            RequireEnvironment("OTEL_EXPORTER_OTLP_ENDPOINT"));
        var identityCertificateAuthority =
            await ReadCertificateAuthority(
                identity.Grpc.CertificateAuthorityPath,
                "Identityd",
                cancellation);
        var policy = CreateDependencySettings(
            "POLICY",
            workloadTokenFile,
            static (grpc, token, timeout) =>
                new PolicySettings(grpc, token, timeout));
        var workloadTokenValidation = CreateTokenSettings(
            "CTLFLOW_WORKLOAD",
            DefaultWorkloadTokenLifetimeSeconds);
        if (workloadTokenValidation.MaximumLifetime
            < TimeSpan.FromSeconds(
                MinimumProjectedWorkloadTokenLifetimeSeconds))
        {
            throw new InvalidOperationException(
                "Workload-token maximum lifetime cannot be less than "
                + "600 seconds");
        }
        var invocationTokenValidation = CreateTokenSettings(
            "CTLFLOW_INVOCATION",
            DefaultInvocationTokenLifetimeSeconds);
        var workloadJwksPath =
            RequireAbsoluteFile("CTLFLOW_WORKLOAD_JWKS_PATH");
        var bootstrap = new ProductBootstrapSettings(
            identity.Grpc.Endpoint,
            identityCertificateAuthority,
            policy.Grpc.Endpoint,
            await ReadCertificateAuthority(
                policy.Grpc.CertificateAuthorityPath,
                "Policyd",
                cancellation),
            await ReadWorkloadVerificationKeySet(
                workloadJwksPath,
                cancellation),
            workloadTokenValidation.Issuer,
            workloadTokenValidation.Audience,
            (long)workloadTokenValidation.MaximumLifetime.TotalSeconds,
            invocationTokenValidation.Issuer,
            invocationTokenValidation.Audience);

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
            CreateDependencySettings(
                "AUDIT",
                workloadTokenFile,
                static (grpc, token, timeout) =>
                    new AuditSettings(grpc, token, timeout)),
            identity,
            policy,
            CreateDependencySettings(
                "PACKAGE",
                workloadTokenFile,
                static (grpc, token, timeout) =>
                    new PackageSettings(grpc, token, timeout)),
            CreateDependencySettings(
                "CONFIGURATION",
                workloadTokenFile,
                static (grpc, token, timeout) =>
                    new ConfigurationSettings(grpc, token, timeout)),
            new KubernetesSettings(
                kubernetesEndpoint,
                RequireAbsoluteFile(
                    "CTLFLOW_KUBERNETES_API_CA_PATH"),
                RequireAbsoluteFile(
                    "CTLFLOW_KUBERNETES_API_TOKEN_FILE"),
                TimeSpan.FromMilliseconds(ReadPositiveInteger(
                    "CTLFLOW_KUBERNETES_API_CALL_TIMEOUT_MILLISECONDS",
                    DefaultKubernetesTimeoutMilliseconds)),
                TimeSpan.FromMilliseconds(ReadPositiveInteger(
                    "CTLFLOW_RECONCILE_INTERVAL_MILLISECONDS",
                    DefaultReconcileIntervalMilliseconds)),
                new EdgedSettings(
                    RequireImage("CTLFLOW_EDGED_IMAGE"),
                    identity.Grpc.Endpoint,
                    identity.Grpc.ServerName,
                    identityCertificateAuthority,
                    identity.CallTimeout,
                    telemetry.OtlpEndpoint),
                bootstrap),
            new ProvisionerSettings(
                await LoadProvisioners(
                    RequireAbsoluteFile(
                        "CTLFLOW_PROVISIONER_SUBJECTS_PATH"),
                    cancellation)),
            new WorkloadTokenSettings(
                workloadTokenValidation,
                workloadJwksPath,
                KeyCacheLifetime),
            invocationTokenValidation,
            ParseOperatorSubjects("CTLFLOW_OPERATOR_SUBJECTS"),
            ParseCallers("CTLFLOW_CAPABILITY_CALLERS"),
            KubernetesServiceAccountSubject.Parse(
                RequireEnvironment("CTLFLOW_POLICYD_CALLER")),
            telemetry);
    }

    private static async Task<string> ReadCertificateAuthority(
        string path,
        string owner,
        CancellationToken cancellation)
    {
        var value = await File.ReadAllTextAsync(path, cancellation);
        if (value.Length is 0 or > 65_536
            || !value.Contains(
                "-----BEGIN CERTIFICATE-----",
                StringComparison.Ordinal)
            || !value.Contains(
                "-----END CERTIFICATE-----",
                StringComparison.Ordinal))
        {
            throw new InvalidOperationException(
                $"{owner} certificate authority is invalid");
        }

        return value;
    }

    private static async Task<string> ReadWorkloadVerificationKeySet(
        string path,
        CancellationToken cancellation)
    {
        var value = await File.ReadAllTextAsync(path, cancellation);
        if (value.Length is 0 or > 262_144)
        {
            throw new InvalidOperationException(
                "Workload verification key set is invalid");
        }

        using var document = JsonDocument.Parse(value);
        if (document.RootElement.ValueKind != JsonValueKind.Object)
        {
            throw new InvalidOperationException(
                "Workload verification key set must be one JSON object");
        }

        return value;
    }

    private static T CreateDependencySettings<T>(
        string dependency,
        string workloadTokenFile,
        Func<PrivateGrpcSettings, string, TimeSpan, T> create)
    {
        var prefix = $"CTLFLOW_{dependency}";
        var grpc = new PrivateGrpcSettings(
            ParsePrivateOrigin(
                $"{prefix}_URL",
                RequireEnvironment($"{prefix}_URL")),
            RequireDnsName($"{prefix}_TLS_SERVER_NAME"),
            RequireAbsoluteFile($"{prefix}_TLS_CA_PATH"));
        return create(
            grpc,
            workloadTokenFile,
            TimeSpan.FromMilliseconds(ReadPositiveInteger(
                $"{prefix}_CALL_TIMEOUT_MILLISECONDS",
                DefaultDependencyTimeoutMilliseconds)));
    }

    private static async Task<IReadOnlyDictionary<
        ProvisionerId,
        ProvisionerSubject>> LoadProvisioners(
        string path,
        CancellationToken cancellation)
    {
        await using var stream = File.OpenRead(path);
        using var document = await JsonDocument.ParseAsync(
            stream,
            new JsonDocumentOptions
            {
                AllowTrailingCommas = false,
                CommentHandling = JsonCommentHandling.Disallow,
                MaxDepth = 4
            },
            cancellation);
        if (document.RootElement.ValueKind != JsonValueKind.Object)
        {
            throw new InvalidOperationException(
                "Provisioner subjects must be one JSON object");
        }

        var result =
            new Dictionary<ProvisionerId, ProvisionerSubject>();
        foreach (var property in document.RootElement.EnumerateObject())
        {
            if (property.Value.ValueKind != JsonValueKind.String
                || !result.TryAdd(
                    ProvisionerId.Parse(property.Name),
                    ProvisionerSubject.Parse(
                        property.Value.GetString()!)))
            {
                throw new InvalidOperationException(
                    "Provisioner subjects are invalid");
            }
        }

        if (result.Count > 256)
        {
            throw new InvalidOperationException(
                "Provisioner subject count exceeds 256");
        }

        return result;
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
                $"{name} must be one HTTPS origin");
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
        ParseCallers(string name)
    {
        var callers = new HashSet<KubernetesServiceAccountSubject>();
        var value = Environment.GetEnvironmentVariable(name);
        if (string.IsNullOrWhiteSpace(value))
        {
            return callers;
        }

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
        if (value.Length > 253
            || Uri.CheckHostName(value) != UriHostNameType.Dns)
        {
            throw new InvalidOperationException(
                $"{name} must be a DNS name");
        }

        return value;
    }

    private static string RequireImage(string name)
    {
        var value = RequireEnvironment(name);
        var separator = value.LastIndexOf("@sha256:", StringComparison.Ordinal);
        if (separator < 1
            || value.Length - separator != 72
            || value.AsSpan(separator + 8).ContainsAnyExcept(
                "0123456789abcdef"))
        {
            throw new InvalidOperationException(
                $"{name} must be one digest-bound OCI image");
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
