using static CtlFlow.Execution.Execd.Domain.Identifiers.IdentifierValidation;

namespace CtlFlow.Execution.Execd.Domain.Identifiers;

public sealed record MountPath
{
    private MountPath(string value) => Value = value;
    public string Value { get; }
    public static MountPath Parse(string value) => new(IdentifierValidation.MountPath(value, "mount_path"));
    public override string ToString() => Value;
}

public sealed record EndpointHost
{
    private EndpointHost(string value) => Value = value;
    public string Value { get; }
    public static EndpointHost Parse(string value) => new(IdentifierValidation.EndpointHost(value, "endpoint_host"));
    public override string ToString() => Value;
}
