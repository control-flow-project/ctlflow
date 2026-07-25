using CtlFlow.Tenancy.Tenantd.Domain.Sequences;

namespace CtlFlow.Tenancy.Tenantd.Domain.Collections;

public sealed record ResourceWatchEvent<T>(
    ResourceEventSequence Sequence,
    ResourceEventKind Kind,
    T Resource);
