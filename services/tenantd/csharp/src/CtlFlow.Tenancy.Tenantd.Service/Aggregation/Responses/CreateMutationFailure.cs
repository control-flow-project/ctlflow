using CtlFlow.Tenancy.Tenantd.Domain.Collections;
using CtlFlow.Tenancy.Tenantd.Service.Aggregation.Failures;
using static CtlFlow.Tenancy.Tenantd.Service.Aggregation.Failures.AggregationFailures;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Responses;

internal static partial class AggregationResponses
{
    private static AggregationFailureException CreateMutationFailure<T>(
        ResourceMutationResult<T> result,
        string resourceKind) =>
        result switch
        {
            ResourceMutationResult<T>.NotFound =>
                CreateAggregationFailure(
                    StatusCodes.Status404NotFound,
                    "NotFound",
                    "The requested resource was not found",
                    resourceKind),
            ResourceMutationResult<T>.AlreadyExists conflict =>
                CreateAggregationFailure(
                    StatusCodes.Status409Conflict,
                    "AlreadyExists",
                    DescribeMutationFailure(conflict.Failure),
                    resourceKind),
            ResourceMutationResult<T>.Aborted aborted =>
                CreateAggregationFailure(
                    StatusCodes.Status409Conflict,
                    "Conflict",
                    DescribeMutationFailure(aborted.Failure),
                    resourceKind),
            ResourceMutationResult<T>.FailedPrecondition failed =>
                CreateAggregationFailure(
                    StatusCodes.Status422UnprocessableEntity,
                    "Invalid",
                    DescribeMutationFailure(failed.Failure),
                    resourceKind),
            _ => throw new InvalidOperationException(
                "Resource mutation result is invalid")
        };

    private static string DescribeMutationFailure(
        ResourceMutationFailure failure) =>
        failure switch
        {
            ResourceMutationFailure.IdempotencyConflict =>
                "Idempotency key was reused with another request",
            ResourceMutationFailure.AddressAlreadyBound =>
                "The requested permanent address is already bound",
            ResourceMutationFailure.ResourceVersionMismatch =>
                "The supplied resourceVersion is stale",
            ResourceMutationFailure.LifecycleNotAdmitted =>
                "The current lifecycle does not admit this operation",
            ResourceMutationFailure.ParentTenantNotActive =>
                "The parent Tenant is not active",
            ResourceMutationFailure.TenantHasWorkspaces =>
                "The Tenant still owns non-deleted Workspaces",
            ResourceMutationFailure.ImmutableSpecMismatch =>
                "An immutable specification field does not match",
            ResourceMutationFailure.OperationNotRetryable =>
                "The current lifecycle operation is not retryable",
            _ => "The resource mutation was rejected"
        };
}
