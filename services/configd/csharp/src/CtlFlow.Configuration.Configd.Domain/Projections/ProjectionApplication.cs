using CtlFlow.Configuration.Configd.Domain.Auditing;

namespace CtlFlow.Configuration.Configd.Domain.Projections;

public sealed record ProjectionApplication(
    ProjectionMetadata Projection,
    ProjectionAuditIntent Audit);
