using System.Security.Cryptography.X509Certificates;

namespace CtlFlow.Configuration.Configd.Service.Security.Operators;

internal readonly record struct KubernetesOperatorSubject
{
    private const string CommonNameOid = "2.5.4.3";

    private KubernetesOperatorSubject(string value)
    {
        Value = value;
    }

    internal string Value { get; }

    internal static KubernetesOperatorSubject FromCertificate(
        X509Certificate2 certificate)
    {
        var names = certificate.SubjectName
            .EnumerateRelativeDistinguishedNames()
            .Where(name =>
                !name.HasMultipleElements
                && name.GetSingleElementType().Value == CommonNameOid)
            .Select(name => name.GetSingleElementValue())
            .ToArray();
        return names is [{ } name]
            ? Parse(name)
            : throw new InvalidOperationException(
                "An operator certificate must contain one common name");
    }

    internal static KubernetesOperatorSubject Parse(string value)
    {
        if (value.Length is < 1 or > 253
            || value.Any(character =>
                char.IsWhiteSpace(character)
                || char.IsControl(character)))
        {
            throw new InvalidOperationException(
                "A Kubernetes operator subject is invalid");
        }

        return new KubernetesOperatorSubject(value);
    }

    public override string ToString() => Value;
}
