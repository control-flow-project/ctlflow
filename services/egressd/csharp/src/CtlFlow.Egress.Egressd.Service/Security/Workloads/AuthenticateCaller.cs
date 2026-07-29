using CtlFlow.Egress.Egressd.Domain.Bindings;
using CtlFlow.Egress.Egressd.Service.Security.Tokens;
using static CtlFlow.Egress.Egressd.Service.Security.Workloads.WorkloadAuthentication;

namespace CtlFlow.Egress.Egressd.Service.Security.Workloads;

internal static partial class WorkloadAuthentication
{
    internal static async ValueTask AuthenticateCaller(
        IHeaderDictionary headers,
        CallerBinding admittedCaller,
        TokenValidationSettings settings,
        VerificationKeys keys,
        CancellationToken cancellation)
    {
        var token = await ReadProxyAuthorization(headers, cancellation);
        var caller = await ValidateWorkloadToken(
            token,
            settings,
            keys,
            DateTimeOffset.UtcNow,
            cancellation);
        if (caller.Value != admittedCaller.Subject)
        {
            throw new TokenValidationException();
        }
    }
}
