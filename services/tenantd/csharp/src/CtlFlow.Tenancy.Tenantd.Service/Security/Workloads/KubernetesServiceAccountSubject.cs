namespace CtlFlow.Tenancy.Tenantd.Service.Security.Workloads;

public readonly record struct KubernetesServiceAccountSubject
{
    private const string Prefix = "system:serviceaccount:";

    private KubernetesServiceAccountSubject(
        string value,
        string namespaceName,
        string serviceAccountName)
    {
        Value = value;
        NamespaceName = namespaceName;
        ServiceAccountName = serviceAccountName;
    }

    public string Value { get; }

    public string NamespaceName { get; }

    public string ServiceAccountName { get; }

    public static KubernetesServiceAccountSubject Parse(string value)
    {
        if (!value.StartsWith(Prefix, StringComparison.Ordinal))
        {
            throw new InvalidOperationException(
                "A caller must be a canonical Kubernetes ServiceAccount subject");
        }

        var names = value[Prefix.Length..].Split(':');
        if (names.Length != 2
            || !IsDnsLabel(names[0])
            || !IsDnsLabel(names[1]))
        {
            throw new InvalidOperationException(
                "A caller must be a canonical Kubernetes ServiceAccount subject");
        }

        return new KubernetesServiceAccountSubject(value, names[0], names[1]);
    }

    public override string ToString() => Value;

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
            var character = value[index];
            if (!IsLowerAlphaNumeric(character) && character != '-')
            {
                return false;
            }
        }

        return true;
    }

    private static bool IsLowerAlphaNumeric(char value) =>
        value is >= 'a' and <= 'z' or >= '0' and <= '9';
}
