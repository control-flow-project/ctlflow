using static CtlFlow.Execution.Execd.Domain.Identifiers.IdentifierValidation;

namespace CtlFlow.Execution.Execd.Domain.Identifiers;

public sealed record PlacementId
{
    private PlacementId(string value) => Value = value;
    public string Value { get; }
    public static PlacementId Parse(string value) => new(ExecutionId(value, "placement_id"));
    public override string ToString() => Value;
}

public sealed record WorkloadId
{
    private WorkloadId(string value) => Value = value;
    public string Value { get; }
    public static WorkloadId Parse(string value) => new(ExecutionId(value, "workload_id"));
    public override string ToString() => Value;
}

public sealed record RunId
{
    private RunId(string value) => Value = value;
    public string Value { get; }
    public static RunId Parse(string value) => new(IdentifierValidation.RunId(value, "run_id"));
    public override string ToString() => Value;
}

public sealed record StorageId
{
    private StorageId(string value) => Value = value;
    public string Value { get; }
    public static StorageId Parse(string value) => new(ExecutionId(value, "storage_id"));
    public override string ToString() => Value;
}

public sealed record ProvisionerId
{
    private ProvisionerId(string value) => Value = value;
    public string Value { get; }
    public static ProvisionerId Parse(string value) => new(ExecutionId(value, "provisioner_id"));
    public override string ToString() => Value;
}

public sealed record ParameterName
{
    private ParameterName(string value) => Value = value;
    public string Value { get; }
    public static ParameterName Parse(string value) => new(ExecutionId(value, "parameter_name"));
    public override string ToString() => Value;
}
