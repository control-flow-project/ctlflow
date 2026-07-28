using CtlFlow.Configuration.Configd.Domain.Bindings;
using CtlFlow.Configuration.Configd.Domain.Identifiers;
using CtlFlow.Configuration.Configd.Domain.Revisions;
using CtlFlow.Configuration.Configd.Domain.Time;

namespace CtlFlow.Configuration.Configd.Domain.Secrets;

public sealed record SecretMetadata(
    SecretId Id,
    ConsumerBinding Binding,
    SecretVersionId CurrentVersionId,
    Revision Revision,
    UtcInstant CreatedAt,
    UtcInstant UpdatedAt);
