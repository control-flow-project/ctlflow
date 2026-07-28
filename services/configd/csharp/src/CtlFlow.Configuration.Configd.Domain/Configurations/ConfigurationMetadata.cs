using CtlFlow.Configuration.Configd.Domain.Bindings;
using CtlFlow.Configuration.Configd.Domain.Identifiers;
using CtlFlow.Configuration.Configd.Domain.Revisions;
using CtlFlow.Configuration.Configd.Domain.Time;

namespace CtlFlow.Configuration.Configd.Domain.Configurations;

public sealed record ConfigurationMetadata(
    ConfigurationId Id,
    ConsumerBinding Binding,
    ConfigurationVersionId CurrentVersionId,
    Revision Revision,
    UtcInstant CreatedAt,
    UtcInstant UpdatedAt);
