using CtlFlow.Audit.Auditd.Service.Security.Tokens;
using static CtlFlow.Audit.Auditd.Service.Security.Tokens.JsonWebKeys;

namespace CtlFlow.Audit.Auditd.Service.Security;

internal static partial class AuditSourceAuthentication
{
    internal static async Task VerifyWorkloadTrust(
        string keySetPath,
        TimeSpan cacheLifetime,
        CancellationToken cancellation)
    {
        _ = await LoadFileVerificationKeys(
            keySetPath,
            cacheLifetime,
            cancellation);
    }
}
