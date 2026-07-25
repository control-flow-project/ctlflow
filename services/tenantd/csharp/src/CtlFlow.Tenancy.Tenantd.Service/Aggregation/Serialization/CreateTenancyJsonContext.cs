using System.Text.Json;
using System.Text.Json.Serialization;
using CtlFlow.Tenancy.Tenantd.Service.Aggregation.Documents;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Serialization;

internal static partial class AggregationJson
{
    internal static TenancyJsonContext CreateTenancyJsonContext() =>
        new(new JsonSerializerOptions
        {
            AllowDuplicateProperties = false,
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow
        });
}
