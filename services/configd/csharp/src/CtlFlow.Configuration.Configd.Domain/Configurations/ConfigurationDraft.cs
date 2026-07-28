using CtlFlow.Configuration.Configd.Domain.Bindings;
using CtlFlow.Configuration.Configd.Domain.Claims;
using CtlFlow.Configuration.Configd.Domain.Content;
using CtlFlow.Configuration.Configd.Domain.Identifiers;
using CtlFlow.Configuration.Configd.Domain.Revisions;

namespace CtlFlow.Configuration.Configd.Domain.Configurations;

public sealed record ConfigurationDraft(
    ConfigurationId Id,
    ConfigurationVersionId VersionId,
    ConsumerBinding Binding,
    Revision? ExpectedRevision,
    ConfigurationContentReference Content,
    DependencyClaimSelector? DependencyClaim);
