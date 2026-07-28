using CtlFlow.Configuration.Configd.Domain.Auditing;
using CtlFlow.Configuration.Configd.Domain.Projections;

namespace CtlFlow.Configuration.Configd.Db.Projections;

public sealed record ProjectionCompletion(
    ProjectionMetadata Projection,
    ProjectionAuditIntent? Audit);
