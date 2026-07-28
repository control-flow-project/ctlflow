using CtlFlow.Configuration.Configd.Domain.Bindings;
using CtlFlow.Configuration.Configd.Domain.Claims;
using CtlFlow.Configuration.Configd.Domain.Projections;
using CtlFlow.Configuration.Configd.Domain.Revisions;

namespace CtlFlow.Configuration.Configd.Domain.Auditing;

public sealed record PublicationAuditIntent(
    AuditEnvelope Envelope,
    ProjectionTarget Target,
    ConsumerBinding Binding,
    Revision IdentityRevision,
    DependencyClaimSelector? DependencyClaim) : ConfigdAuditIntent(Envelope);
