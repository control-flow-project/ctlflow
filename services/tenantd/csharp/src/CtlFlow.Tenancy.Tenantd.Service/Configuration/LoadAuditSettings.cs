using CtlFlow.Tenancy.Tenantd.Domain.Auditing;

namespace CtlFlow.Tenancy.Tenantd.Service.Configuration;

internal static partial class TenantdConfiguration
{
    private const int DefaultAuditBatchSize = 32;
    private const int DefaultAuditLeaseMilliseconds = 10_000;
    private const int DefaultAuditCallTimeoutMilliseconds = 2_000;
    private const int DefaultAuditRetryBaseMilliseconds = 100;
    private const int DefaultAuditRetryMaximumMilliseconds = 2_000;
    private const int DefaultAuditIdleMilliseconds = 50;

    private static async Task<AuditSettings> LoadAuditSettings(
        CancellationToken cancellation)
    {
        var endpointValue = RequireEnvironment("CTLFLOW_AUDIT_URL");
        if (!Uri.TryCreate(endpointValue, UriKind.Absolute, out var endpoint)
            || endpoint.Scheme != Uri.UriSchemeHttp
            || string.IsNullOrEmpty(endpoint.Host)
            || endpoint.Port is < 1 or > 65_535
            || endpoint.AbsolutePath != "/"
            || !string.IsNullOrEmpty(endpoint.Query)
            || !string.IsNullOrEmpty(endpoint.Fragment)
            || !string.IsNullOrEmpty(endpoint.UserInfo))
        {
            throw new InvalidOperationException(
                "CTLFLOW_AUDIT_URL must be a private HTTP origin");
        }

        var batchSize = await AuditBatchSize.Parse(
            ReadPositiveInteger(
                "CTLFLOW_AUDIT_BATCH_SIZE",
                DefaultAuditBatchSize),
            cancellation);
        var leaseDuration = ReadDuration(
            "CTLFLOW_AUDIT_LEASE_MILLISECONDS",
            DefaultAuditLeaseMilliseconds);
        var callTimeout = ReadDuration(
            "CTLFLOW_AUDIT_CALL_TIMEOUT_MILLISECONDS",
            DefaultAuditCallTimeoutMilliseconds);
        var retryBase = ReadDuration(
            "CTLFLOW_AUDIT_RETRY_BASE_MILLISECONDS",
            DefaultAuditRetryBaseMilliseconds);
        var retryMaximum = ReadDuration(
            "CTLFLOW_AUDIT_RETRY_MAXIMUM_MILLISECONDS",
            DefaultAuditRetryMaximumMilliseconds);
        if (retryMaximum < retryBase)
        {
            throw new InvalidOperationException(
                "Audit retry maximum must not be shorter than its base");
        }

        return new AuditSettings(
            endpoint,
            RequireAbsoluteFile("CTLFLOW_AUDIT_TOKEN_FILE"),
            batchSize,
            leaseDuration,
            callTimeout,
            retryBase,
            retryMaximum,
            ReadDuration(
                "CTLFLOW_AUDIT_IDLE_MILLISECONDS",
                DefaultAuditIdleMilliseconds));
    }

    private static TimeSpan ReadDuration(
        string name,
        int defaultMilliseconds) =>
        TimeSpan.FromMilliseconds(ReadPositiveInteger(
            name,
            defaultMilliseconds));
}
