using CtlFlow.Execution.Execd.Domain.Configuration;
using CtlFlow.Execution.V1;
using DomainConfigTargetReference =
    CtlFlow.Execution.Execd.Domain.Configuration.ConfigTargetReference;

namespace CtlFlow.Execution.Execd.Service.Grpc.Responses;

internal static partial class ExecutionResponses
{
    internal static ConfigdTargetReference CreateConfigTargetResponse(
        DomainConfigTargetReference target)
    {
        var response = new ConfigdTargetReference
        {
            Purpose = target.Purpose.Value
        };
        switch (target)
        {
            case DomainConfigTargetReference.Configuration item:
                response.Configuration =
                    new ConfigurationVersionTarget
                    {
                        ConfigurationId =
                            item.ConfigurationId.Value,
                        ConfigurationVersionId =
                            item.ConfigurationVersionId.Value
                    };
                break;
            case DomainConfigTargetReference.Secret item:
                response.Secret = new SecretVersionTarget
                {
                    SecretId = item.SecretId.Value,
                    SecretVersionId = item.SecretVersionId.Value
                };
                break;
            default:
                throw new InvalidOperationException(
                    "Config target is invalid");
        }

        return response;
    }
}
