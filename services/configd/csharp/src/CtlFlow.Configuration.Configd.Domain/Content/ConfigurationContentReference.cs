namespace CtlFlow.Configuration.Configd.Domain.Content;

public sealed record ConfigurationContentReference(
    ContentLength Length,
    ConfigurationDigest Digest);
