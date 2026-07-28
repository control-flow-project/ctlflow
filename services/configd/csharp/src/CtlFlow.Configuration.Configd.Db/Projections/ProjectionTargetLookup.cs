namespace CtlFlow.Configuration.Configd.Db.Projections;

internal sealed record ProjectionTargetLookup(
    bool Exists,
    bool SecretIsCurrent,
    ProjectionPayloadLease? Payload);
