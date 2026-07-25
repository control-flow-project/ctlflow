using CtlFlow.Tenancy.Tenantd.Domain.Identifiers;

namespace CtlFlow.Tenancy.Tenantd.Domain.Workspaces;

public sealed record WorkspaceAddressBindingId
{
    private WorkspaceAddressBindingId(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static WorkspaceAddressBindingId FromStorage(string value) =>
        new(OpaqueIdentifiers.ValidateStored(
            value,
            "Workspace address-binding ID"));

    public static WorkspaceAddressBindingId Generate() =>
        new(OpaqueIdentifiers.Generate("wab"));

    public override string ToString() => Value;
}
