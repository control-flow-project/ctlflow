using CtlFlow.Identity.Identityd.Service.Security.Tokens;
using Grpc.Core;
using static CtlFlow.Identity.Identityd.Service.Security.Tokens.RequestTokens;
using static CtlFlow.Identity.Identityd.Service.Security.Workloads.WorkloadTokens;

namespace CtlFlow.Identity.Identityd.Service.Security.Workloads;

internal static partial class WorkloadAuthentication
{
    // Admits any caller presenting a valid installation-issued bound Kubernetes
    // workload token, without consulting an exact caller allowlist.
    //
    // This is deliberately the single widened admission in Identityd and is used
    // only by GetInvocationVerificationKeys. Verification keys are public
    // material, so an Execd-realized product workload uses the same bootstrap
    // path as a kernel service rather than a second projection or refresh
    // mechanism. Holding such a token grants nothing else: every other
    // operation keeps its exact allowlist. Identityd performs no Execd lookup;
    // workload-token expiry bounds stale access.
    internal static async ValueTask<KubernetesServiceAccountSubject>
        AuthenticateAnyWorkloadRequest(
            Metadata headers,
            TokenAuthorities authorities,
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

        // The contract defines this operation as workload authentication with
        // no invocation JWT. Unexpected invocation metadata is a malformed
        // request, not something to validate and ignore.
        if (ReadBearerToken(
                headers,
                "ctlflow-invocation",
                required: false) is not null)
        {
            throw new TokenValidationException();
        }

        return caller;
    }
}
