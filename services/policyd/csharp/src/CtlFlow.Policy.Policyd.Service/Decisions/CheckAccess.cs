using CtlFlow.Execution.V1;
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
        ExecutionService.ExecutionServiceClient executionClient,
        PolicydTelemetry telemetry,
        CancellationToken cancellation)
    {
        var caller = await AuthenticateWorkloadRequest(
            headers,
            authorities,
            DateTimeOffset.UtcNow,
            cancellation);
        // The owner namespace is selected from the authenticated caller
        // before the token is interpreted, so a kernel service and a package
        // may use the same lexical token without crossing authority.
        var kernelOwner = settings.OwnerCallers.FindOwner(caller);
        var operation = OperationToken.Parse(operationValue);
        if (kernelOwner is { } admittedOwner)
        {
            // An exact kernel caller may enforce only its own catalog
            // operations.
            if (FindOperationOwner(operation) != admittedOwner)
            {
                throw new CallerNotAdmittedException();
            }
        }

        // Product authority is resolved from Execd's retained admission state
        // before the invocation is interpreted: a caller with no admitted
        // binding is denied without any invocation being considered. Policyd
        // stores no ownership and caches no mutable Workload eligibility, and
        // the resolver response is boundary-validated before it is used.
        var binding = kernelOwner is not null
            ? null
            : await ResolveWorkloadOperationBinding(
                executionClient,
                settings.Execution,
                settings.Identity.WorkloadTokenFilePath,
                telemetry,
                caller,
                operation,
                cancellation);

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
        CatalogRequest catalogRequest;
        OperationIdentity taggedOperation;
        if (kernelOwner is { } owner)
        {
            var resourcePath = ResourcePath.Parse(resourcePathValue);
            catalogRequest = ValidateCatalogRequest(
                operation,
                resourcePath,
                target);
            taggedOperation = OperationIdentity.Kernel(
                GetKernelOwnerId(owner),
                operation);
        }
        else
        {
            // Containment is decided from the target and invocation alone,
            // before any resource path is examined, so a request outside the
            // workload's Placement is concealed rather than answered with the
            // path detail of an App it may not see.
            var containment = binding!.Containment;
            await EnsurePlacementFence(
                containment,
                target,
                invocation,
                cancellation);
            var resourcePath = ResourcePath.Parse(resourcePathValue);
            catalogRequest = ValidateProductRequest(
                operation,
                resourcePath,
                target,
                binding.AppId);
            // A User Placement owns only its account-scoped resources; the
            // anchor has now established the path's canonical scope.
            await EnsureResourceScope(
                containment,
                catalogRequest.AccountScope,
                cancellation);
            taggedOperation = OperationIdentity.Package(
                binding.PackageId,
                operation);
        }

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
            taggedOperation,
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
            taggedOperation,
            catalogRequest.ResourcePath,
            cancellation);
        return facts.PrincipalEnabled
            && facts.SubjectAccountEnabled
            && actorAllowed
            && accountAllowed;
    }
}
