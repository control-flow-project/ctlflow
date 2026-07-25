using CtlFlow.Tenancy.Tenantd.Domain.Requests;
using CtlFlow.Tenancy.Tenantd.Domain.Sequences;

namespace CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;

public sealed record LifecycleActionCommand(
    LifecycleTarget Target,
    LifecycleOperationKind Operation,
    ResourceEventSequence ExpectedResourceVersion,
    RequestActor Actor,
    IdempotencyKey IdempotencyKey,
    RequestDigest RequestDigest);
