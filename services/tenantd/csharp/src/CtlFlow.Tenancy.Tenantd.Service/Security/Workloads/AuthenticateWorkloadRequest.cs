using Grpc.Core;
using CtlFlow.Tenancy.Tenantd.Service.Security;
using CtlFlow.Tenancy.Tenantd.Service.Security.Callers;
using CtlFlow.Tenancy.Tenantd.Service.Security.Tokens;
using static CtlFlow.Tenancy.Tenantd.Service.Security.Invocations.InvocationTokens;
using static CtlFlow.Tenancy.Tenantd.Service.Security.Tokens.RequestTokens;
using static CtlFlow.Tenancy.Tenantd.Service.Security.Workloads.WorkloadTokens;

namespace CtlFlow.Tenancy.Tenantd.Service.Security.Workloads;

internal static partial class WorkloadAuthentication
{
    internal static async ValueTask<TenantRequestIdentity> AuthenticateWorkloadRequest(
        Metadata headers,
        TokenAuthorities authorities,
        IReadOnlySet<KubernetesServiceAccountSubject> autonomousCallers,
        IReadOnlySet<KubernetesServiceAccountSubject> capabilityCallers,
        DateTimeOffset currentTime,
        CancellationToken cancellation)
    {
        var workloadToken = ReadBearerToken(
            headers,
            "authorization",
            required: true)
            ?? throw new TokenValidationException();
        var caller = await ValidateWorkloadToken(
            workloadToken,
            authorities.WorkloadSettings,
            authorities.WorkloadKeys,
            currentTime,
            cancellation);

        var admission = autonomousCallers.Contains(caller)
            ? TenantAdmission.AutonomousKernel
            : capabilityCallers.Contains(caller)
                ? TenantAdmission.Capability
                : throw new CallerNotAdmittedException();
        if (autonomousCallers.Contains(caller)
            && capabilityCallers.Contains(caller))
        {
            throw new InvalidOperationException(
                "A workload caller has conflicting admission paths");
        }

        var invocationToken = ReadBearerToken(
            headers,
            "ctlflow-invocation",
            required: admission == TenantAdmission.Capability);
        var invocation = invocationToken is null
            ? null
            : await ValidateInvocationToken(
                invocationToken,
                authorities.InvocationSettings,
                authorities.InvocationKeys,
                currentTime,
                cancellation);

        return new TenantRequestIdentity(
            new AuthenticatedTenantCaller.Workload(caller),
            invocation,
            admission);
    }
}
