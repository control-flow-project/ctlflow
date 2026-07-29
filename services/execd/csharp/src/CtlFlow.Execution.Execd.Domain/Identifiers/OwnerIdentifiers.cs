using static CtlFlow.Execution.Execd.Domain.Identifiers.IdentifierValidation;

namespace CtlFlow.Execution.Execd.Domain.Identifiers;

public sealed record TenantId
{
    private TenantId(string value) => Value = value;
    public string Value { get; }
    public static TenantId Parse(string value) => new(ExecutionId(value, "tenant_id"));
    public override string ToString() => Value;
}

public sealed record WorkspaceId
{
    private WorkspaceId(string value) => Value = value;
    public string Value { get; }
    public static WorkspaceId Parse(string value) => new(ExecutionId(value, "workspace_id"));
    public override string ToString() => Value;
}

public sealed record PrincipalId
{
    private PrincipalId(string value) => Value = value;
    public string Value { get; }
    public static PrincipalId Parse(string value) => new(IdentifierValidation.PrincipalId(value, "principal_id"));
    public static PrincipalId ParseAccount(string value) => new(AccountPrincipalId(value, "account_principal_id"));
    public override string ToString() => Value;
}

public sealed record AppId
{
    private AppId(string value) => Value = value;
    public string Value { get; }
    public static AppId Parse(string value) => new(ExecutionId(value, "app_id"));
    public override string ToString() => Value;
}

public sealed record PackageId
{
    private PackageId(string value) => Value = value;
    public string Value { get; }
    public static PackageId Parse(string value) => new(IdentifierValidation.PackageId(value, "package_id"));
    public override string ToString() => Value;
}

public sealed record ComponentId
{
    private ComponentId(string value) => Value = value;
    public string Value { get; }
    public static ComponentId Parse(string value) => new(ExecutionId(value, "component_id"));
    public override string ToString() => Value;
}

public sealed record InterfaceId
{
    private InterfaceId(string value) => Value = value;
    public string Value { get; }
    public static InterfaceId Parse(string value) => new(ExecutionId(value, "interface_id"));
    public override string ToString() => Value;
}

public sealed record ExposureId
{
    private ExposureId(string value) => Value = value;
    public string Value { get; }
    public static ExposureId Parse(string value) =>
        new(ExecutionId(value, "exposure_id"));
    public override string ToString() => Value;
}

public sealed record DependencyId
{
    private DependencyId(string value) => Value = value;
    public string Value { get; }
    public static DependencyId Parse(string value) => new(ExecutionId(value, "dependency_id"));
    public override string ToString() => Value;
}
