using CtlFlow.Egress.Egressd.Service.Security.Tokens;

namespace CtlFlow.Egress.Egressd.Service.Security.Workloads;

internal sealed record KubernetesServiceAccountSubject(
    string NamespaceName,
    string ServiceAccountName)
{
    private const string Prefix = "system:serviceaccount:";

    internal string Value =>
        $"{Prefix}{NamespaceName}:{ServiceAccountName}";

    internal static KubernetesServiceAccountSubject Parse(string value)
    {
        if (!value.StartsWith(Prefix, StringComparison.Ordinal))
        {
            throw new TokenValidationException();
        }

        var names = value[Prefix.Length..].Split(':');
        if (names.Length != 2
            || !IsDnsLabel(names[0])
            || !IsDnsLabel(names[1]))
        {
            throw new TokenValidationException();
        }

        return new KubernetesServiceAccountSubject(names[0], names[1]);
    }

    private static bool IsDnsLabel(string value)
    {
        if (value.Length is < 1 or > 63
            || !IsLowerAlphaNumeric(value[0])
            || !IsLowerAlphaNumeric(value[^1]))
        {
            return false;
        }
        for (var index = 1; index < value.Length - 1; index++)
        {
            if (!IsLowerAlphaNumeric(value[index])
                && value[index] != '-')
            {
                return false;
            }
        }
        return true;
    }

    private static bool IsLowerAlphaNumeric(char value) =>
        value is >= 'a' and <= 'z' or >= '0' and <= '9';
}
