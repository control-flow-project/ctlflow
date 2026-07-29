using CtlFlow.Execution.Execd.Domain.Identifiers;

namespace CtlFlow.Execution.Execd.Db.Workloads;

public sealed record DependencyOptionsContent(
    ComponentId ComponentId,
    DependencyName DependencyName,
    ReadOnlyMemory<byte> CanonicalJson);
