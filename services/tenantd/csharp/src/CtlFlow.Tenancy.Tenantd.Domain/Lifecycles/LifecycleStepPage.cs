using CtlFlow.Tenancy.Tenantd.Domain.Collections;
using CtlFlow.Tenancy.Tenantd.Domain.Sequences;

namespace CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;

public sealed record LifecycleStepPage(
    IReadOnlyList<LifecycleWorkItem> Steps,
    PageToken? NextPageToken,
    LifecycleDeliveryCursor DeliveryRevision);
