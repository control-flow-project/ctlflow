using CtlFlow.Execution.Execd.Db.Workloads;
using CtlFlow.Execution.Execd.Domain.Placements;
using CtlFlow.Execution.Execd.Domain.Workloads;

namespace CtlFlow.Execution.Execd.Service.Workloads;

internal sealed record AdmittedWorkload(
    PlacementRecord Placement,
    WorkloadDraft Draft,
    WorkloadWriteContent Content);
