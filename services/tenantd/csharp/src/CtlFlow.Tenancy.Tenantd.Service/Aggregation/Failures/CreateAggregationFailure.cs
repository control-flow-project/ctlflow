using CtlFlow.Tenancy.Tenantd.Service.Aggregation.Documents;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Failures;

internal static partial class AggregationFailures
{
    internal static AggregationFailureException CreateAggregationFailure(
        int code,
        string reason,
        string message,
        string? resourceKind = null,
        string? name = null,
        KubernetesStatusCauseDocument[]? causes = null) =>
        new(new KubernetesStatusDocument
        {
            Code = code,
            Reason = reason,
            Message = message,
            Details = resourceKind is null && name is null && causes is null
                ? null
                : new KubernetesStatusDetailsDocument
                {
                    Kind = resourceKind,
                    Name = name,
                    Causes = causes
                }
        });
}
