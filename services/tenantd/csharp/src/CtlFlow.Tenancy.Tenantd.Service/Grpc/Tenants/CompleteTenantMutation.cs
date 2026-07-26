using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.V1;
using Grpc.Core;
using static CtlFlow.Tenancy.Tenantd.Domain.Tenants.Tenants;
using static CtlFlow.Tenancy.Tenantd.Service.Auditing.AuditDelivery;
using static CtlFlow.Tenancy.Tenantd.Service.Grpc.Responses.TenancyResponses;
using static CtlFlow.Tenancy.Tenantd.Service.Grpc.TenantGrpcErrors;

namespace CtlFlow.Tenancy.Tenantd.Service.Grpc;

internal sealed partial class TenantGrpcService
{
    private async Task<CtlFlow.Tenancy.V1.Tenant> CompleteTenantMutation(
        TenantMutationResult result,
        CancellationToken cancellation)
    {
        switch (result)
        {
            case TenantMutationResult.Changed changed:
                await RecordAudit(
                    _auditClient,
                    _settings.Audit,
                    _telemetry,
                    changed.Audit,
                    cancellation);
                return CreateTenantResponse(
                    await DescribeTenant(changed.Tenant, cancellation));
            case TenantMutationResult.Current current:
                return CreateTenantResponse(current.Tenant);
            case TenantMutationResult.NotFound:
                throw CreateExpectedRpcException(StatusCode.NotFound);
            case TenantMutationResult.AlreadyExists:
                throw CreateExpectedRpcException(StatusCode.AlreadyExists);
            case TenantMutationResult.FailedPrecondition:
                throw CreateExpectedRpcException(
                    StatusCode.FailedPrecondition);
            case TenantMutationResult.RevisionMismatch:
                throw CreateExpectedRpcException(StatusCode.Aborted);
            default:
                throw new InvalidOperationException(
                    "Tenant mutation result is invalid");
        }
    }
}
