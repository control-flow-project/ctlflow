using static CtlFlow.Packages.Pkgd.Domain.Identifiers.Identifiers;

namespace CtlFlow.Packages.Pkgd.Domain.Apps;

public sealed record TenantId
{
    private TenantId(string value) => Value = value;
    public string Value { get; }

    public static ValueTask<TenantId> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(new TenantId(ValidateDeclarationId(
            value, 64, allowDot: false, "Tenant ID", stored: false)));
    }

    public static TenantId FromStorage(string value) =>
        new(ValidateDeclarationId(
            value, 64, allowDot: false, "Tenant ID", stored: true));
}
