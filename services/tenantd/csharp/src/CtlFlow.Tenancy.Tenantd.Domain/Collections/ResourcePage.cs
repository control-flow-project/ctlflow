using CtlFlow.Tenancy.Tenantd.Domain.Sequences;

namespace CtlFlow.Tenancy.Tenantd.Domain.Collections;

public sealed record ResourcePage<T>(
    IReadOnlyList<T> Items,
    PageToken? NextPageToken,
    ResourceEventCursor ResourceVersion);
