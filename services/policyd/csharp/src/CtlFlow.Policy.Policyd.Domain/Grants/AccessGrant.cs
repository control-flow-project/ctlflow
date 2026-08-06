using CtlFlow.Policy.Policyd.Domain.Identifiers;
using CtlFlow.Policy.Policyd.Domain.Operations;
using CtlFlow.Policy.Policyd.Domain.Paths;
using CtlFlow.Policy.Policyd.Domain.Rules;
using CtlFlow.Policy.Policyd.Domain.Subjects;
using CtlFlow.Policy.Policyd.Domain.Targets;

namespace CtlFlow.Policy.Policyd.Domain.Grants;

public class AccessGrant
{
    private long _id;
    private int _targetKind;
    private string _tenantId = null!;
    private string? _workspaceId;
    private int _subjectKind;
    private string _subjectId = null!;
    private int _operationOwnerKind;
    private string _operationOwnerId = null!;
    private string _operation = null!;
    private string _basePath = null!;
    private int _matchKind;

    private AccessGrant()
    {
    }

    public AccessGrant(
        AccessGrantId id,
        TargetKind targetKind,
        TenantId tenantId,
        WorkspaceId? workspaceId,
        SubjectKind subjectKind,
        SubjectId subjectId,
        OperationIdentity operation,
        ResourcePath basePath,
        RuleMatchKind matchKind)
    {
        _id = id.Value;
        _targetKind = TargetKindCodes.ToStorage(targetKind);
        _tenantId = tenantId.Value;
        _workspaceId = workspaceId?.Value;
        _subjectKind = SubjectKindCodes.ToStorage(subjectKind);
        _subjectId = subjectId.Value;
        _operationOwnerKind = operation.OwnerKind;
        _operationOwnerId = operation.OwnerId;
        _operation = operation.Operation.Value;
        _basePath = basePath.Value;
        _matchKind = RuleMatchKindCodes.ToStorage(matchKind);
    }

    public AccessGrantId Id => AccessGrantId.FromStorage(_id);

    public TargetKind TargetKind => TargetKindCodes.FromStorage(_targetKind);

    public TenantId TenantId => TenantId.FromStorage(_tenantId);

    public WorkspaceId? WorkspaceId =>
        _workspaceId is null
            ? null
            : CtlFlow.Policy.Policyd.Domain.Identifiers.WorkspaceId
                .FromStorage(_workspaceId);

    public int OperationOwnerKind => _operationOwnerKind;

    public string OperationOwnerId => _operationOwnerId;

    public SubjectKind SubjectKind =>
        SubjectKindCodes.FromStorage(_subjectKind);

    public SubjectId SubjectId =>
        SubjectId.FromStorage(SubjectKind, _subjectId);

    public OperationToken Operation => OperationToken.FromStorage(_operation);

    public ResourcePath BasePath => ResourcePath.FromStorage(_basePath);

    public RuleMatchKind MatchKind =>
        RuleMatchKindCodes.FromStorage(_matchKind);
}
