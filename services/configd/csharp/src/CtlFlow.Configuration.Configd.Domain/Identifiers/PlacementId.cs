using static CtlFlow.Configuration.Configd.Domain.Identifiers.Identifiers;

namespace CtlFlow.Configuration.Configd.Domain.Identifiers;

public sealed record PlacementId
{
    private PlacementId(string value) => Value = value;

    public string Value { get; }

    public static PlacementId Parse(string value) =>
        new(ValidateIdentifier(value, "Placement ID"));

    public static PlacementId FromStorage(string value) =>
        new(ValidateStoredIdentifier(value, "placement ID"));
}
