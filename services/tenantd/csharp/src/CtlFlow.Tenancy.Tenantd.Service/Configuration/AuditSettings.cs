using CtlFlow.Tenancy.Tenantd.Domain.Auditing;

namespace CtlFlow.Tenancy.Tenantd.Service.Configuration;

internal sealed record AuditSettings(
    Uri Endpoint,
    string WorkloadTokenFile,
    AuditBatchSize BatchSize,
    TimeSpan LeaseDuration,
    TimeSpan CallTimeout,
    TimeSpan RetryBaseDelay,
    TimeSpan RetryMaximumDelay,
    TimeSpan IdleDelay);
