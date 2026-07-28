using CtlFlow.Policy.Policyd.Domain.Identifiers;
using CtlFlow.Policy.Policyd.Domain.Operations;
using CtlFlow.Policy.Policyd.Domain.Paths;
using CtlFlow.Policy.Policyd.Domain.Rules;

namespace CtlFlow.Policy.Policyd.Domain.Roles;

public class RoleRule
{
    private string _roleId = null!;
    private string _operation = null!;
    private string _basePath = null!;
    private int _matchKind;

    private RoleRule()
    {
    }

    public RoleRule(
        RoleId roleId,
        OperationToken operation,
        ResourcePath basePath,
        RuleMatchKind matchKind)
    {
        _roleId = roleId.Value;
        _operation = operation.Value;
        _basePath = basePath.Value;
        _matchKind = RuleMatchKindCodes.ToStorage(matchKind);
    }

    public RoleId RoleId => RoleId.FromStorage(_roleId);

    public OperationToken Operation => OperationToken.FromStorage(_operation);

    public ResourcePath BasePath => ResourcePath.FromStorage(_basePath);

    public RuleMatchKind MatchKind =>
        RuleMatchKindCodes.FromStorage(_matchKind);
}
