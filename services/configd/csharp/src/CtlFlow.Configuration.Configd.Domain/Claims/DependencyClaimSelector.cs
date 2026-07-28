using CtlFlow.Configuration.Configd.Domain.Identifiers;
using CtlFlow.Configuration.Configd.Domain.Revisions;

namespace CtlFlow.Configuration.Configd.Domain.Claims;

public sealed record DependencyClaimSelector(
    DependencyClaimId Id,
    Revision Revision);
