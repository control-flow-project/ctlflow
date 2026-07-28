using CtlFlow.Configuration.Configd.Domain.Auditing;

namespace CtlFlow.Configuration.Configd.Domain.Secrets;

public sealed record SecretPublication(
    SecretMetadata Secret,
    SecretVersionMetadata Version,
    PublicationAuditIntent Audit);
