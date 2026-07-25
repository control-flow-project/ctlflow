using CtlFlow.Tenancy.Tenantd.Domain.Requests;
using CtlFlow.Tenancy.Tenantd.Domain.Sequences;

namespace CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;

public sealed record RetryLifecycleCommand(
    LifecycleTarget Target,
    ResourceEventSequence ExpectedResourceVersion,
    RequestActor Actor,
    IdempotencyKey IdempotencyKey,
    RequestDigest RequestDigest);
