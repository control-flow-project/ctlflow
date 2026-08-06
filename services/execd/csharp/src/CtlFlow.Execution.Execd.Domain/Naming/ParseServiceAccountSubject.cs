namespace CtlFlow.Execution.Execd.Domain.Naming;

public static partial class NativeNames
{
    // Realization and lifecycle operations parse the retained subject rather
    // than deriving a second source of truth.
    public static (string Namespace, string Name) ParseServiceAccountSubject(
        string subject)
    {
        const string prefix = "system:serviceaccount:";
        if (!subject.StartsWith(prefix, StringComparison.Ordinal))
        {
            throw new InvalidOperationException("Workload subject is invalid");
        }

        var remainder = subject.AsSpan(prefix.Length);
        var separator = remainder.IndexOf(':');
        if (separator < 1
            || separator == remainder.Length - 1
            || remainder[(separator + 1)..].Contains(':'))
        {
            throw new InvalidOperationException("Workload subject is invalid");
        }

        var namespaceName = remainder[..separator].ToString();
        var name = remainder[(separator + 1)..].ToString();
        RequireDerivedName(namespaceName, "plc-");
        RequireDerivedName(name, "wld-");
        return (namespaceName, name);
    }

    private static void RequireDerivedName(string value, string prefix)
    {
        const int tokenLength = 32;
        if (value.Length != prefix.Length + tokenLength
            || !value.StartsWith(prefix, StringComparison.Ordinal))
        {
            throw new InvalidOperationException("Workload subject is invalid");
        }

        foreach (var character in value.AsSpan(prefix.Length))
        {
            if (character is not (>= '0' and <= '9')
                and not (>= 'a' and <= 'f'))
            {
                throw new InvalidOperationException(
                    "Workload subject is invalid");
            }
        }
    }
}
