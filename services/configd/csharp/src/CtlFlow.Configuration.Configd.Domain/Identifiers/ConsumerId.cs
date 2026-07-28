using static CtlFlow.Configuration.Configd.Domain.Identifiers.Identifiers;

namespace CtlFlow.Configuration.Configd.Domain.Identifiers;

public sealed record ConsumerId
{
    private ConsumerId(string value) => Value = value;

    public string Value { get; }

    public static ConsumerId Parse(string value) =>
        new(ValidateIdentifier(value, "Consumer ID"));

    public static ConsumerId FromStorage(string value) =>
        new(ValidateStoredIdentifier(value, "consumer ID"));
}
