using static CtlFlow.Execution.Execd.Domain.Identifiers.IdentifierValidation;

namespace CtlFlow.Execution.Execd.Domain.Identifiers;

public sealed record DependencyName
{
    private DependencyName(string value) => Value = value;
    public string Value { get; }
    public static DependencyName Parse(string value) => new(IdentifierValidation.DependencyName(value, "dependency_name"));
    public override string ToString() => Value;
}

public sealed record DependencyType
{
    private DependencyType(string value) => Value = value;
    public string Value { get; }
    public static DependencyType Parse(string value) => new(IdentifierValidation.DependencyType(value, "dependency_type"));
    public override string ToString() => Value;
}

public sealed record ArtifactRepository
{
    private ArtifactRepository(string value) => Value = value;
    public string Value { get; }
    public static ArtifactRepository Parse(string value) => new(Repository(value, "artifact_repository"));
    public override string ToString() => Value;
}

public sealed record ManifestDigest
{
    private ManifestDigest(string value) => Value = value;
    public string Value { get; }
    public static ManifestDigest Parse(string value) => new(IdentifierValidation.ManifestDigest(value, "manifest_digest"));
    public override string ToString() => Value;
}

public sealed record ContractId
{
    private ContractId(string value) => Value = value;
    public string Value { get; }
    public static ContractId Parse(string value) => new(IdentifierValidation.ContractId(value, "contract_id"));
    public override string ToString() => Value;
}
