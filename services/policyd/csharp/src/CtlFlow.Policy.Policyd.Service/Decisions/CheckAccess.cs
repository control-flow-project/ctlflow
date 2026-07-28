using CtlFlow.Identity.V1;
using CtlFlow.Policy.Policyd.Db.Providers;
using CtlFlow.Policy.Policyd.Domain.Catalog;
using CtlFlow.Policy.Policyd.Domain.Identifiers;
using CtlFlow.Policy.Policyd.Domain.Operations;
using CtlFlow.Policy.Policyd.Domain.Paths;
using CtlFlow.Policy.Policyd.Domain.Targets;
using CtlFlow.Policy.Policyd.Service.Configuration;
using CtlFlow.Policy.Policyd.Service.Security;
using CtlFlow.Policy.Policyd.Service.Security.Invocations;
using CtlFlow.Policy.Policyd.Service.Telemetry;
using Grpc.Core;
using static CtlFlow.Policy.Policyd.Domain.Catalog.OperationCatalog;
using static CtlFlow.Policy.Policyd.Service.Identity.IdentityFacts;
using static CtlFlow.Policy.Policyd.Service.Security.Invocations.InvocationTokens;
using static CtlFlow.Policy.Policyd.Service.Security.Workloads.WorkloadAuthentication;
using DomainPrincipalKind =
    CtlFlow.Policy.Policyd.Domain.Identifiers.PrincipalKind;

namespace CtlFlow.Policy.Policyd.Service.Decisions;

internal static partial class AccessDecisions
{
    internal static async Task<bool> CheckAccess(
        Metadata headers,
        string operationValue,
        string resourcePathValue,
        string tenantIdValue,
        string? workspaceIdValue,
        ServiceSettings settings,
        TokenAuthorities authorities,
        PolicyDatabase database,
        IdentityService.IdentityServiceClient identityClient,
        PolicydTelemetry telemetry,
        CancellationToken cancellation)
    {
        var caller = await AuthenticateWorkloadRequest(
            headers,
            authorities,
            DateTimeOffset.UtcNow,
            cancellation);
        var operation = OperationToken.Parse(operationValue);
        var owner = FindOperationOwner(operation)
            ?? throw new CallerNotAdmittedException();
        if (caller != settings.OwnerCallers.GetCaller(owner))
        {
            throw new CallerNotAdmittedException();
        }

        var invocation = await AuthenticateInvocation(
            headers,
            authorities,
            DateTimeOffset.UtcNow,
            cancellation);
        var target = new PolicyTarget(
            TenantId.Parse(tenantIdValue),
            workspaceIdValue is null
                ? null
                : WorkspaceId.Parse(workspaceIdValue));
        var catalogRequest = ValidateCatalogRequest(
            operation,
            ResourcePath.Parse(resourcePathValue),
            target);
        EnsureInvocationFence(invocation, catalogRequest);

        var facts = await ResolvePrincipal(
            identityClient,
            settings.Identity,
            telemetry,
            invocation,
            target,
            cancellation);
        var actorAllowed = await EvaluatePrincipalAuthority(
            database,
            identityClient,
            settings.Identity,
            telemetry,
            invocation,
            facts.Principal,
            target,
            operation,
            catalogRequest.ResourcePath,
            cancellation);

        if (facts.Kind != DomainPrincipalKind.Virtual)
        {
            return facts.PrincipalEnabled
                && facts.SubjectAccountEnabled
                && actorAllowed;
        }

        var accountAllowed = await EvaluatePrincipalAuthority(
            database,
            identityClient,
            settings.Identity,
            telemetry,
            invocation,
            facts.SubjectAccount,
            target,
            operation,
            catalogRequest.ResourcePath,
            cancellation);
        return facts.PrincipalEnabled
            && facts.SubjectAccountEnabled
            && actorAllowed
            && accountAllowed;
    }
}
