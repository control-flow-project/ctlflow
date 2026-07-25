using CtlFlow.Tenancy.Tenantd.Domain.Collections;
using CtlFlow.Tenancy.Tenantd.Domain.Sequences;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Requests;

internal abstract record AggregationCollectionRequest
{
    private AggregationCollectionRequest()
    {
    }

    internal sealed record List(PageSize PageSize, PageToken? PageToken)
        : AggregationCollectionRequest;

    internal sealed record Watch(ResourceEventCursor Cursor)
        : AggregationCollectionRequest;
}
