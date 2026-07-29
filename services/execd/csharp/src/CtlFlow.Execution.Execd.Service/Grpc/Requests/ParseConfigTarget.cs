using CtlFlow.Execution.Execd.Domain.Configuration;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.V1;

namespace CtlFlow.Execution.Execd.Service.Grpc.Requests;

internal static partial class ExecutionRequests
{
    internal static ConfigTargetReference ParseConfigTarget(
        ConfigdTargetReference? target)
    {
        if (target is null)
        {
            throw new ArgumentException(
                "configd target is required");
        }

        var purpose = Purpose.Parse(target.Purpose);
        return target.TargetCase switch
        {
            ConfigdTargetReference.TargetOneofCase.Configuration =>
                new ConfigTargetReference.Configuration(
                    purpose,
                    ConfigurationId.Parse(
                        target.Configuration.ConfigurationId),
                    VersionId.Parse(
                        target.Configuration
                            .ConfigurationVersionId)),
            ConfigdTargetReference.TargetOneofCase.Secret =>
                new ConfigTargetReference.Secret(
                    purpose,
                    SecretId.Parse(target.Secret.SecretId),
                    VersionId.Parse(
                        target.Secret.SecretVersionId)),
            _ => throw new ArgumentException(
                "configd target must contain exactly one target")
        };
    }
}
