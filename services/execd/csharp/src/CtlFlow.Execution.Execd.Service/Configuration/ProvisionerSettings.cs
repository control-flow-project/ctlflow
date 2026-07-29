using CtlFlow.Execution.Execd.Domain.Identifiers;

namespace CtlFlow.Execution.Execd.Service.Configuration;

internal sealed record ProvisionerSettings(
    IReadOnlyDictionary<ProvisionerId, ProvisionerSubject> Subjects);
