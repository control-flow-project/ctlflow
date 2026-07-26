using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using CtlFlow.Tenancy.V1;
using Grpc.Core;
using static CtlFlow.Tenancy.Tenantd.Domain.Workspaces.Workspaces;
using static CtlFlow.Tenancy.Tenantd.Service.Auditing.AuditDelivery;
using static CtlFlow.Tenancy.Tenantd.Service.Grpc.Responses.TenancyResponses;
using static CtlFlow.Tenancy.Tenantd.Service.Grpc.TenantGrpcErrors;

namespace CtlFlow.Tenancy.Tenantd.Service.Grpc;

internal sealed partial class TenantGrpcService
{
    private async Task<CtlFlow.Tenancy.V1.Workspace>
        CompleteWorkspaceMutation(
        WorkspaceMutationResult result,
        CancellationToken cancellation)
    {
        switch (result)
        {
            case WorkspaceMutationResult.Changed changed:
                await RecordAudit(
                    _auditClient,
                    _settings.Audit,
                    _telemetry,
                    changed.Audit,
                    cancellation);
                return CreateWorkspaceResponse(
                    await DescribeWorkspace(changed.Workspace, cancellation));
            case WorkspaceMutationResult.Current current:
                return CreateWorkspaceResponse(current.Workspace);
            case WorkspaceMutationResult.NotFound:
                throw CreateExpectedRpcException(StatusCode.NotFound);
            case WorkspaceMutationResult.AlreadyExists:
                throw CreateExpectedRpcException(StatusCode.AlreadyExists);
            case WorkspaceMutationResult.FailedPrecondition:
                throw CreateExpectedRpcException(
                    StatusCode.FailedPrecondition);
            case WorkspaceMutationResult.RevisionMismatch:
                throw CreateExpectedRpcException(StatusCode.Aborted);
            default:
                throw new InvalidOperationException(
                    "Workspace mutation result is invalid");
        }
    }
}
