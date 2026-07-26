using System.Text.Json;
using CtlFlow.Identity.Identityd.Service.Security.Tokens;
using static CtlFlow.Identity.Identityd.Service.Security.Tokens.JsonWebTokens;

namespace CtlFlow.Identity.Identityd.Service.Security.Workloads;

internal static partial class WorkloadTokens
{
    internal static async ValueTask<KubernetesServiceAccountSubject> ValidateWorkloadToken(
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
        KubernetesServiceAccountSubject subject;
        try
        {
            subject = KubernetesServiceAccountSubject.Parse(common.Subject);
        }
        catch (InvalidOperationException)
        {
            throw new TokenValidationException();
        }

        if (!common.Payload.TryGetProperty(
                "kubernetes.io",
                out var kubernetes)
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
