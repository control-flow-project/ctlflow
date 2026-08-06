using CtlFlow.Execution.V1;
using CtlFlow.Identity.V1;
using CtlFlow.Policy.Policyd.Db.Providers;
using CtlFlow.Policy.Policyd.Service.Configuration;
using CtlFlow.Policy.Policyd.Service.Security;
using CtlFlow.Policy.Policyd.Service.Telemetry;
using CtlFlow.Policy.V1;
using Grpc.Core;
using DecisionEngine =
    CtlFlow.Policy.Policyd.Service.Decisions.AccessDecisions;

namespace CtlFlow.Policy.Policyd.Service.Grpc;

internal sealed class PolicyGrpcService(
    ServiceSettings settings,
    TokenAuthorities authorities,
    PolicyDatabase database,
    IdentityService.IdentityServiceClient identityClient,
    ExecutionService.ExecutionServiceClient executionClient,
    PolicydTelemetry telemetry)
    : PolicyService.PolicyServiceBase
{
    public override async Task<CheckAccessResponse> CheckAccess(
        CheckAccessRequest request,
        ServerCallContext context)
    {
        var allowed = await DecisionEngine.CheckAccess(
            context.RequestHeaders,
            request.Operation,
            request.ResourcePath,
            request.TenantId,
            request.HasWorkspaceId ? request.WorkspaceId : null,
            settings,
            authorities,
            database,
            identityClient,
            executionClient,
            telemetry,
            context.CancellationToken);
        return new CheckAccessResponse
        {
            Decision = allowed
                ? AccessDecision.Allow
                : AccessDecision.Deny
        };
    }
}
