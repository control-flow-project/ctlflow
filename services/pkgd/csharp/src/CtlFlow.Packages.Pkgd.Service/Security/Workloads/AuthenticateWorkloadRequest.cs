using Grpc.Core;
using CtlFlow.Packages.Pkgd.Service.Security;
using CtlFlow.Packages.Pkgd.Service.Security.Callers;
using CtlFlow.Packages.Pkgd.Service.Security.Tokens;
using static CtlFlow.Packages.Pkgd.Service.Security.Invocations.InvocationTokens;
using static CtlFlow.Packages.Pkgd.Service.Security.Tokens.RequestTokens;
using static CtlFlow.Packages.Pkgd.Service.Security.Workloads.WorkloadTokens;

namespace CtlFlow.Packages.Pkgd.Service.Security.Workloads;

internal static partial class WorkloadAuthentication
{
    internal static async ValueTask<PackageRequestIdentity> AuthenticateWorkloadRequest(
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
            ? PackageAdmission.AutonomousKernel
            : capabilityCallers.Contains(caller)
                ? PackageAdmission.Capability
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
            required: admission == PackageAdmission.Capability);
        if (admission == PackageAdmission.AutonomousKernel
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

        return new PackageRequestIdentity(
            new AuthenticatedPackageCaller.Workload(caller),
            invocation,
            admission);
    }
}
