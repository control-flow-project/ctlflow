using CtlFlow.Configuration.Configd.Domain.Bindings;
using CtlFlow.Configuration.Configd.Domain.Claims;
using CtlFlow.Configuration.Configd.Domain.Identifiers;
using CtlFlow.Configuration.Configd.Domain.Revisions;

namespace CtlFlow.Configuration.Configd.Domain.Secrets;

public sealed record SecretDraft(
    SecretId Id,
    SecretVersionId VersionId,
    ConsumerBinding Binding,
    Revision? ExpectedRevision,
    DependencyClaimSelector? DependencyClaim);
