using CtlFlow.Configuration.Configd.Domain.Bindings;
using CtlFlow.Configuration.Configd.Domain.Identifiers;
using CtlFlow.Configuration.Configd.Domain.Revisions;
using CtlFlow.Configuration.Configd.Domain.Time;

namespace CtlFlow.Configuration.Configd.Domain.Projections;

public sealed record ProjectionMetadata(
    ProjectionId Id,
    ProjectionTarget Target,
    ConsumerBinding Binding,
    Revision Revision,
    UtcInstant CreatedAt,
    UtcInstant UpdatedAt);
