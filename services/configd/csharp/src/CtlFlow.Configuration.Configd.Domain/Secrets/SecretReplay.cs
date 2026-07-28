using CtlFlow.Configuration.Configd.Domain.Claims;
using CtlFlow.Configuration.Configd.Domain.Revisions;

namespace CtlFlow.Configuration.Configd.Domain.Secrets;

public sealed record SecretReplay(
    SecretMetadata Secret,
    SecretVersionMetadata Version,
    Revision? RequestExpectedRevision,
    DependencyClaimSelector? DependencyClaim,
    bool ExactMaterialMatches);
