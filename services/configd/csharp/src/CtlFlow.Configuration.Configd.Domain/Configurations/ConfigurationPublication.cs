using CtlFlow.Configuration.Configd.Domain.Auditing;

namespace CtlFlow.Configuration.Configd.Domain.Configurations;

public sealed record ConfigurationPublication(
    ConfigurationMetadata Configuration,
    ConfigurationVersionMetadata Version,
    PublicationAuditIntent Audit);
