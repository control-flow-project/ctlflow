using System.Text.Json;
using CtlFlow.Egress.Egressd.Service.Security.Tokens;
using static CtlFlow.Egress.Egressd.Service.Security.Tokens.JsonWebTokens;

namespace CtlFlow.Egress.Egressd.Service.Security.Workloads;

internal static partial class WorkloadAuthentication
{
    internal static async ValueTask<KubernetesServiceAccountSubject>
        ValidateWorkloadToken(
            string token,
            TokenValidationSettings settings,
            VerificationKeys keys,
            DateTimeOffset currentTime,
            CancellationToken cancellation)
    {
        var common = await ValidateToken(
            token,
            settings,
            keys,
            currentTime,
            cancellation);
        var subject = KubernetesServiceAccountSubject.Parse(common.Subject);
        var payload = common.Payload;
        if (!payload.TryGetProperty("kubernetes.io", out var kubernetes)
            || kubernetes.ValueKind != JsonValueKind.Object
            || ReadRequiredString(kubernetes, "namespace")
                != subject.NamespaceName
            || !kubernetes.TryGetProperty(
                "serviceaccount",
                out var serviceAccount)
            || serviceAccount.ValueKind != JsonValueKind.Object
            || ReadRequiredString(serviceAccount, "name")
                != subject.ServiceAccountName
            || !IsBoundIdentifier(
                ReadRequiredString(serviceAccount, "uid"))
            || !kubernetes.TryGetProperty("pod", out var pod)
            || pod.ValueKind != JsonValueKind.Object
            || !IsBoundIdentifier(ReadRequiredString(pod, "name"))
            || !IsBoundIdentifier(ReadRequiredString(pod, "uid")))
        {
            throw new TokenValidationException();
        }

        return subject;
    }

    private static bool IsBoundIdentifier(string value) =>
        value.Length is > 0 and <= 253
        && !value.Any(char.IsWhiteSpace);
}
