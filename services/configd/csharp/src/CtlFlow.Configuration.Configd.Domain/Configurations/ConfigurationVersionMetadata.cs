using CtlFlow.Configuration.Configd.Domain.Content;
using CtlFlow.Configuration.Configd.Domain.Identifiers;
using CtlFlow.Configuration.Configd.Domain.Time;

namespace CtlFlow.Configuration.Configd.Domain.Configurations;

public sealed record ConfigurationVersionMetadata(
    ConfigurationVersionId Id,
    ConfigurationId ConfigurationId,
    ConfigurationContentReference Content,
    UtcInstant CreatedAt);
