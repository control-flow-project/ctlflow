using Grpc.Core;
using CtlFlow.Execution.Execd.Service.Security;
using CtlFlow.Execution.Execd.Service.Security.Callers;
using CtlFlow.Execution.Execd.Service.Security.Tokens;
using static CtlFlow.Execution.Execd.Service.Security.Invocations.InvocationTokens;
using static CtlFlow.Execution.Execd.Service.Security.Tokens.RequestTokens;
using static CtlFlow.Execution.Execd.Service.Security.Workloads.WorkloadTokens;

namespace CtlFlow.Execution.Execd.Service.Security.Workloads;

internal static partial class WorkloadAuthentication
{
    internal static async ValueTask<ExecutionRequestIdentity> AuthenticateWorkloadRequest(
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
            ? ExecutionAdmission.AutonomousKernel
            : capabilityCallers.Contains(caller)
                ? ExecutionAdmission.Capability
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
            required: admission == ExecutionAdmission.Capability);
        if (admission == ExecutionAdmission.AutonomousKernel
            && invocationToken is not null)
        {
            throw new TokenValidationException();
        }

        var invocation = invocationToken is null
            ? null
            : await ValidateInvocationToken(
                invocationToken,
                authorities.InvocationSettings,
                authorities.InvocationKeys,
                currentTime,
                cancellation);

        return new ExecutionRequestIdentity(
            new AuthenticatedExecutionCaller.Workload(caller),
            invocation,
            admission);
    }
}
