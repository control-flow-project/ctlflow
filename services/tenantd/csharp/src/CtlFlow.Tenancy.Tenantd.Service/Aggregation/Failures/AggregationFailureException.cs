using CtlFlow.Tenancy.Tenantd.Service.Aggregation.Documents;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Failures;

internal sealed class AggregationFailureException(
    KubernetesStatusDocument status) : Exception(status.Message)
{
    internal KubernetesStatusDocument Status { get; } = status;
}
