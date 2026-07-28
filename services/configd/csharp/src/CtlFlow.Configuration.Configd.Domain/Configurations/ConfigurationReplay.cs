using CtlFlow.Configuration.Configd.Domain.Claims;
using CtlFlow.Configuration.Configd.Domain.Revisions;

namespace CtlFlow.Configuration.Configd.Domain.Configurations;

public sealed record ConfigurationReplay(
    ConfigurationMetadata Configuration,
    ConfigurationVersionMetadata Version,
    Revision? RequestExpectedRevision,
    DependencyClaimSelector? DependencyClaim,
    bool ExactContentMatches);
