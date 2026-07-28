using CtlFlow.Configuration.Configd.Domain.Identifiers;
using CtlFlow.Configuration.Configd.Domain.Time;

namespace CtlFlow.Configuration.Configd.Domain.Secrets;

public sealed record SecretVersionMetadata(
    SecretVersionId Id,
    SecretId SecretId,
    UtcInstant CreatedAt);
