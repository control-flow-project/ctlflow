using static CtlFlow.Egress.Egressd.Domain.Identifiers.Identifiers;

namespace CtlFlow.Egress.Egressd.Domain.Bindings;

public sealed record CallerBinding
{
    private CallerBinding(
        string namespaceName,
        string serviceAccountName)
    {
        NamespaceName = namespaceName;
        ServiceAccountName = serviceAccountName;
    }

    public string NamespaceName { get; }

    public string ServiceAccountName { get; }

    public string Subject =>
        $"system:serviceaccount:{NamespaceName}:{ServiceAccountName}";

    public static ValueTask<CallerBinding> Parse(
        string namespaceName,
        string serviceAccountName,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(new CallerBinding(
            ValidateDnsLabel(namespaceName, nameof(namespaceName)),
            ValidateDnsLabel(
                serviceAccountName,
                nameof(serviceAccountName))));
    }
}
