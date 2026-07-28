using Grpc.Core;
using CtlFlow.Configuration.Configd.Service.Security;
using CtlFlow.Configuration.Configd.Service.Security.Callers;
using CtlFlow.Configuration.Configd.Service.Security.Tokens;
using static CtlFlow.Configuration.Configd.Service.Security.Invocations.InvocationTokens;
using static CtlFlow.Configuration.Configd.Service.Security.Tokens.RequestTokens;
using static CtlFlow.Configuration.Configd.Service.Security.Workloads.WorkloadTokens;

namespace CtlFlow.Configuration.Configd.Service.Security.Workloads;

internal static partial class WorkloadAuthentication
{
    internal static async ValueTask<ConfigRequestIdentity> AuthenticateWorkloadRequest(
        Metadata headers,
        TokenAuthorities authorities,
        IReadOnlySet<KubernetesServiceAccountSubject> autonomousCallers,
        IReadOnlySet<KubernetesServiceAccountSubject> capabilityCallers,
        ConfigAdmission autonomousAdmission,
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

        if (autonomousAdmission is ConfigAdmission.Operator
            or ConfigAdmission.Capability)
        {
            throw new InvalidOperationException(
                "Autonomous workload admission is invalid");
        }

        var admission = autonomousCallers.Contains(caller)
            ? autonomousAdmission
            : capabilityCallers.Contains(caller)
                ? ConfigAdmission.Capability
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
            required: admission == ConfigAdmission.Capability);
        if (admission != ConfigAdmission.Capability
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

        return new ConfigRequestIdentity(
            new AuthenticatedConfigCaller.Workload(caller),
            invocation,
            admission);
    }
}
