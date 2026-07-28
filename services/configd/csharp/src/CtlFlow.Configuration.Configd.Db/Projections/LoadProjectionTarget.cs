using CtlFlow.Configuration.Configd.Db.Custody;
using CtlFlow.Configuration.Configd.Db.Providers;
using CtlFlow.Configuration.Configd.Domain.Bindings;
using CtlFlow.Configuration.Configd.Domain.Projections;

namespace CtlFlow.Configuration.Configd.Db.Projections;

public static partial class Projections
{
    internal static Task<ProjectionTargetLookup> LoadProjectionTarget(
        ConfigurationDatabase configurationDatabase,
        ProjectionTarget target,
        ConsumerBinding binding,
        EncryptionKeyRing keyRing,
        CancellationToken cancellation) =>
        target switch
        {
            ProjectionTarget.Configuration configuration =>
                LoadConfigurationProjectionTarget(
                    configurationDatabase,
                    configuration,
                    binding,
                    cancellation),
            ProjectionTarget.Secret secret => LoadSecretProjectionTarget(
                configurationDatabase,
                secret,
                binding,
                keyRing,
                cancellation),
            _ => throw new InvalidOperationException(
                "Projection target is invalid")
        };
}
