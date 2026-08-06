using CtlFlow.Policy.Policyd.Domain.Identifiers;
using CtlFlow.Policy.Policyd.Domain.Operations;
using CtlFlow.Policy.Policyd.Domain.Paths;
using CtlFlow.Policy.Policyd.Domain.Targets;

namespace CtlFlow.Policy.Policyd.Domain.Catalog;

public sealed record CatalogRequest(
    OperationToken Operation,
    ResourcePath ResourcePath,
    PolicyTarget Target,
    PrincipalId? AccountScope);
