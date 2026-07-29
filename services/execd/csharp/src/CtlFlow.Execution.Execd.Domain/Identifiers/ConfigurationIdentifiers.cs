using static CtlFlow.Execution.Execd.Domain.Identifiers.IdentifierValidation;

namespace CtlFlow.Execution.Execd.Domain.Identifiers;

public sealed record ConfigurationId
{
    private ConfigurationId(string value) => Value = value;
    public string Value { get; }
    public static ConfigurationId Parse(string value) => new(ConfigId(value, "configuration_id"));
    public override string ToString() => Value;
}

public sealed record SecretId
{
    private SecretId(string value) => Value = value;
    public string Value { get; }
    public static SecretId Parse(string value) => new(ConfigId(value, "secret_id"));
    public override string ToString() => Value;
}

public sealed record VersionId
{
    private VersionId(string value) => Value = value;
    public string Value { get; }
    public static VersionId Parse(string value) => new(ConfigId(value, "version_id"));
    public override string ToString() => Value;
}

public sealed record Purpose
{
    private Purpose(string value) => Value = value;
    public string Value { get; }
    public static Purpose Parse(string value) => new(IdentifierValidation.Purpose(value, "purpose"));
    public override string ToString() => Value;
}

public sealed record ProjectionId
{
    private ProjectionId(string value) => Value = value;
    public string Value { get; }
    public static ProjectionId Parse(string value) => new(IdentifierValidation.ProjectionId(value, "projection_id"));
    public override string ToString() => Value;
}

public sealed record BindingId
{
    private BindingId(string value) => Value = value;
    public string Value { get; }
    public static BindingId Parse(string value) => new(IdentifierValidation.BindingId(value, "binding_id"));
    public override string ToString() => Value;
}
