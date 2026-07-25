namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Documents;

internal sealed class KubernetesStatusDocument
{
    public string ApiVersion { get; init; } = "v1";

    public string Kind { get; init; } = "Status";

    public string Status { get; init; } = "Failure";

    public required string Message { get; init; }

    public required string Reason { get; init; }

    public KubernetesStatusDetailsDocument? Details { get; init; }

    public int Code { get; init; }
}

internal sealed class KubernetesStatusDetailsDocument
{
    public string? Name { get; init; }

    public string Group { get; init; } = "tenancy.ctlflow.com";

    public string? Kind { get; init; }

    public KubernetesStatusCauseDocument[]? Causes { get; init; }
}

internal sealed class KubernetesStatusCauseDocument
{
    public required string Reason { get; init; }

    public required string Message { get; init; }

    public required string Field { get; init; }
}
