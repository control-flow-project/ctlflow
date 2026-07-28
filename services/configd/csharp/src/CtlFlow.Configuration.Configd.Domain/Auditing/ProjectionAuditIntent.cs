using CtlFlow.Configuration.Configd.Domain.Bindings;
using CtlFlow.Configuration.Configd.Domain.Identifiers;
using CtlFlow.Configuration.Configd.Domain.Projections;
using CtlFlow.Configuration.Configd.Domain.Revisions;

namespace CtlFlow.Configuration.Configd.Domain.Auditing;

public sealed record ProjectionAuditIntent(
    AuditEnvelope Envelope,
    ProjectionId ProjectionId,
    ProjectionAuditAction Action,
    Revision ProjectionRevision,
    ProjectionTarget Target,
    ConsumerBinding Binding) : ConfigdAuditIntent(Envelope);
