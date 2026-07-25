using CtlFlow.Tenancy.Tenantd.Service.Aggregation.Documents;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Serialization;

internal static partial class AggregationJson
{
    internal static Task WriteKubernetesStatus(
        HttpResponse response,
        KubernetesStatusDocument status,
        TenancyJsonContext json,
        CancellationToken cancellation) =>
        WriteJsonDocument(
            response,
            status.Code,
            status,
            json.KubernetesStatusDocument,
            cancellation);
}
